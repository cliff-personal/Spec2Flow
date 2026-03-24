import { describe, expect, it, vi } from 'vitest';

import { runExpirePlatformLeases, type ExpirePlatformLeasesDependencies } from './expire-platform-leases-command.js';
import type { ExpirePlatformLeasesResult } from '../platform/platform-scheduler-service.js';

describe('expire-platform-leases-command', () => {
  it('runs the expiration sweep and prints the receipt', async () => {
    const sweepReceipt: ExpirePlatformLeasesResult = {
      status: 'completed',
      runId: 'run-1',
      expiredLeaseCount: 1,
      requeuedTaskIds: ['task-1'],
      blockedTaskIds: [],
      eventsWritten: 3
    };
    const printJson = vi.fn();
    const createPlatformPool = vi.fn(() => ({
      end: vi.fn(async () => undefined)
    })) as unknown as ExpirePlatformLeasesDependencies['createPlatformPool'];
    const withPlatformTransaction = vi.fn(async (_pool, callback: (client: { query: () => Promise<{ rows: never[]; rowCount: number; }> }) => Promise<unknown>) =>
      callback({
        query: async () => ({
          rows: [],
          rowCount: 0
        })
      })) as unknown as ExpirePlatformLeasesDependencies['withPlatformTransaction'];

    await runExpirePlatformLeases({
      'database-url': 'postgresql://local/spec2flow',
      'run-id': 'run-1'
    }, {
      createPlatformPool,
      expirePlatformLeases: vi.fn(async () => sweepReceipt),
      fail: vi.fn(),
      printJson,
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      withPlatformTransaction,
      writeJson: vi.fn()
    });

    expect(printJson).toHaveBeenCalledWith({
      platformLeaseExpirationSweep: sweepReceipt
    });
  });
});
