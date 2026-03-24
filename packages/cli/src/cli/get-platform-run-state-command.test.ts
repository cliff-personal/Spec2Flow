import { describe, expect, it, vi } from 'vitest';

import { runGetPlatformRunState, type GetPlatformRunStateDependencies } from './get-platform-run-state-command.js';

describe('get-platform-run-state-command', () => {
  it('loads the run snapshot and writes it to disk when requested', async () => {
    const writeJson = vi.fn();
    const createPlatformPool = vi.fn(() => ({
      end: vi.fn(async () => undefined)
    })) as unknown as GetPlatformRunStateDependencies['createPlatformPool'];
    const withPlatformTransaction = vi.fn(async (_pool, callback: (client: { query: () => Promise<{ rows: never[]; rowCount: number; }> }) => Promise<unknown>) =>
      callback({
        query: async () => ({
          rows: [],
          rowCount: 0
        })
      })) as unknown as GetPlatformRunStateDependencies['withPlatformTransaction'];

    await runGetPlatformRunState({
      'database-url': 'postgresql://local/spec2flow',
      'run-id': 'run-1',
      output: 'generated/platform-run-state.json'
    }, {
      createPlatformPool,
      fail: vi.fn(),
      getPlatformRunState: vi.fn(async () => ({
        run: null,
        tasks: [],
        recentEvents: [],
        artifacts: [],
        repairAttempts: [],
        publications: []
      })),
      printJson: vi.fn(),
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      withPlatformTransaction,
      writeJson
    });

    expect(writeJson).toHaveBeenCalledWith('generated/platform-run-state.json', {
      platformRunState: {
        run: null,
        tasks: [],
        recentEvents: [],
        artifacts: [],
        repairAttempts: [],
        publications: []
      }
    });
  });
});
