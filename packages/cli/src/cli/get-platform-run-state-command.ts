import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import {
  DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT,
  getPlatformRunState
} from '../platform/platform-scheduler-service.js';
import type { PlatformRunStateSnapshot } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface PlatformRunStateDocument {
  platformRunState: PlatformRunStateSnapshot;
}

export interface GetPlatformRunStateDependencies {
  createPlatformPool: typeof createPlatformPool;
  fail: (message: string) => void;
  getPlatformRunState: typeof getPlatformRunState;
  printJson: (value: PlatformRunStateDocument) => void;
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

export async function runGetPlatformRunState(options: CliOptions, dependencies: GetPlatformRunStateDependencies): Promise<void> {
  const runId = typeof options['run-id'] === 'string' ? options['run-id'] : undefined;
  if (!runId) {
    dependencies.fail('get-platform-run-state requires --run-id');
    throw new Error('unreachable');
  }

  const config = dependencies.resolvePlatformDatabaseConfig(options);
  const eventLimit = parsePositiveInteger(options['event-limit'], '--event-limit', DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT, dependencies.fail);
  const pool = dependencies.createPlatformPool(config);

  try {
    const outputPayload: PlatformRunStateDocument = {
      platformRunState: await dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.getPlatformRunState(client, config.schema, {
          runId,
          eventLimit
        }))
    };
    const outputPath = typeof options.output === 'string' ? options.output : undefined;

    if (outputPath) {
      dependencies.writeJson(outputPath, outputPayload);
      console.log(`Wrote platform run state snapshot to ${outputPath}`);
      return;
    }

    dependencies.printJson(outputPayload);
  } finally {
    await pool.end();
  }
}
