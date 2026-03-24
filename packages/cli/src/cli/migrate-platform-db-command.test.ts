import { describe, expect, it, vi } from 'vitest';

import { runMigratePlatformDb, type MigratePlatformDbDependencies } from './migrate-platform-db-command.js';

describe('migrate-platform-db-command', () => {
  it('runs migrations and writes the report when output is requested', async () => {
    const writeJson = vi.fn();
    const createPlatformPool = vi.fn(() => ({
      end: vi.fn(async () => undefined)
    })) as unknown as MigratePlatformDbDependencies['createPlatformPool'];
    const withPlatformTransaction = vi.fn(async (_pool, callback: (client: { query: () => Promise<{ rows: never[]; rowCount: number; }> }) => Promise<unknown>) =>
      callback({
        query: async () => ({
          rows: [],
          rowCount: 0
        })
      })) as unknown as MigratePlatformDbDependencies['withPlatformTransaction'];

    await runMigratePlatformDb({
      'database-url': 'postgresql://local/spec2flow',
      output: 'generated/platform-migration.json'
    }, {
      createPlatformPool,
      fail: vi.fn(),
      getDefaultPlatformMigrationsDir: vi.fn(() => '/repo/migrations'),
      migratePlatformDatabase: vi.fn(async () => ({
        schema: 'spec2flow_platform',
        migrationsDir: '/repo/migrations',
        appliedVersions: ['0001_platform_runtime.sql'],
        skippedVersions: []
      })),
      printJson: vi.fn(),
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      withPlatformTransaction,
      writeJson
    });

    expect(createPlatformPool).toHaveBeenCalled();
    expect(withPlatformTransaction).toHaveBeenCalled();
    expect(writeJson).toHaveBeenCalledWith('generated/platform-migration.json', {
      platformMigration: {
        schema: 'spec2flow_platform',
        migrationsDir: '/repo/migrations',
        appliedVersions: ['0001_platform_runtime.sql'],
        skippedVersions: []
      }
    });
  });
});
