import process from 'node:process';
import { Pool, type PoolClient } from 'pg';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{
    rows: Row[];
    rowCount: number | null;
  }>;
}

export interface PlatformDatabaseConfig {
  connectionString?: string;
  schema: string;
}

export function quoteSqlIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`invalid SQL identifier: ${value}`);
  }

  return `"${value}"`;
}

export function resolvePlatformDatabaseConfig(
  options: CliOptions,
  env: NodeJS.ProcessEnv = process.env
): PlatformDatabaseConfig {
  const connectionString = typeof options['database-url'] === 'string'
    ? options['database-url']
    : env.SPEC2FLOW_DATABASE_URL ?? env.DATABASE_URL;
  const schema = typeof options['database-schema'] === 'string'
    ? options['database-schema']
    : env.SPEC2FLOW_DATABASE_SCHEMA ?? 'spec2flow_platform';

  return {
    ...(connectionString ? { connectionString } : {}),
    schema
  };
}

export function createPlatformPool(config: PlatformDatabaseConfig): Pool {
  if (config.connectionString) {
    return new Pool({
      connectionString: config.connectionString
    });
  }

  return new Pool();
}

export async function withPlatformPool<T>(
  config: PlatformDatabaseConfig,
  fn: (pool: Pool) => Promise<T>
): Promise<T> {
  const pool = createPlatformPool(config);

  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

export async function withPlatformTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
