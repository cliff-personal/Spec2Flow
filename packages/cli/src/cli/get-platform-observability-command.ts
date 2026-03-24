import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import { getPlatformObservability } from '../platform/platform-observability-service.js';
import { DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT } from '../platform/platform-scheduler-service.js';
import type { PlatformObservabilityReadModel } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface PlatformObservabilityDocument {
  platformObservability: PlatformObservabilityReadModel;
}

export interface GetPlatformObservabilityDependencies {
  createPlatformPool: typeof createPlatformPool;
  fail: (message: string) => void;
  getPlatformObservability: typeof getPlatformObservability;
  printJson: (value: PlatformObservabilityDocument) => void;
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

export async function runGetPlatformObservability(
  options: CliOptions,
  dependencies: GetPlatformObservabilityDependencies
): Promise<void> {
  const runId = typeof options['run-id'] === 'string' ? options['run-id'] : undefined;
  if (!runId) {
    dependencies.fail('get-platform-observability requires --run-id');
    throw new Error('unreachable');
  }

  const config = dependencies.resolvePlatformDatabaseConfig(options);
  const eventLimit = parsePositiveInteger(options['event-limit'], '--event-limit', DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT, dependencies.fail);
  const pool = dependencies.createPlatformPool(config);

  try {
    const outputPayload: PlatformObservabilityDocument = {
      platformObservability: await dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.getPlatformObservability(client, config.schema, {
          runId,
          eventLimit
        }))
    };
    const outputPath = typeof options.output === 'string' ? options.output : undefined;

    if (outputPath) {
      dependencies.writeJson(outputPath, outputPayload);
      console.log(`Wrote platform observability snapshot to ${outputPath}`);
      return;
    }

    dependencies.printJson(outputPayload);
  } finally {
    await pool.end();
  }
}
