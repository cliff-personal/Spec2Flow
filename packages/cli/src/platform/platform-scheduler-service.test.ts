import { describe, expect, it } from 'vitest';

import {
  expirePlatformLeases,
  getPlatformRunState,
  heartbeatPlatformTask,
  leaseNextPlatformTask,
  startPlatformTask,
  type HeartbeatPlatformTaskResult
} from './platform-scheduler-service.js';
import type { SqlExecutor } from './platform-database.js';
import type { ReviewPolicy } from '../types/review-policy.js';
import type { TaskRoleProfile, TaskStage } from '../types/task-graph.js';

interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

type QueryStep = {
  match: string | RegExp;
  result: QueryResult | ((text: string, values: readonly unknown[] | undefined) => QueryResult | Promise<QueryResult>);
};

interface RecordedQuery {
  text: string;
  values?: readonly unknown[];
}

class SequentialExecutor implements SqlExecutor {
  public readonly calls: RecordedQuery[] = [];

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

const roleProfile: TaskRoleProfile = {
  profileId: 'implementation-agent',
  specialistRole: 'implementation-agent',
  commandPolicy: 'safe-repo-commands',
  canReadRepository: true,
  canEditFiles: true,
  canRunCommands: true,
  canWriteArtifacts: true,
  canOpenCollaboration: false,
  requiredAdapterSupports: [],
  expectedArtifacts: ['implementation-summary']
};

function buildTaskRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    run_id: 'run-1',
    task_id: 'task-1',
    stage: 'requirements-analysis' satisfies TaskStage,
    title: 'Analyze requirements',
    goal: 'Summarize the request',
    executor_type: 'requirements-agent',
    status: 'ready',
    risk_level: 'medium',
    depends_on: [],
    target_files: [],
    verify_commands: [],
    inputs: {},
    role_profile: roleProfile,
    review_policy: null satisfies ReviewPolicy | null,
    artifacts_dir: null,
    attempts: 0,
    retry_count: 0,
    max_retries: 3,
    auto_repair_count: 0,
    max_auto_repair_attempts: 0,
    current_lease_id: null,
    leased_by_worker_id: null,
    lease_expires_at: null,
    last_heartbeat_at: null,
    created_at: '2026-03-24T10:00:00.000Z',
    updated_at: '2026-03-24T10:00:00.000Z',
    started_at: null,
    completed_at: null,
    ...overrides
  };
}

function buildRunRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    run_id: 'run-1',
    repository_id: 'spec2flow',
    workflow_name: 'phase-2-fixture',
    request_text: 'Implement scheduler primitives',
    status: 'running',
    current_stage: 'requirements-analysis',
    risk_level: 'high',
    request_payload: {
      graphId: 'graph-1'
    },
    metadata: {
      createdBy: 'test'
    },
    created_at: '2026-03-24T10:00:00.000Z',
    updated_at: '2026-03-24T10:01:00.000Z',
    started_at: '2026-03-24T10:00:05.000Z',
    completed_at: null,
    ...overrides
  };
}

function buildEventRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    event_id: 'event-1',
    run_id: 'run-1',
    task_id: 'task-1',
    event_type: 'task.leased',
    payload: {
      workerId: 'worker-1'
    },
    created_at: '2026-03-24T10:02:00.000Z',
    ...overrides
  };
}

function buildArtifactRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    artifact_id: 'artifact-1',
    run_id: 'run-1',
    task_id: 'task-1',
    kind: 'report',
    path: '.spec2flow/runtime/report.json',
    schema_type: 'task-report',
    metadata: {},
    created_at: '2026-03-24T10:03:00.000Z',
    ...overrides
  };
}

function listInsertedEventTypes(executor: SequentialExecutor): string[] {
  return executor.calls
    .filter((call) => call.text.includes('INSERT INTO "spec2flow_platform".events'))
    .map((call) => String(call.values?.[3] ?? ''));
}

describe('platform-scheduler-service', () => {
  it('leases the next ready task and records the scheduler event', async () => {
    const executor = new SequentialExecutor([
      {
        match: /WITH candidate AS \(/,
        result: {
          rows: [buildTaskRow({
            status: 'leased',
            attempts: 1,
            current_lease_id: 'lease-1',
            leased_by_worker_id: 'worker-1',
            lease_expires_at: '2026-03-24T10:01:00.000Z',
            last_heartbeat_at: '2026-03-24T10:00:20.000Z'
          })],
          rowCount: 1
        }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".task_attempts',
        result: { rows: [], rowCount: 1 }
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

    const result = await leaseNextPlatformTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      workerId: 'worker-1'
    });

    expect(result.status).toBe('leased');
    expect(result.task?.taskId).toBe('task-1');
    expect(result.lease).toMatchObject({
      taskId: 'task-1',
      workerId: 'worker-1',
      attemptNumber: 1,
      status: 'leased'
    });
    expect(executor.calls[0]?.text).toContain('FOR UPDATE SKIP LOCKED');
    expect(listInsertedEventTypes(executor)).toEqual(['task.leased']);
  });

  it('returns a stable no-ready-task receipt when nothing can be leased', async () => {
    const executor = new SequentialExecutor([
      {
        match: /WITH candidate AS \(/,
        result: {
          rows: [],
          rowCount: 0
        }
      }
    ]);

    const result = await leaseNextPlatformTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      workerId: 'worker-1'
    });

    expect(result).toEqual({
      status: 'no-ready-task',
      runId: 'run-1',
      workerId: 'worker-1',
      leaseTtlSeconds: 60,
      heartbeatIntervalSeconds: 20,
      task: null,
      lease: null
    });
    expect(executor.calls).toHaveLength(1);
  });

  it('renews an active lease for the owning worker', async () => {
    const executor = new SequentialExecutor([
      {
        match: `UPDATE "spec2flow_platform".tasks`,
        result: {
          rows: [buildTaskRow({
            status: 'leased',
            attempts: 1,
            current_lease_id: 'lease-1',
            leased_by_worker_id: 'worker-1',
            lease_expires_at: '2026-03-24T10:02:00.000Z',
            last_heartbeat_at: '2026-03-24T10:01:00.000Z'
          })],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".task_attempts',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await heartbeatPlatformTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'task-1',
      workerId: 'worker-1'
    });

    expect(result.status).toBe('renewed');
    expect(result.lease).toMatchObject({
      taskId: 'task-1',
      workerId: 'worker-1',
      leaseId: 'lease-1'
    });
    expect(listInsertedEventTypes(executor)).toEqual(['task.heartbeat']);
  });

  it('rejects heartbeat attempts from a non-owning worker', async () => {
    const executor = new SequentialExecutor([
      {
        match: `UPDATE "spec2flow_platform".tasks`,
        result: {
          rows: [],
          rowCount: 0
        }
      },
      {
        match: 'SELECT *',
        result: {
          rows: [buildTaskRow({
            status: 'leased',
            current_lease_id: 'lease-1',
            leased_by_worker_id: 'worker-2',
            lease_expires_at: '2026-03-24T10:02:00.000Z',
            last_heartbeat_at: '2026-03-24T10:01:00.000Z'
          })],
          rowCount: 1
        }
      }
    ]);

    const result = await heartbeatPlatformTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'task-1',
      workerId: 'worker-1'
    });

    expect(result).toEqual({
      status: 'rejected',
      runId: 'run-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      leaseTtlSeconds: 60,
      heartbeatIntervalSeconds: 20,
      reason: 'not-owned',
      lease: null
    } satisfies HeartbeatPlatformTaskResult);
  });

  it('starts execution only from an active lease held by the worker', async () => {
    const executor = new SequentialExecutor([
      {
        match: `UPDATE "spec2flow_platform".tasks`,
        result: {
          rows: [buildTaskRow({
            status: 'in-progress',
            attempts: 1,
            current_lease_id: 'lease-1',
            leased_by_worker_id: 'worker-1',
            lease_expires_at: '2026-03-24T10:02:00.000Z',
            last_heartbeat_at: '2026-03-24T10:01:00.000Z',
            started_at: '2026-03-24T10:01:10.000Z'
          })],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".task_attempts',
        result: { rows: [], rowCount: 1 }
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

    const result = await startPlatformTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'task-1',
      workerId: 'worker-1'
    });

    expect(result.status).toBe('started');
    expect(result.lease).toMatchObject({
      taskId: 'task-1',
      workerId: 'worker-1',
      status: 'in-progress'
    });
    expect(listInsertedEventTypes(executor)).toEqual(['task.started']);
  });

  it('requeues expired leases when retry budget remains', async () => {
    const executor = new SequentialExecutor([
      {
        match: `FROM "spec2flow_platform".tasks`,
        result: {
          rows: [buildTaskRow({
            status: 'leased',
            attempts: 1,
            retry_count: 0,
            max_retries: 3,
            current_lease_id: 'lease-1',
            leased_by_worker_id: 'worker-1',
            lease_expires_at: '2026-03-24T09:59:00.000Z',
            last_heartbeat_at: '2026-03-24T09:58:00.000Z'
          })],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".task_attempts',
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

    const result = await expirePlatformLeases(executor, 'spec2flow_platform', {
      runId: 'run-1'
    });

    expect(result).toEqual({
      status: 'completed',
      runId: 'run-1',
      expiredLeaseCount: 1,
      requeuedTaskIds: ['task-1'],
      blockedTaskIds: [],
      eventsWritten: 3
    });
    expect(listInsertedEventTypes(executor)).toEqual([
      'task.lease-expired',
      'task.retry-scheduled',
      'task.requeued'
    ]);
  });

  it('blocks expired leases when retry budget is exhausted', async () => {
    const executor = new SequentialExecutor([
      {
        match: `FROM "spec2flow_platform".tasks`,
        result: {
          rows: [buildTaskRow({
            status: 'in-progress',
            attempts: 4,
            retry_count: 3,
            max_retries: 3,
            current_lease_id: 'lease-1',
            leased_by_worker_id: 'worker-1',
            lease_expires_at: '2026-03-24T09:59:00.000Z',
            last_heartbeat_at: '2026-03-24T09:58:00.000Z'
          })],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".task_attempts',
        result: { rows: [], rowCount: 1 }
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

    const result = await expirePlatformLeases(executor, 'spec2flow_platform', {
      runId: 'run-1'
    });

    expect(result).toEqual({
      status: 'completed',
      runId: 'run-1',
      expiredLeaseCount: 1,
      requeuedTaskIds: [],
      blockedTaskIds: ['task-1'],
      eventsWritten: 2
    });
    expect(listInsertedEventTypes(executor)).toEqual([
      'task.lease-expired',
      'task.retry-exhausted'
    ]);
  });

  it('returns a DB-backed run state snapshot with tasks, events, and artifacts', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".runs',
        result: {
          rows: [buildRunRow()],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [buildTaskRow({
            status: 'leased',
            attempts: 1,
            retry_count: 1,
            max_retries: 3,
            current_lease_id: 'lease-1',
            leased_by_worker_id: 'worker-1',
            lease_expires_at: '2026-03-24T10:05:00.000Z',
            last_heartbeat_at: '2026-03-24T10:04:00.000Z'
          })],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".events',
        result: {
          rows: [buildEventRow()],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".artifacts',
        result: {
          rows: [buildArtifactRow()],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".repair_attempts',
        result: {
          rows: [],
          rowCount: 0
        }
      }
    ]);

    const result = await getPlatformRunState(executor, 'spec2flow_platform', {
      runId: 'run-1',
      eventLimit: 10
    });

    expect(result.run).toMatchObject({
      runId: 'run-1',
      status: 'running',
      currentStage: 'requirements-analysis'
    });
    expect(result.tasks[0]).toMatchObject({
      taskId: 'task-1',
      leasedByWorkerId: 'worker-1',
      retryCount: 1,
      maxRetries: 3
    });
    expect(result.recentEvents[0]).toMatchObject({
      eventType: 'task.leased'
    });
    expect(result.artifacts[0]).toMatchObject({
      artifactId: 'artifact-1',
      path: '.spec2flow/runtime/report.json'
    });
    expect(result.repairAttempts).toEqual([]);
  });
});
