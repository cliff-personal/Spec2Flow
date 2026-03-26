import { describe, expect, it } from 'vitest';

import {
  pausePlatformControlPlaneRun,
  approvePlatformControlPlaneTask,
  resumePlatformControlPlaneRun,
  resumePlatformControlPlaneRunFromTargetStage,
  retryPlatformControlPlaneTask
} from './platform-control-plane-action-service.js';
import type { SqlExecutor } from './platform-database.js';

interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

type QueryStep = {
  match: string | RegExp;
  result: QueryResult;
};

class SequentialExecutor implements SqlExecutor {
  public readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];

  constructor(private readonly steps: QueryStep[]) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    const normalizedText = text.trim();
    this.calls.push(values ? { text: normalizedText, values } : { text: normalizedText });
    const step = this.steps.shift();
    if (!step) {
      throw new Error(`Unexpected query: ${normalizedText}`);
    }

    const matched = typeof step.match === 'string'
      ? normalizedText.includes(step.match)
      : step.match.test(normalizedText);
    if (!matched) {
      throw new Error(`Query did not match expectation. Expected ${String(step.match)} but received ${normalizedText}`);
    }

    return {
      rows: step.result.rows as Row[],
      rowCount: step.result.rowCount
    };
  }
}

describe('platform-control-plane-action-service', () => {
  it('requeues a blocked task for operator retry', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'task-1',
            stage: 'code-implementation',
            status: 'blocked',
            retry_count: 1,
            max_retries: 3,
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [{
            task_id: 'task-1',
            stage: 'code-implementation',
            status: 'ready',
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await retryPlatformControlPlaneTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'task-1',
      actor: 'operator-1'
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'retry',
      taskStatus: 'ready',
      runStatus: 'running',
      currentStage: 'code-implementation'
    }));
  });

  it('clears stale evaluator reroute fields when retrying an evaluation task', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'frontend-smoke--evaluation',
            stage: 'evaluation',
            status: 'blocked',
            retry_count: 0,
            max_retries: 3,
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [{
            task_id: 'frontend-smoke--evaluation',
            stage: 'evaluation',
            status: 'ready',
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    await retryPlatformControlPlaneTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'frontend-smoke--evaluation',
      actor: 'operator-1'
    });

    expect(executor.calls[1]?.values?.[4]).toBe(true);
    expect(executor.calls[1]?.text).toContain('evaluation_decision = CASE WHEN $5 THEN NULL ELSE evaluation_decision END');
  });

  it('approves a pending publication gate and completes the run', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            status: 'blocked',
            retry_count: 0,
            max_retries: 3,
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".publications',
        result: {
          rows: [{
            publication_id: 'publication-1',
            run_id: 'run-1',
            publish_mode: 'manual-handoff',
            status: 'approval-required',
            metadata: {
              taskId: 'frontend-smoke--collaboration',
              gateReason: 'human-approval-required'
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".publications',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [{
            task_id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            status: 'completed',
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await approvePlatformControlPlaneTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'frontend-smoke--collaboration',
      actor: 'operator-1',
      note: 'approved for manual handoff'
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'approve',
      taskStatus: 'completed',
      runStatus: 'completed',
      currentStage: null,
      publicationId: 'publication-1',
      publicationStatus: 'published'
    }));
  });

  it('rearms the target stage when resuming from the latest evaluator reroute', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'SELECT run_id, status, current_stage, metadata',
        result: {
          rows: [{
            run_id: 'run-1',
            status: 'blocked',
            current_stage: 'evaluation',
            metadata: {
              controlPlane: {
                paused: true
              }
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'SELECT task_id, requested_repair_target_stage',
        result: {
          rows: [{
            task_id: 'frontend-smoke--evaluation',
            requested_repair_target_stage: 'automated-execution'
          }],
          rowCount: 1
        }
      },
      {
        match: 'SELECT task_id, stage',
        result: {
          rows: [
            { task_id: 'frontend-smoke--automated-execution', stage: 'automated-execution' },
            { task_id: 'frontend-smoke--defect-feedback', stage: 'defect-feedback' },
            { task_id: 'frontend-smoke--collaboration', stage: 'collaboration' },
            { task_id: 'frontend-smoke--evaluation', stage: 'evaluation' }
          ],
          rowCount: 4
        }
      },
      {
        match: "SET status = 'ready'",
        result: { rows: [], rowCount: 1 }
      },
      {
        match: "SET status = 'pending'",
        result: { rows: [], rowCount: 3 }
      },
      {
        match: 'SET metadata = $2::jsonb',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [{
            task_id: 'frontend-smoke--automated-execution',
            stage: 'automated-execution',
            status: 'ready',
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'SET status = $2,',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await resumePlatformControlPlaneRunFromTargetStage(executor, 'spec2flow_platform', {
      runId: 'run-1',
      actor: 'operator-1',
      note: 'Resume from queue reroute button'
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'resume-from-target-stage',
      runStatus: 'running',
      currentStage: 'automated-execution',
      paused: false,
      rerouteTargetStage: 'automated-execution'
    }));
    expect(executor.calls[4]?.text).toContain('evaluation_decision = CASE WHEN stage = \'evaluation\' THEN NULL ELSE evaluation_decision END');
  });

  it('keeps the run running when approval unblocks a route but another blocked task has a ready follow-up', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'schema-contracts--collaboration',
            stage: 'collaboration',
            status: 'blocked',
            retry_count: 0,
            max_retries: 3,
            created_at: '2026-03-24T12:03:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".publications',
        result: {
          rows: [{
            publication_id: 'publication-2',
            run_id: 'run-1',
            publish_mode: 'manual-handoff',
            status: 'approval-required',
            metadata: {
              taskId: 'schema-contracts--collaboration',
              gateReason: 'human-approval-required'
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".publications',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [
            {
              task_id: 'cli-runtime--code-implementation',
              stage: 'code-implementation',
              status: 'blocked',
              created_at: '2026-03-24T12:00:00.000Z'
            },
            {
              task_id: 'cli-runtime--defect-feedback',
              stage: 'defect-feedback',
              status: 'ready',
              created_at: '2026-03-24T12:01:00.000Z'
            },
            {
              task_id: 'schema-contracts--collaboration',
              stage: 'collaboration',
              status: 'completed',
              created_at: '2026-03-24T12:03:00.000Z'
            }
          ],
          rowCount: 3
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await approvePlatformControlPlaneTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'schema-contracts--collaboration',
      actor: 'operator-1'
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'approve',
      taskStatus: 'completed',
      runStatus: 'running',
      currentStage: 'defect-feedback',
      publicationId: 'publication-2',
      publicationStatus: 'published'
    }));
  });

  it('completes the run when a previously blocked route has already finished collaboration', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'schema-contracts--collaboration',
            stage: 'collaboration',
            status: 'blocked',
            retry_count: 0,
            max_retries: 3,
            created_at: '2026-03-24T12:03:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".publications',
        result: {
          rows: [{
            publication_id: 'publication-3',
            run_id: 'run-1',
            publish_mode: 'manual-handoff',
            status: 'approval-required',
            metadata: {
              taskId: 'schema-contracts--collaboration',
              gateReason: 'human-approval-required'
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".publications',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [
            {
              task_id: 'cli-runtime--code-implementation',
              stage: 'code-implementation',
              status: 'blocked',
              created_at: '2026-03-24T12:00:00.000Z'
            },
            {
              task_id: 'cli-runtime--defect-feedback',
              stage: 'defect-feedback',
              status: 'completed',
              created_at: '2026-03-24T12:01:00.000Z'
            },
            {
              task_id: 'cli-runtime--collaboration',
              stage: 'collaboration',
              status: 'completed',
              created_at: '2026-03-24T12:02:00.000Z'
            },
            {
              task_id: 'schema-contracts--collaboration',
              stage: 'collaboration',
              status: 'completed',
              created_at: '2026-03-24T12:03:00.000Z'
            }
          ],
          rowCount: 4
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await approvePlatformControlPlaneTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'schema-contracts--collaboration',
      actor: 'operator-1'
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'approve',
      taskStatus: 'completed',
      runStatus: 'completed',
      currentStage: null,
      publicationId: 'publication-3',
      publicationStatus: 'published'
    }));
  });

  it('pauses and resumes a run through metadata-backed control plane state', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".runs',
        result: {
          rows: [{
            run_id: 'run-1',
            status: 'running',
            current_stage: 'automated-execution',
            metadata: {}
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'FROM "spec2flow_platform".runs',
        result: {
          rows: [{
            run_id: 'run-1',
            status: 'running',
            current_stage: 'automated-execution',
            metadata: {
              controlPlane: {
                paused: true,
                pausedBy: 'operator-1'
              }
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const pauseResult = await pausePlatformControlPlaneRun(executor, 'spec2flow_platform', {
      runId: 'run-1',
      actor: 'operator-1',
      note: 'pause for maintenance'
    });
    const resumeResult = await resumePlatformControlPlaneRun(executor, 'spec2flow_platform', {
      runId: 'run-1',
      actor: 'operator-1',
      note: 'resume after maintenance'
    });

    expect(pauseResult).toEqual({
      action: 'pause',
      runId: 'run-1',
      runStatus: 'running',
      currentStage: 'automated-execution',
      paused: true
    });
    expect(resumeResult).toEqual({
      action: 'resume',
      runId: 'run-1',
      runStatus: 'running',
      currentStage: 'automated-execution',
      paused: false
    });
  });
});
