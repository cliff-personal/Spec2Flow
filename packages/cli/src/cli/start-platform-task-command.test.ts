import { describe, expect, it, vi } from 'vitest';

import { runStartPlatformTask, type StartPlatformTaskDependencies } from './start-platform-task-command.js';
import type { StartPlatformTaskResult } from '../platform/platform-scheduler-service.js';

describe('start-platform-task-command', () => {
  it('starts the leased task and prints the receipt', async () => {
    const startReceipt: StartPlatformTaskResult = {
      status: 'started',
      runId: 'run-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      leaseTtlSeconds: 60,
      heartbeatIntervalSeconds: 20,
      lease: null
    };
    const printJson = vi.fn();
    const createPlatformPool = vi.fn(() => ({
      end: vi.fn(async () => undefined)
    })) as unknown as StartPlatformTaskDependencies['createPlatformPool'];
    const withPlatformTransaction = vi.fn(async (_pool, callback: (client: { query: () => Promise<{ rows: never[]; rowCount: number; }> }) => Promise<unknown>) =>
      callback({
        query: async () => ({
          rows: [],
          rowCount: 0
        })
      })) as unknown as StartPlatformTaskDependencies['withPlatformTransaction'];

    await runStartPlatformTask({
      'database-url': 'postgresql://local/spec2flow',
      'run-id': 'run-1',
      'task-id': 'task-1',
      'worker-id': 'worker-1'
    }, {
      createPlatformPool,
      fail: vi.fn(),
      printJson,
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      startPlatformTask: vi.fn(async () => startReceipt),
      withPlatformTransaction,
      writeJson: vi.fn()
    });

    expect(printJson).toHaveBeenCalledWith({
      platformTaskStart: startReceipt
    });
  });
});
