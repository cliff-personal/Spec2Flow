import fs from 'node:fs';
import path from 'node:path';
import { rootDir } from '../shared/fs-utils.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';

export interface PlatformMigrationFile {
  version: string;
  fileName: string;
  filePath: string;
  sql: string;
}

export interface PlatformMigrationReport {
  schema: string;
  migrationsDir: string;
  appliedVersions: string[];
  skippedVersions: string[];
}

interface SchemaMigrationRow extends Record<string, unknown> {
  version: string;
}

export function getDefaultPlatformMigrationsDir(): string {
  return path.join(rootDir, 'packages/cli/src/platform/migrations');
}

export function loadPlatformMigrationFiles(migrationsDir: string): PlatformMigrationFile[] {
  return fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const filePath = path.join(migrationsDir, entry.name);
      return {
        version: entry.name,
        fileName: entry.name,
        filePath,
        sql: fs.readFileSync(filePath, 'utf8')
      };
    })
    .sort((left, right) => left.version.localeCompare(right.version));
}

function renderMigrationSql(sql: string, schema: string): string {
  return sql.replaceAll('__SPEC2FLOW_SCHEMA__', quoteSqlIdentifier(schema));
}

export async function ensurePlatformMigrationState(executor: SqlExecutor, schema: string): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);

  await executor.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
  await executor.query(`
    CREATE TABLE IF NOT EXISTS ${quotedSchema}.schema_migrations (
      version TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function getAppliedPlatformMigrationVersions(executor: SqlExecutor, schema: string): Promise<Set<string>> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<SchemaMigrationRow>(`
    SELECT version
    FROM ${quotedSchema}.schema_migrations
    ORDER BY version ASC
  `);

  return new Set(result.rows.map((row) => row.version));
}

export async function migratePlatformDatabase(
  executor: SqlExecutor,
  schema: string,
  migrationsDir: string
): Promise<PlatformMigrationReport> {
  await ensurePlatformMigrationState(executor, schema);

  const migrationFiles = loadPlatformMigrationFiles(migrationsDir);
  const appliedVersions = await getAppliedPlatformMigrationVersions(executor, schema);
  const executedVersions: string[] = [];
  const skippedVersions: string[] = [];
  const quotedSchema = quoteSqlIdentifier(schema);

  for (const migration of migrationFiles) {
    if (appliedVersions.has(migration.version)) {
      skippedVersions.push(migration.version);
      continue;
    }

    await executor.query(renderMigrationSql(migration.sql, schema));
    await executor.query(
      `INSERT INTO ${quotedSchema}.schema_migrations (version, file_name) VALUES ($1, $2)`,
      [migration.version, migration.fileName]
    );
    executedVersions.push(migration.version);
  }

  return {
    schema,
    migrationsDir,
    appliedVersions: executedVersions,
    skippedVersions
  };
}
