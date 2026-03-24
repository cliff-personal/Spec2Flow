import process from 'node:process';
import { resolveFromCwd } from '../shared/fs-utils.js';
import type { TaskGraphDocument } from '../types/index.js';
import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import { createPlatformRunInitializationPlan, persistPlatformRunPlan } from '../platform/platform-repository.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface PlatformRunInitDocument {
  platformRun: {
    schema: string;
    repositoryId: string;
    runId: string;
    workflowName: string;
    taskCount: number;
    eventCount: number;
    artifactCount: number;
    status: string;
    currentStage: string | null;
  };
}

export interface InitPlatformRunDependencies {
  createPlatformPool: typeof createPlatformPool;
  createPlatformRunInitializationPlan: typeof createPlatformRunInitializationPlan;
  fail: (message: string) => void;
  persistPlatformRunPlan: typeof persistPlatformRunPlan;
  printJson: (value: PlatformRunInitDocument) => void;
  readStructuredFile: (filePath: string) => TaskGraphDocument;
  resolvePlatformDatabaseConfig: typeof resolvePlatformDatabaseConfig;
  withPlatformTransaction: typeof withPlatformTransaction;
  writeJson: (filePath: string, payload: unknown) => void;
}

export async function runInitPlatformRun(options: CliOptions, dependencies: InitPlatformRunDependencies): Promise<void> {
  const taskGraphPath = typeof options['task-graph'] === 'string' ? options['task-graph'] : undefined;

  if (!taskGraphPath) {
    dependencies.fail('init-platform-run requires --task-graph');
    throw new Error('unreachable');
  }

  const config = dependencies.resolvePlatformDatabaseConfig(options);
  if (!config.connectionString && !process.env.PGHOST && !process.env.PGDATABASE) {
    dependencies.fail('init-platform-run requires --database-url or standard PG* environment variables');
    throw new Error('unreachable');
  }

  const taskGraphPayload = dependencies.readStructuredFile(taskGraphPath);
  const repositoryRoot = typeof options['repo-root'] === 'string' ? resolveFromCwd(options['repo-root']) : process.cwd();
  const plan = dependencies.createPlatformRunInitializationPlan(taskGraphPayload, {
    ...(typeof options['repository-id'] === 'string' ? { repositoryId: options['repository-id'] } : {}),
    ...(typeof options['repository-name'] === 'string' ? { repositoryName: options['repository-name'] } : {}),
    ...(typeof options['default-branch'] === 'string' ? { defaultBranch: options['default-branch'] } : {}),
    ...(typeof options['run-id'] === 'string' ? { runId: options['run-id'] } : {}),
    ...(typeof options['request-text'] === 'string' ? { requestText: options['request-text'] } : {}),
    repositoryRoot,
    taskGraphRef: resolveFromCwd(taskGraphPath)
  });

  const pool = dependencies.createPlatformPool(config);

  try {
    await dependencies.withPlatformTransaction(pool, async (client) => {
      await dependencies.persistPlatformRunPlan(client, config.schema, plan);
    });
  } finally {
    await pool.end();
  }

  const outputPayload: PlatformRunInitDocument = {
    platformRun: {
      schema: config.schema,
      repositoryId: plan.repository.repositoryId,
      runId: plan.run.runId,
      workflowName: plan.run.workflowName,
      taskCount: plan.tasks.length,
      eventCount: plan.events.length,
      artifactCount: plan.artifacts.length,
      status: plan.run.status,
      currentStage: plan.run.currentStage ?? null
    }
  };
  const outputPath = typeof options.output === 'string' ? options.output : undefined;

  if (outputPath) {
    dependencies.writeJson(outputPath, outputPayload);
    console.log(`Wrote platform run receipt to ${outputPath}`);
    return;
  }

  dependencies.printJson(outputPayload);
}
