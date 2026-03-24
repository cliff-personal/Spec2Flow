import { describe, expect, it } from 'vitest';

import { quoteSqlIdentifier, resolvePlatformDatabaseConfig } from './platform-database.js';

describe('platform-database', () => {
  it('resolves the platform database config from CLI options first', () => {
    const config = resolvePlatformDatabaseConfig({
      'database-url': 'postgresql://local/test',
      'database-schema': 'spec2flow_runtime'
    }, {
      SPEC2FLOW_DATABASE_URL: 'postgresql://ignored/env',
      SPEC2FLOW_DATABASE_SCHEMA: 'ignored_schema'
    });

    expect(config).toEqual({
      connectionString: 'postgresql://local/test',
      schema: 'spec2flow_runtime'
    });
  });

  it('falls back to environment variables and the default schema', () => {
    const config = resolvePlatformDatabaseConfig({}, {
      SPEC2FLOW_DATABASE_URL: 'postgresql://env/runtime'
    });

    expect(config).toEqual({
      connectionString: 'postgresql://env/runtime',
      schema: 'spec2flow_platform'
    });
  });

  it('quotes safe identifiers and rejects unsafe ones', () => {
    expect(quoteSqlIdentifier('spec2flow_platform')).toBe('"spec2flow_platform"');
    expect(() => quoteSqlIdentifier('spec2flow-platform')).toThrow('invalid SQL identifier');
  });
});
