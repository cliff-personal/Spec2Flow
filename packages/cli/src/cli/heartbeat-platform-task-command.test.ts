import { describe, expect, it, vi } from 'vitest';

import { runHeartbeatPlatformTask, type HeartbeatPlatformTaskDependencies } from './heartbeat-platform-task-command.js';
import type { HeartbeatPlatformTaskResult } from '../platform/platform-scheduler-service.js';

describe('heartbeat-platform-task-command', () => {
  it('renews the lease and writes the receipt when output is requested', async () => {
    const heartbeatReceipt: HeartbeatPlatformTaskResult = {
      status: 'renewed',
      runId: 'run-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      leaseTtlSeconds: 60,
      heartbeatIntervalSeconds: 20,
      lease: null
    };
    const writeJson = vi.fn();
    const createPlatformPool = vi.fn(() => ({
      end: vi.fn(async () => undefined)
    })) as unknown as HeartbeatPlatformTaskDependencies['createPlatformPool'];
    const withPlatformTransaction = vi.fn(async (_pool, callback: (client: { query: () => Promise<{ rows: never[]; rowCount: number; }> }) => Promise<unknown>) =>
      callback({
        query: async () => ({
          rows: [],
          rowCount: 0
        })
      })) as unknown as HeartbeatPlatformTaskDependencies['withPlatformTransaction'];

    await runHeartbeatPlatformTask({
      'database-url': 'postgresql://local/spec2flow',
      'run-id': 'run-1',
      'task-id': 'task-1',
      'worker-id': 'worker-1',
      output: 'generated/platform-heartbeat.json'
    }, {
      createPlatformPool,
      fail: vi.fn(),
      heartbeatPlatformTask: vi.fn(async () => heartbeatReceipt),
      printJson: vi.fn(),
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      withPlatformTransaction,
      writeJson
    });

    expect(writeJson).toHaveBeenCalledWith('generated/platform-heartbeat.json', {
      platformTaskHeartbeat: heartbeatReceipt
    });
  });
});
