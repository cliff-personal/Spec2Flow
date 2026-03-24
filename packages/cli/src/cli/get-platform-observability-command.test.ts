import { describe, expect, it, vi } from 'vitest';

import { runGetPlatformObservability, type GetPlatformObservabilityDependencies } from './get-platform-observability-command.js';

describe('get-platform-observability-command', () => {
  it('loads the observability read model and writes it to disk when requested', async () => {
    const writeJson = vi.fn();
    const createPlatformPool = vi.fn(() => ({
      end: vi.fn(async () => undefined)
    })) as unknown as GetPlatformObservabilityDependencies['createPlatformPool'];
    const withPlatformTransaction = vi.fn(async (_pool, callback: (client: { query: () => Promise<{ rows: never[]; rowCount: number; }> }) => Promise<unknown>) =>
      callback({
        query: async () => ({
          rows: [],
          rowCount: 0
        })
      })) as unknown as GetPlatformObservabilityDependencies['withPlatformTransaction'];

    await runGetPlatformObservability({
      'database-url': 'postgresql://local/spec2flow',
      'run-id': 'run-1',
      output: 'generated/platform-observability.json'
    }, {
      createPlatformPool,
      fail: vi.fn(),
      getPlatformObservability: vi.fn(async () => ({
        taxonomyVersion: 'phase-6-v1',
        run: null,
        metrics: {
          runDurationSeconds: null,
          latestEventAt: null,
          tasks: {
            total: 0,
            pending: 0,
            ready: 0,
            leased: 0,
            inProgress: 0,
            blocked: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
            retryableFailed: 0,
            cancelled: 0
          },
          repairs: {
            total: 0,
            requested: 0,
            succeeded: 0,
            failed: 0,
            blocked: 0,
            failureClassFrequency: {}
          },
          publications: {
            total: 0,
            published: 0,
            approvalRequired: 0,
            blocked: 0
          },
          artifacts: {
            total: 0,
            expected: 0,
            tasksWithMissingExpectedArtifacts: 0
          },
          retries: {
            executionRetryCount: 0,
            autoRepairCount: 0
          },
          events: {
            recentCount: 0,
            byCategory: {
              run: 0,
              planning: 0,
              task: 0,
              artifact: 0,
              repair: 0,
              publication: 0,
              approval: 0,
              unknown: 0
            }
          }
        },
        timeline: [],
        taskSummaries: [],
        recentEvents: [],
        repairs: [],
        publications: [],
        attentionRequired: []
      })),
      printJson: vi.fn(),
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      withPlatformTransaction,
      writeJson
    });

    expect(writeJson).toHaveBeenCalledWith('generated/platform-observability.json', {
      platformObservability: expect.objectContaining({
        taxonomyVersion: 'phase-6-v1',
        timeline: [],
        taskSummaries: []
      })
    });
  });
});
