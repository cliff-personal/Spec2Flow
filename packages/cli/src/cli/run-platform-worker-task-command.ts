import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import {
  buildStoppedPlatformWorkerExecutionResult,
  executePlatformWorkerMaterialization,
  materializePlatformWorkerClaim,
  persistPlatformWorkerResult,
  type PlatformWorkerExecutionResult,
  type PersistPlatformWorkerResult,
  type PlatformWorkerMaterialization
} from '../platform/platform-worker-service.js';
import {
  heartbeatPlatformTask,
  startPlatformTask,
  type HeartbeatPlatformTaskResult,
  type StartPlatformTaskResult
} from '../platform/platform-scheduler-service.js';
import type { AdapterRunnerDependencies } from '../adapters/adapter-runner.js';
import type { PlatformRunStateSnapshot, TaskClaimPayload, TaskStage, TaskResult } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

const DEFAULT_PLATFORM_HEARTBEAT_ERROR_THRESHOLD = 3;

type PlatformWorkerStopReason =
  | 'heartbeat-rejected:not-found'
  | 'heartbeat-rejected:not-owned'
  | 'heartbeat-rejected:lease-expired'
  | 'heartbeat-rejected:not-leased'
  | 'heartbeat-error-threshold';

export interface PlatformWorkerLeaseGuardReceipt {
  leaseTtlSeconds: number;
  heartbeatIntervalSeconds: number;
  heartbeatsAttempted: number;
  heartbeatsSucceeded: number;
  heartbeatErrors: number;
  heartbeatErrorThreshold: number;
  status: 'completed' | 'stopped';
  stopReason?: PlatformWorkerStopReason;
}

export interface PlatformWorkerRunDocument {
  platformWorkerRun: {
    runId: string;
    taskId: string;
    workerId: string;
    stage: TaskStage;
    mode: PlatformWorkerExecutionResult['mode'];
    startResult: StartPlatformTaskResult;
    leaseGuard: PlatformWorkerLeaseGuardReceipt;
    claimPath: string;
    executionStatePath: string;
    taskGraphPath: string;
    taskClaim: TaskClaimPayload['taskClaim'];
    adapterRun: PlatformWorkerExecutionResult['adapterRun'];
    taskResult: TaskResult;
    updatedTasks: PersistPlatformWorkerResult['updatedTasks'];
    insertedArtifactCount: number;
    platformRunState: PlatformRunStateSnapshot;
  };
}

export interface RunPlatformWorkerTaskSettings {
  expectedStage?: TaskStage;
}

export interface RunPlatformWorkerTaskDependencies extends AdapterRunnerDependencies {
  buildStoppedPlatformWorkerExecutionResult: typeof buildStoppedPlatformWorkerExecutionResult;
  createPlatformPool: typeof createPlatformPool;
  executePlatformWorkerMaterialization: typeof executePlatformWorkerMaterialization;
  fail: (message: string) => void;
  heartbeatPlatformTask: typeof heartbeatPlatformTask;
  materializePlatformWorkerClaim: typeof materializePlatformWorkerClaim;
  persistPlatformWorkerResult: typeof persistPlatformWorkerResult;
  printJson: (value: PlatformWorkerRunDocument) => void;
  resolvePlatformDatabaseConfig: typeof resolvePlatformDatabaseConfig;
  startPlatformTask: typeof startPlatformTask;
  withPlatformTransaction: typeof withPlatformTransaction;
  writeJson: (filePath: string, payload: unknown) => void;
}

class PlatformWorkerStoppedError extends Error {
  readonly stopReason: PlatformWorkerStopReason;
  readonly persistable: boolean;

  constructor(message: string, stopReason: PlatformWorkerStopReason, persistable: boolean) {
    super(message);
    this.name = 'PlatformWorkerStoppedError';
    this.stopReason = stopReason;
    this.persistable = persistable;
  }
}

function getHeartbeatErrorThreshold(options: CliOptions): number {
  const raw = typeof options['heartbeat-error-threshold'] === 'string'
    ? Number.parseInt(options['heartbeat-error-threshold'], 10)
    : NaN;
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_PLATFORM_HEARTBEAT_ERROR_THRESHOLD;
}

function buildLeaseGuardReceipt(
  startResult: StartPlatformTaskResult,
  heartbeatErrorThreshold: number
): PlatformWorkerLeaseGuardReceipt {
  return {
    leaseTtlSeconds: startResult.leaseTtlSeconds,
    heartbeatIntervalSeconds: startResult.heartbeatIntervalSeconds,
    heartbeatsAttempted: 0,
    heartbeatsSucceeded: 0,
    heartbeatErrors: 0,
    heartbeatErrorThreshold,
    status: 'completed'
  };
}

async function runWorkerHeartbeat(
  runId: string,
  taskId: string,
  workerId: string,
  dependencies: RunPlatformWorkerTaskDependencies,
  config: ReturnType<RunPlatformWorkerTaskDependencies['resolvePlatformDatabaseConfig']>,
  pool: ReturnType<RunPlatformWorkerTaskDependencies['createPlatformPool']>,
  leaseGuard: PlatformWorkerLeaseGuardReceipt
): Promise<HeartbeatPlatformTaskResult> {
  leaseGuard.heartbeatsAttempted += 1;
  return dependencies.withPlatformTransaction(pool, async (client) =>
    dependencies.heartbeatPlatformTask(client, config.schema, {
      runId,
      taskId,
      workerId,
      leaseTtlSeconds: leaseGuard.leaseTtlSeconds,
      heartbeatIntervalSeconds: leaseGuard.heartbeatIntervalSeconds
    }));
}

export async function runPlatformWorkerTask(
  options: CliOptions,
  dependencies: RunPlatformWorkerTaskDependencies,
  settings: RunPlatformWorkerTaskSettings = {}
): Promise<void> {
  const runId = typeof options['run-id'] === 'string' ? options['run-id'] : undefined;
  const taskId = typeof options['task-id'] === 'string' ? options['task-id'] : undefined;
  const workerId = typeof options['worker-id'] === 'string' ? options['worker-id'] : undefined;

  if (!runId || !taskId || !workerId) {
    dependencies.fail('run-platform-worker-task requires --run-id, --task-id, and --worker-id');
    throw new Error('unreachable');
  }

  const config = dependencies.resolvePlatformDatabaseConfig(options);
  const pool = dependencies.createPlatformPool(config);
  const heartbeatErrorThreshold = getHeartbeatErrorThreshold(options);
  const executionAbortController = new AbortController();
  let materialization: PlatformWorkerMaterialization | null = null;
  let leaseGuard: PlatformWorkerLeaseGuardReceipt | null = null;
  let heartbeatLoopFinished = false;
  let heartbeatInFlight: Promise<void> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const stopHeartbeatLoop = async (): Promise<void> => {
    if (heartbeatLoopFinished) {
      return;
    }

    heartbeatLoopFinished = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (heartbeatInFlight) {
      await heartbeatInFlight;
    }
  };

  try {
    const startResult = await dependencies.withPlatformTransaction(pool, async (client) =>
      dependencies.startPlatformTask(client, config.schema, {
        runId,
        taskId,
        workerId
      }));
    const activeLeaseGuard = buildLeaseGuardReceipt(startResult, heartbeatErrorThreshold);
    leaseGuard = activeLeaseGuard;

    const claimedMaterialization = await dependencies.withPlatformTransaction(pool, async (client) =>
      dependencies.materializePlatformWorkerClaim(client, config.schema, {
        runId,
        taskId,
        workerId,
        ...(typeof options['output-base'] === 'string' ? { outputBaseDir: options['output-base'] } : {}),
        ...(typeof options['adapter-capability'] === 'string' ? { adapterCapabilityPath: options['adapter-capability'] } : {}),
        ...(typeof options.adapter === 'string' ? { adapter: options.adapter } : {}),
        ...(typeof options.model === 'string' ? { model: options.model } : {}),
        ...(typeof options['session-id'] === 'string' ? { sessionId: options['session-id'] } : {})
      }));
    materialization = claimedMaterialization;

    let consecutiveHeartbeatErrors = 0;
    const heartbeatIntervalMs = Math.max(1, activeLeaseGuard.heartbeatIntervalSeconds) * 1000;

    heartbeatTimer = setInterval(() => {
      if (heartbeatLoopFinished || heartbeatInFlight) {
        return;
      }

      heartbeatInFlight = (async () => {
        try {
          const heartbeatResult = await runWorkerHeartbeat(
            runId,
            taskId,
            workerId,
            dependencies,
            config,
            pool,
            activeLeaseGuard
          );

          if (heartbeatResult.status === 'renewed') {
            consecutiveHeartbeatErrors = 0;
            activeLeaseGuard.heartbeatsSucceeded += 1;
            return;
          }

          activeLeaseGuard.status = 'stopped';
          activeLeaseGuard.stopReason = `heartbeat-rejected:${heartbeatResult.reason ?? 'not-leased'}`;
          executionAbortController.abort(new PlatformWorkerStoppedError(
            `platform worker stopped because heartbeat was rejected: ${heartbeatResult.reason ?? 'not-leased'}`,
            activeLeaseGuard.stopReason,
            false
          ));
          heartbeatLoopFinished = true;
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
        } catch (error) {
          consecutiveHeartbeatErrors += 1;
          activeLeaseGuard.heartbeatErrors += 1;

          if (consecutiveHeartbeatErrors >= activeLeaseGuard.heartbeatErrorThreshold) {
            activeLeaseGuard.status = 'stopped';
            activeLeaseGuard.stopReason = 'heartbeat-error-threshold';
            executionAbortController.abort(new PlatformWorkerStoppedError(
              `platform worker stopped after ${consecutiveHeartbeatErrors} consecutive heartbeat errors`,
              'heartbeat-error-threshold',
              true
            ));
            heartbeatLoopFinished = true;
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
            return;
          }

          if (heartbeatLoopFinished) {
            return;
          }

          void error;
        } finally {
          heartbeatInFlight = null;
        }
      })();
    }, heartbeatIntervalMs);

    let executionResult: PlatformWorkerExecutionResult;

    try {
      executionResult = await dependencies.executePlatformWorkerMaterialization({
        materialization: claimedMaterialization,
        ...(typeof options['adapter-runtime'] === 'string' ? { adapterRuntimePath: options['adapter-runtime'] } : {}),
        ...(typeof options['adapter-capability'] === 'string' ? { adapterCapabilityPath: options['adapter-capability'] } : {}),
        ...(typeof options.executor === 'string' ? { executor: options.executor } : {}),
        ...(settings.expectedStage ? { expectedStage: settings.expectedStage } : {}),
        signal: executionAbortController.signal
      }, dependencies);
    } catch (error) {
      await stopHeartbeatLoop();
      const stopCause = executionAbortController.signal.reason;
      const stoppedError = stopCause instanceof PlatformWorkerStoppedError
        ? stopCause
        : error instanceof PlatformWorkerStoppedError
          ? error
          : null;

      if (!stoppedError || !materialization) {
        throw error;
      }

      if (!stoppedError.persistable) {
        throw stoppedError;
      }

      executionResult = dependencies.buildStoppedPlatformWorkerExecutionResult({
        materialization: claimedMaterialization,
        message: stoppedError.message,
        code: stoppedError.stopReason
      });
    }

    await stopHeartbeatLoop();
    const persistResult = await dependencies.withPlatformTransaction(pool, async (client) =>
      dependencies.persistPlatformWorkerResult(client, config.schema, {
        runId,
        taskId,
        workerId,
        materialization: claimedMaterialization,
        adapterRun: executionResult.adapterRun,
        receipt: executionResult.receipt
      }));

    const outputPayload: PlatformWorkerRunDocument = {
      platformWorkerRun: {
        runId,
        taskId,
        workerId,
        stage: claimedMaterialization.stage,
        mode: executionResult.mode,
        startResult,
        leaseGuard: activeLeaseGuard,
        claimPath: claimedMaterialization.claimPath,
        executionStatePath: claimedMaterialization.executionStatePath,
        taskGraphPath: claimedMaterialization.taskGraphPath,
        taskClaim: claimedMaterialization.claimPayload.taskClaim,
        adapterRun: executionResult.adapterRun,
        taskResult: executionResult.receipt,
        updatedTasks: persistResult.updatedTasks,
        insertedArtifactCount: persistResult.insertedArtifactCount,
        platformRunState: persistResult.platformRunState
      }
    };
    const outputPath = typeof options.output === 'string' ? options.output : undefined;

    if (outputPath) {
      dependencies.writeJson(outputPath, outputPayload);
      console.log(`Wrote platform worker run result to ${outputPath}`);
      return;
    }

    dependencies.printJson(outputPayload);
  } finally {
    heartbeatLoopFinished = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (heartbeatInFlight) {
      try {
        await heartbeatInFlight;
      } catch {
        // Ignore late heartbeat errors during shutdown.
      }
    }
    await pool.end();
  }
}
