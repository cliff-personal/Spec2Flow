import { describe, expect, it, vi } from 'vitest';

import { runLeaseNextPlatformTask, type LeaseNextPlatformTaskDependencies } from './lease-next-platform-task-command.js';
import type { LeaseNextPlatformTaskResult } from '../platform/platform-scheduler-service.js';

describe('lease-next-platform-task-command', () => {
  it('leases the next task and prints the receipt', async () => {
    const leaseReceipt: LeaseNextPlatformTaskResult = {
      status: 'leased',
      runId: 'run-1',
      workerId: 'worker-1',
      leaseTtlSeconds: 60,
      heartbeatIntervalSeconds: 20,
      task: null,
      lease: null
    };
    const printJson = vi.fn();
    const createPlatformPool = vi.fn(() => ({
      end: vi.fn(async () => undefined)
    })) as unknown as LeaseNextPlatformTaskDependencies['createPlatformPool'];
    const withPlatformTransaction = vi.fn(async (_pool, callback: (client: { query: () => Promise<{ rows: never[]; rowCount: number; }> }) => Promise<unknown>) =>
      callback({
        query: async () => ({
          rows: [],
          rowCount: 0
        })
      })) as unknown as LeaseNextPlatformTaskDependencies['withPlatformTransaction'];

    await runLeaseNextPlatformTask({
      'database-url': 'postgresql://local/spec2flow',
      'run-id': 'run-1',
      'worker-id': 'worker-1'
    }, {
      createPlatformPool,
      fail: vi.fn(),
      leaseNextPlatformTask: vi.fn(async () => leaseReceipt),
      printJson,
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      withPlatformTransaction,
      writeJson: vi.fn()
    });

    expect(createPlatformPool).toHaveBeenCalled();
    expect(withPlatformTransaction).toHaveBeenCalled();
    expect(printJson).toHaveBeenCalledWith({
      platformTaskLease: leaseReceipt
    });
  });
});
