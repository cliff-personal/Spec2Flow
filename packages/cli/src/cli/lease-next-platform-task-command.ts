import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import {
  DEFAULT_PLATFORM_HEARTBEAT_INTERVAL_SECONDS,
  DEFAULT_PLATFORM_LEASE_TTL_SECONDS,
  leaseNextPlatformTask,
  type LeaseNextPlatformTaskResult
} from '../platform/platform-scheduler-service.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface PlatformTaskLeaseDocument {
  platformTaskLease: LeaseNextPlatformTaskResult;
}

export interface LeaseNextPlatformTaskDependencies {
  createPlatformPool: typeof createPlatformPool;
  fail: (message: string) => void;
  leaseNextPlatformTask: typeof leaseNextPlatformTask;
  printJson: (value: PlatformTaskLeaseDocument) => void;
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

export async function runLeaseNextPlatformTask(options: CliOptions, dependencies: LeaseNextPlatformTaskDependencies): Promise<void> {
  const runId = typeof options['run-id'] === 'string' ? options['run-id'] : undefined;
  const workerId = typeof options['worker-id'] === 'string' ? options['worker-id'] : undefined;

  if (!runId || !workerId) {
    dependencies.fail('lease-next-platform-task requires --run-id and --worker-id');
    throw new Error('unreachable');
  }

  const config = dependencies.resolvePlatformDatabaseConfig(options);
  const leaseTtlSeconds = parsePositiveInteger(options['lease-ttl-seconds'], '--lease-ttl-seconds', DEFAULT_PLATFORM_LEASE_TTL_SECONDS, dependencies.fail);
  const heartbeatIntervalSeconds = parsePositiveInteger(options['heartbeat-interval-seconds'], '--heartbeat-interval-seconds', DEFAULT_PLATFORM_HEARTBEAT_INTERVAL_SECONDS, dependencies.fail);
  const pool = dependencies.createPlatformPool(config);

  try {
    const outputPayload: PlatformTaskLeaseDocument = {
      platformTaskLease: await dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.leaseNextPlatformTask(client, config.schema, {
          runId,
          workerId,
          leaseTtlSeconds,
          heartbeatIntervalSeconds
        }))
    };
    const outputPath = typeof options.output === 'string' ? options.output : undefined;

    if (outputPath) {
      dependencies.writeJson(outputPath, outputPayload);
      console.log(`Wrote platform task lease receipt to ${outputPath}`);
      return;
    }

    dependencies.printJson(outputPayload);
  } finally {
    await pool.end();
  }
}
