import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import {
  DEFAULT_PLATFORM_HEARTBEAT_INTERVAL_SECONDS,
  DEFAULT_PLATFORM_LEASE_TTL_SECONDS,
  heartbeatPlatformTask,
  type HeartbeatPlatformTaskResult
} from '../platform/platform-scheduler-service.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface PlatformTaskHeartbeatDocument {
  platformTaskHeartbeat: HeartbeatPlatformTaskResult;
}

export interface HeartbeatPlatformTaskDependencies {
  createPlatformPool: typeof createPlatformPool;
  fail: (message: string) => void;
  heartbeatPlatformTask: typeof heartbeatPlatformTask;
  printJson: (value: PlatformTaskHeartbeatDocument) => void;
  resolvePlatformDatabaseConfig: typeof resolvePlatformDatabaseConfig;
  withPlatformTransaction: typeof withPlatformTransaction;
  writeJson: (filePath: string, payload: unknown) => void;
}

function parsePositiveInteger(value: string | boolean | undefined, optionName: string, fallback: number, fail: (message: string) => void): number {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    fail(`${optionName} must be a positive integer`);
    throw new Error('unreachable');
  }

  return parsed;
}

export async function runHeartbeatPlatformTask(options: CliOptions, dependencies: HeartbeatPlatformTaskDependencies): Promise<void> {
  const runId = typeof options['run-id'] === 'string' ? options['run-id'] : undefined;
  const taskId = typeof options['task-id'] === 'string' ? options['task-id'] : undefined;
  const workerId = typeof options['worker-id'] === 'string' ? options['worker-id'] : undefined;

  if (!runId || !taskId || !workerId) {
    dependencies.fail('heartbeat-platform-task requires --run-id, --task-id, and --worker-id');
    throw new Error('unreachable');
  }

  const config = dependencies.resolvePlatformDatabaseConfig(options);
  const leaseTtlSeconds = parsePositiveInteger(options['lease-ttl-seconds'], '--lease-ttl-seconds', DEFAULT_PLATFORM_LEASE_TTL_SECONDS, dependencies.fail);
  const heartbeatIntervalSeconds = parsePositiveInteger(options['heartbeat-interval-seconds'], '--heartbeat-interval-seconds', DEFAULT_PLATFORM_HEARTBEAT_INTERVAL_SECONDS, dependencies.fail);
  const pool = dependencies.createPlatformPool(config);

  try {
    const outputPayload: PlatformTaskHeartbeatDocument = {
      platformTaskHeartbeat: await dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.heartbeatPlatformTask(client, config.schema, {
          runId,
          taskId,
          workerId,
          leaseTtlSeconds,
          heartbeatIntervalSeconds
        }))
    };
    const outputPath = typeof options.output === 'string' ? options.output : undefined;

    if (outputPath) {
      dependencies.writeJson(outputPath, outputPayload);
      console.log(`Wrote platform task heartbeat receipt to ${outputPath}`);
      return;
    }

    dependencies.printJson(outputPayload);
  } finally {
    await pool.end();
  }
}
