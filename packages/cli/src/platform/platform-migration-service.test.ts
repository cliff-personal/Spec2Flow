import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { migratePlatformDatabase } from './platform-migration-service.js';
import type { SqlExecutor } from './platform-database.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-migrations-'));
  tempDirs.push(dir);
  return dir;
}

class RecordingExecutor implements SqlExecutor {
  constructor(private readonly appliedVersions: string[]) {}

  public readonly queries: Array<{ text: string; values?: readonly unknown[] }> = [];

  async query<Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{
    rows: Row[];
    rowCount: number | null;
  }> {
    this.queries.push(values ? { text: text.trim(), values } : { text: text.trim() });

    if (text.includes('SELECT version')) {
      return {
        rows: this.appliedVersions.map((version) => ({ version })) as unknown as Row[],
        rowCount: this.appliedVersions.length
      };
    }

    return {
      rows: [],
      rowCount: 1
    };
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('platform-migration-service', () => {
  it('applies only pending migrations and records them', async () => {
    const tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, '0001_existing.sql'), 'SELECT 1;\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, '0002_new.sql'), 'CREATE TABLE __SPEC2FLOW_SCHEMA__.test_table (id INT);\n', 'utf8');
    const executor = new RecordingExecutor(['0001_existing.sql']);

    const report = await migratePlatformDatabase(executor, 'spec2flow_platform', tempDir);

    expect(report).toEqual({
      schema: 'spec2flow_platform',
      migrationsDir: tempDir,
      appliedVersions: ['0002_new.sql'],
      skippedVersions: ['0001_existing.sql']
    });
    expect(executor.queries.some((query) => query.text.includes('CREATE SCHEMA IF NOT EXISTS "spec2flow_platform"'))).toBe(true);
    expect(executor.queries.some((query) => query.text.includes('CREATE TABLE "spec2flow_platform".test_table'))).toBe(true);
    expect(executor.queries.some((query) => query.text.includes('INSERT INTO "spec2flow_platform".schema_migrations'))).toBe(true);
  });
});
