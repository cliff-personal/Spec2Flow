import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import {
  buildStoppedPlatformWorkerExecutionResult,
  executePlatformWorkerMaterialization,
  materializePlatformWorkerClaim,
  persistPlatformWorkerResult
} from './platform-worker-service.js';
import {
  leaseNextPlatformTask,
  startPlatformTask
} from './platform-scheduler-service.js';
import { listPlatformRuns } from './platform-control-plane-service.js';
import { withPlatformTransaction } from './platform-database.js';
import type { AdapterRunnerDependencies } from '../adapters/adapter-runner.js';
import type { TaskStage } from '../types/index.js';

// Stages that can run without an AI adapter
const DETERMINISTIC_STAGES: TaskStage[] = ['environment-preparation', 'automated-execution'];

// Standard locations to search for the project's adapter runtime, in priority order.
const ADAPTER_RUNTIME_CANDIDATES = [
  path.join('.spec2flow', 'model-adapter-runtime.json'),
];

function findAdapterRuntimePath(
  worktreePath: string | null | undefined,
  repositoryRootPath: string | null | undefined
): string | null {
  const roots = [worktreePath, repositoryRootPath].filter((r): r is string => !!r);
  for (const root of roots) {
    for (const rel of ADAPTER_RUNTIME_CANDIDATES) {
      const candidate = path.resolve(root, rel);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

// No-op adapter dependencies — only used for non-deterministic stages which
// the auto-runner never dispatches to; stubs are type-safe and safe to provide.
const noopAdapterDeps: AdapterRunnerDependencies = {
  validateAdapterRuntimePayload: () => { /* noop */ },
  sanitizeStageName: (s: string) => s.replaceAll(/[^a-z0-9-]/gi, '-').toLowerCase(),
  getRouteNameFromTaskId: (id: string | null | undefined) => id ?? 'unknown',
  parseCsvOption: (value: string | undefined) => value ? value.split(',').map((v) => v.trim()).filter(Boolean) : []
};

export interface PlatformAutoRunnerConfig {
  pool: Pool;
  schema: string;
  /** How often to poll for pending runs, ms. Default 6000. */
  pollIntervalMs?: number;
  /** Max concurrent runs being processed. Default 2. */
  maxConcurrentRuns?: number;
}

export interface PlatformAutoRunnerHandle {
  stop: () => void;
}

/**
 * Starts a background loop that polls for pending/running platform runs and
 * executes each ready task automatically.
 *
 * Deterministic stages (environment-preparation, automated-execution) run
 * immediately without any AI adapter.
 *
 * AI-dependent stages are marked as blocked with a clear explanation when no
 * adapter runtime is configured, surfacing where the run is waiting.
 */
export function startPlatformAutoRunner(config: PlatformAutoRunnerConfig): PlatformAutoRunnerHandle {
  const pollIntervalMs = config.pollIntervalMs ?? 6000;
  const maxConcurrentRuns = config.maxConcurrentRuns ?? 2;
  let stopped = false;
  const inProgress = new Set<string>();

  async function processRun(runId: string): Promise<void> {
    if (inProgress.has(runId)) {
      return;
    }
    inProgress.add(runId);

    try {
      // Keep draining ready tasks for this run until none remain
      while (!stopped) {
        const workerId = `auto-runner-${randomUUID()}`;

        // 1. Lease next ready task (600s TTL to accommodate AI adapter timeouts)
        const leaseResult = await withPlatformTransaction(config.pool, (client) =>
          leaseNextPlatformTask(client, config.schema, {
            runId,
            workerId,
            leaseTtlSeconds: 600
          })
        );

        if (leaseResult.status === 'no-ready-task' || !leaseResult.task) {
          break;
        }

        const { taskId } = leaseResult.task;
        const stage = leaseResult.task.stage;

        let materialization: Awaited<ReturnType<typeof materializePlatformWorkerClaim>> | null = null;

        try {
          // 2. Start the task
          const startResult = await withPlatformTransaction(config.pool, (client) =>
            startPlatformTask(client, config.schema, {
              runId,
              taskId,
              workerId
            })
          );

          if (startResult.status === 'rejected') {
            // Lease was lost between lease and start — retry from top
            continue;
          }

          // 3. Materialize claim (write execution-state + claim files)
          materialization = await withPlatformTransaction(config.pool, (client) =>
            materializePlatformWorkerClaim(client, config.schema, {
              runId,
              taskId,
              workerId,
              adapter: 'spec2flow-auto-runner'
            })
          );

          let executionResult;

          if (DETERMINISTIC_STAGES.includes(stage)) {
            // 4a. Run deterministic task (no adapter needed)
            console.log(`[auto-runner] deterministic ${stage} task ${taskId}`);
            executionResult = await executePlatformWorkerMaterialization(
              { materialization },
              noopAdapterDeps
            );
          } else {
            // 4b. Look for adapter runtime in the project's worktree / repository root
            const worktreePath = materialization.snapshot.workspace?.worktreePath;
            const repositoryRootPath = materialization.snapshot.project?.repositoryRootPath;
            const adapterRuntimePath = findAdapterRuntimePath(worktreePath, repositoryRootPath);

            if (adapterRuntimePath) {
              // 4c. Dispatch to the AI adapter
              console.log(`[auto-runner] dispatching ${stage} task ${taskId} via ${adapterRuntimePath}`);
              executionResult = await executePlatformWorkerMaterialization(
                { materialization, adapterRuntimePath },
                noopAdapterDeps
              );
            } else {
              // 4d. No adapter found — block with actionable message
              const searchedPaths = [worktreePath, repositoryRootPath]
                .filter(Boolean)
                .map((r) => `${r}/.spec2flow/model-adapter-runtime.json`)
                .join(', ');
              executionResult = buildStoppedPlatformWorkerExecutionResult({
                materialization,
                message: `Stage "${stage}" requires an AI adapter. Add .spec2flow/model-adapter-runtime.json to your project root. Searched: ${searchedPaths || 'no project path resolved'}`,
                code: 'no-adapter-configured',
                recoverable: true
              });
            }
          }

          // 5. Persist result
          await withPlatformTransaction(config.pool, (client) =>
            persistPlatformWorkerResult(client, config.schema, {
              runId,
              taskId,
              workerId,
              materialization: materialization!,
              adapterRun: executionResult.adapterRun,
              receipt: executionResult.receipt
            })
          );
        } catch (taskError) {
          // Persist a blocked result if materialization completed so the task
          // doesn't stay stuck in-progress. Otherwise just log and break.
          console.error(`[auto-runner] error processing task ${taskId} for run ${runId}:`, taskError);
          if (materialization) {
            try {
              const errorMessage = taskError instanceof Error ? taskError.message : String(taskError);
              const stoppedResult = buildStoppedPlatformWorkerExecutionResult({
                materialization,
                message: `auto-runner task error: ${errorMessage}`,
                code: 'auto-runner-task-error',
                recoverable: false
              });
              await withPlatformTransaction(config.pool, (client) =>
                persistPlatformWorkerResult(client, config.schema, {
                  runId,
                  taskId,
                  workerId,
                  materialization: materialization!,
                  adapterRun: stoppedResult.adapterRun,
                  receipt: stoppedResult.receipt
                })
              );
            } catch (persistError) {
              console.error(`[auto-runner] failed to persist error result for task ${taskId}:`, persistError);
            }
          }
          break;
        }
      }
    } catch (runError) {
      console.error(`[auto-runner] error processing run ${runId}:`, runError);
    } finally {
      inProgress.delete(runId);
    }
  }

  async function pollOnce(): Promise<void> {
    if (stopped) return;

    try {
      // Find runs that are pending or running
      const pendingRuns = await withPlatformTransaction(config.pool, (client) =>
        listPlatformRuns(client, config.schema, { limit: 20, status: 'pending' })
      );
      const runningRuns = await withPlatformTransaction(config.pool, (client) =>
        listPlatformRuns(client, config.schema, { limit: 20, status: 'running' })
      );

      const candidates = [...pendingRuns, ...runningRuns]
        .filter((r) => !inProgress.has(r.runId))
        .slice(0, maxConcurrentRuns);

      await Promise.all(candidates.map((r) => processRun(r.runId)));
    } catch (pollError) {
      console.error('[auto-runner] poll error:', pollError);
    }
  }

  const timer = setInterval(() => {
    void pollOnce();
  }, pollIntervalMs);

  // First poll immediately
  void pollOnce();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
