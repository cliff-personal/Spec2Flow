import { describe, expect, it } from 'vitest';

import { reconcilePlatformAutoRepair } from './platform-auto-repair-service.js';
import type { SqlExecutor } from './platform-database.js';
import type { ExecutionStateDocument } from '../types/index.js';

interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

type QueryStep = {
  match: string | RegExp;
  result: QueryResult | ((text: string, values?: readonly unknown[]) => QueryResult | Promise<QueryResult>);
};

class SequentialExecutor implements SqlExecutor {
  public readonly calls: Array<{ text: string; values?: readonly unknown[]; }> = [];

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
      throw new Error(`Query did not match expectation.\nExpected: ${String(step.match)}\nReceived: ${normalizedText}`);
    }

    const result = typeof step.result === 'function'
      ? await step.result(normalizedText, values)
      : step.result;

    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount
    };
  }
}

function createState(taskStatus: 'pending' | 'ready' | 'completed' | 'failed' | 'blocked', notes: string[] = []): ExecutionStateDocument {
  return {
    executionState: {
      runId: 'run-1',
      workflowName: 'workflow',
      status: 'running',
      tasks: [
        {
          taskId: 'frontend-smoke--code-implementation',
          status: taskStatus,
          notes
        }
      ],
      artifacts: [],
      errors: []
    }
  };
}

describe('platform-auto-repair-service', () => {
  it('persists a requested repair attempt when a new auto-repair attempt appears in task notes', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'INSERT INTO "spec2flow_platform".repair_attempts',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await reconcilePlatformAutoRepair(executor, 'spec2flow_platform', {
      runId: 'run-1',
      currentTaskId: 'frontend-smoke--defect-feedback',
      previousState: createState('blocked'),
      nextState: createState('ready', [
        'auto-repair-attempt:1',
        'auto-repair-class:implementation-defect',
        'auto-repair-reason:fix-implementation'
      ])
    });

    expect(result.requestedRepairAttempts).toBe(1);
    expect(result.eventsWritten).toBe(1);
  });

  it('marks an open repair attempt as succeeded when the repaired task completes', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".repair_attempts',
        result: {
          rows: [
            {
              repair_attempt_id: 'repair-1',
              run_id: 'run-1',
              source_task_id: 'frontend-smoke--code-implementation',
              trigger_task_id: 'frontend-smoke--defect-feedback',
              source_stage: 'code-implementation',
              failure_class: 'implementation-defect',
              recommended_action: 'fix-implementation',
              attempt_number: 1,
              status: 'requested',
              metadata: {},
              created_at: '2026-03-24T00:00:00.000Z',
              updated_at: '2026-03-24T00:00:00.000Z',
              completed_at: null
            }
          ],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".repair_attempts',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await reconcilePlatformAutoRepair(executor, 'spec2flow_platform', {
      runId: 'run-1',
      currentTaskId: 'frontend-smoke--code-implementation',
      previousState: createState('ready', ['auto-repair-attempt:1']),
      nextState: createState('completed', ['auto-repair-attempt:1'])
    });

    expect(result.resolvedRepairAttempts).toBe(1);
    expect(result.blockedRepairAttempts).toBe(0);
    expect(result.eventsWritten).toBe(1);
  });
});
