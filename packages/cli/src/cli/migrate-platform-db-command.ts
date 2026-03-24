import { createPlatformPool, resolvePlatformDatabaseConfig, withPlatformTransaction } from '../platform/platform-database.js';
import { getDefaultPlatformMigrationsDir, migratePlatformDatabase } from '../platform/platform-migration-service.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface PlatformMigrationReportDocument {
  platformMigration: {
    schema: string;
    migrationsDir: string;
    appliedVersions: string[];
    skippedVersions: string[];
  };
}

export interface MigratePlatformDbDependencies {
  createPlatformPool: typeof createPlatformPool;
  fail: (message: string) => void;
  getDefaultPlatformMigrationsDir: typeof getDefaultPlatformMigrationsDir;
  migratePlatformDatabase: typeof migratePlatformDatabase;
  printJson: (value: PlatformMigrationReportDocument) => void;
  resolvePlatformDatabaseConfig: typeof resolvePlatformDatabaseConfig;
  withPlatformTransaction: typeof withPlatformTransaction;
  writeJson: (filePath: string, payload: unknown) => void;
}

export async function runMigratePlatformDb(options: CliOptions, dependencies: MigratePlatformDbDependencies): Promise<void> {
  const config = dependencies.resolvePlatformDatabaseConfig(options);
  const migrationsDir = typeof options['migrations-dir'] === 'string'
    ? options['migrations-dir']
    : dependencies.getDefaultPlatformMigrationsDir();

  if (!config.connectionString && !process.env.PGHOST && !process.env.PGDATABASE) {
    dependencies.fail('migrate-platform-db requires --database-url or standard PG* environment variables');
    throw new Error('unreachable');
  }

  const pool = dependencies.createPlatformPool(config);

  try {
    const report = await dependencies.withPlatformTransaction(pool, async (client) => ({
      platformMigration: await dependencies.migratePlatformDatabase(client, config.schema, migrationsDir)
    }));
    const outputPath = typeof options.output === 'string' ? options.output : undefined;

    if (outputPath) {
      dependencies.writeJson(outputPath, report);
      console.log(`Wrote platform migration report to ${outputPath}`);
      return;
    }

    dependencies.printJson(report);
  } finally {
    await pool.end();
  }
}
