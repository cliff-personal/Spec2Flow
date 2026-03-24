import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import {
  executePlatformWorkerMaterialization,
  materializePlatformWorkerClaim,
  persistPlatformWorkerResult,
  type PlatformWorkerExecutionResult,
  type PersistPlatformWorkerResult
} from '../platform/platform-worker-service.js';
import { startPlatformTask, type StartPlatformTaskResult } from '../platform/platform-scheduler-service.js';
import type { AdapterRunnerDependencies } from '../adapters/adapter-runner.js';
import type { PlatformRunStateSnapshot, TaskClaimPayload, TaskStage, TaskResult } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface PlatformWorkerRunDocument {
  platformWorkerRun: {
    runId: string;
    taskId: string;
    workerId: string;
    stage: TaskStage;
    mode: PlatformWorkerExecutionResult['mode'];
    startResult: StartPlatformTaskResult;
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
  createPlatformPool: typeof createPlatformPool;
  executePlatformWorkerMaterialization: typeof executePlatformWorkerMaterialization;
  fail: (message: string) => void;
  materializePlatformWorkerClaim: typeof materializePlatformWorkerClaim;
  persistPlatformWorkerResult: typeof persistPlatformWorkerResult;
  printJson: (value: PlatformWorkerRunDocument) => void;
  resolvePlatformDatabaseConfig: typeof resolvePlatformDatabaseConfig;
  startPlatformTask: typeof startPlatformTask;
  withPlatformTransaction: typeof withPlatformTransaction;
  writeJson: (filePath: string, payload: unknown) => void;
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

  try {
    const startResult = await dependencies.withPlatformTransaction(pool, async (client) =>
      dependencies.startPlatformTask(client, config.schema, {
        runId,
        taskId,
        workerId
      }));
    const materialization = await dependencies.withPlatformTransaction(pool, async (client) =>
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
    const executionResult = dependencies.executePlatformWorkerMaterialization({
      materialization,
      ...(typeof options['adapter-runtime'] === 'string' ? { adapterRuntimePath: options['adapter-runtime'] } : {}),
      ...(typeof options['adapter-capability'] === 'string' ? { adapterCapabilityPath: options['adapter-capability'] } : {}),
      ...(typeof options.executor === 'string' ? { executor: options.executor } : {}),
      ...(settings.expectedStage ? { expectedStage: settings.expectedStage } : {})
    }, dependencies);
    const persistResult = await dependencies.withPlatformTransaction(pool, async (client) =>
      dependencies.persistPlatformWorkerResult(client, config.schema, {
        runId,
        taskId,
        workerId,
        materialization,
        adapterRun: executionResult.adapterRun,
        receipt: executionResult.receipt
      }));

    const outputPayload: PlatformWorkerRunDocument = {
      platformWorkerRun: {
        runId,
        taskId,
        workerId,
        stage: materialization.stage,
        mode: executionResult.mode,
        startResult,
        claimPath: materialization.claimPath,
        executionStatePath: materialization.executionStatePath,
        taskGraphPath: materialization.taskGraphPath,
        taskClaim: materialization.claimPayload.taskClaim,
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
    await pool.end();
  }
}
