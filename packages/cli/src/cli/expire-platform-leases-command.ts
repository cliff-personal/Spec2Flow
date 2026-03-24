import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import { expirePlatformLeases, type ExpirePlatformLeasesResult } from '../platform/platform-scheduler-service.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface PlatformLeaseExpirationSweepDocument {
  platformLeaseExpirationSweep: ExpirePlatformLeasesResult;
}

export interface ExpirePlatformLeasesDependencies {
  createPlatformPool: typeof createPlatformPool;
  expirePlatformLeases: typeof expirePlatformLeases;
  fail: (message: string) => void;
  printJson: (value: PlatformLeaseExpirationSweepDocument) => void;
  resolvePlatformDatabaseConfig: typeof resolvePlatformDatabaseConfig;
  withPlatformTransaction: typeof withPlatformTransaction;
  writeJson: (filePath: string, payload: unknown) => void;
}

export async function runExpirePlatformLeases(options: CliOptions, dependencies: ExpirePlatformLeasesDependencies): Promise<void> {
  const runId = typeof options['run-id'] === 'string' ? options['run-id'] : undefined;

  if (!runId) {
    dependencies.fail('expire-platform-leases requires --run-id');
    throw new Error('unreachable');
  }

  const config = dependencies.resolvePlatformDatabaseConfig(options);
  const pool = dependencies.createPlatformPool(config);

  try {
    const outputPayload: PlatformLeaseExpirationSweepDocument = {
      platformLeaseExpirationSweep: await dependencies.withPlatformTransaction(pool, async (client) =>
        dependencies.expirePlatformLeases(client, config.schema, { runId }))
    };
    const outputPath = typeof options.output === 'string' ? options.output : undefined;

    if (outputPath) {
      dependencies.writeJson(outputPath, outputPayload);
      console.log(`Wrote platform lease expiration sweep receipt to ${outputPath}`);
      return;
    }

    dependencies.printJson(outputPayload);
  } finally {
    await pool.end();
  }
}
