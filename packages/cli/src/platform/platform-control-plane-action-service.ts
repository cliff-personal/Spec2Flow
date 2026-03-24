import { randomUUID } from 'node:crypto';
import { insertPlatformEvents } from './platform-repository.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import { DEFAULT_PLATFORM_MAX_RETRIES } from './platform-scheduler-service.js';
import { PLATFORM_EVENT_TYPES } from './platform-event-taxonomy.js';
import type {
  PlatformControlPlaneTaskActionResult,
  PlatformEventRecord,
  PlatformRunRecord,
  PlatformTaskRecord
} from '../types/index.js';

type DbTimestamp = Date | string | null;

interface PlatformTaskActionRow extends Record<string, unknown> {
  run_id: string;
  task_id: string;
  stage: PlatformTaskRecord['stage'];
  status: PlatformTaskRecord['status'];
  retry_count: number;
  max_retries: number;
  created_at: DbTimestamp;
}

interface PlatformPublicationActionRow extends Record<string, unknown> {
  publication_id: string;
  run_id: string;
  publish_mode: string;
  status: string;
  metadata: Record<string, unknown>;
}

interface PlatformTaskProgressRow extends Record<string, unknown> {
  task_id: string;
  stage: PlatformTaskRecord['stage'];
  status: PlatformTaskRecord['status'];
  created_at: DbTimestamp;
}

export interface PlatformControlPlaneTaskActionOptions {
  runId: string;
  taskId: string;
  actor?: string;
  note?: string;
}

export class PlatformControlPlaneActionError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PlatformControlPlaneActionError';
    this.code = code;
    this.statusCode = statusCode;
    if (details) {
      this.details = details;
    }
  }
}

function buildActionPayload(options: PlatformControlPlaneTaskActionOptions, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...extra,
    ...(options.actor ? { actor: options.actor } : {}),
    ...(options.note ? { note: options.note } : {})
  };
}

async function getTaskActionRow(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneTaskActionOptions
): Promise<PlatformTaskActionRow | null> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<PlatformTaskActionRow>(
    `
      SELECT run_id, task_id, stage, status, retry_count, max_retries, created_at
      FROM ${quotedSchema}.tasks
      WHERE run_id = $1 AND task_id = $2
      LIMIT 1
    `,
    [options.runId, options.taskId]
  );

  return result.rows[0] ?? null;
}

async function getPublicationActionRow(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneTaskActionOptions
): Promise<PlatformPublicationActionRow | null> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<PlatformPublicationActionRow>(
    `
      SELECT publication_id, run_id, publish_mode, status, metadata
      FROM ${quotedSchema}.publications
      WHERE run_id = $1
        AND metadata ->> 'taskId' = $2
      ORDER BY updated_at DESC, publication_id DESC
      LIMIT 1
    `,
    [options.runId, options.taskId]
  );

  return result.rows[0] ?? null;
}

function normalizeTimestamp(value: DbTimestamp): number {
  if (value instanceof Date) {
    return value.valueOf();
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function inferRunProgress(taskRows: PlatformTaskProgressRow[]): {
  status: PlatformRunRecord['status'];
  currentStage: PlatformRunRecord['currentStage'];
} {
  const orderedRows = [...taskRows].sort((left, right) => {
    const timestampDelta = normalizeTimestamp(left.created_at) - normalizeTimestamp(right.created_at);
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return left.task_id.localeCompare(right.task_id);
  });
  const activeRows = orderedRows.filter((row) => !['completed', 'skipped'].includes(row.status));
  const firstActiveStage = activeRows[0]?.stage ?? null;

  if (activeRows.length === 0) {
    return {
      status: 'completed',
      currentStage: null
    };
  }

  if (activeRows.some((row) => ['blocked', 'failed', 'cancelled'].includes(row.status))) {
    return {
      status: 'blocked',
      currentStage: activeRows.find((row) => ['blocked', 'failed', 'cancelled'].includes(row.status))?.stage ?? firstActiveStage
    };
  }

  if (activeRows.every((row) => row.status === 'pending')) {
    return {
      status: 'pending',
      currentStage: firstActiveStage
    };
  }

  return {
    status: 'running',
    currentStage: firstActiveStage
  };
}

async function getUpdatedRunProgress(
  executor: SqlExecutor,
  schema: string,
  runId: string
): Promise<{
  status: PlatformRunRecord['status'];
  currentStage: PlatformRunRecord['currentStage'];
}> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<PlatformTaskProgressRow>(
    `
      SELECT task_id, stage, status, created_at
      FROM ${quotedSchema}.tasks
      WHERE run_id = $1
      ORDER BY created_at ASC, task_id ASC
    `,
    [runId]
  );

  return inferRunProgress(result.rows);
}

async function updateRunProgress(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  progress: {
    status: PlatformRunRecord['status'];
    currentStage: PlatformRunRecord['currentStage'];
  }
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.runs
      SET status = $2,
          current_stage = $3,
          updated_at = NOW(),
          started_at = COALESCE(started_at, NOW()),
          completed_at = CASE
            WHEN $2 IN ('completed', 'failed', 'cancelled') THEN COALESCE(completed_at, NOW())
            ELSE NULL
          END
      WHERE run_id = $1
    `,
    [runId, progress.status, progress.currentStage]
  );
}

async function updateTaskStatus(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneTaskActionOptions,
  status: PlatformTaskRecord['status'],
  retryCount?: number
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.tasks
      SET status = $3,
          retry_count = COALESCE($4, retry_count),
          current_lease_id = NULL,
          leased_by_worker_id = NULL,
          lease_expires_at = NULL,
          last_heartbeat_at = NULL,
          updated_at = NOW(),
          completed_at = CASE
            WHEN $3 IN ('completed', 'failed', 'blocked', 'skipped', 'cancelled') THEN COALESCE(completed_at, NOW())
            ELSE NULL
          END
      WHERE run_id = $1
        AND task_id = $2
    `,
    [options.runId, options.taskId, status, retryCount ?? null]
  );
}

async function updatePublication(
  executor: SqlExecutor,
  schema: string,
  publicationId: string,
  runId: string,
  status: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.publications
      SET status = $3,
          metadata = $4::jsonb,
          updated_at = NOW()
      WHERE publication_id = $1
        AND run_id = $2
    `,
    [publicationId, runId, status, JSON.stringify(metadata)]
  );
}

export async function retryPlatformControlPlaneTask(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneTaskActionOptions
): Promise<PlatformControlPlaneTaskActionResult | null> {
  const task = await getTaskActionRow(executor, schema, options);
  if (!task) {
    return null;
  }

  if (!['failed', 'blocked', 'retryable-failed', 'cancelled'].includes(task.status)) {
    throw new PlatformControlPlaneActionError(
      'invalid-task-action',
      `Task ${options.taskId} cannot be retried from status ${task.status}`,
      409,
      {
        runId: options.runId,
        taskId: options.taskId,
        status: task.status,
        action: 'retry'
      }
    );
  }

  const nextRetryCount = task.retry_count + 1;
  await updateTaskStatus(executor, schema, options, 'ready', nextRetryCount);

  const progress = await getUpdatedRunProgress(executor, schema, options.runId);
  await updateRunProgress(executor, schema, options.runId, progress);

  const events: PlatformEventRecord[] = [
    {
      eventId: randomUUID(),
      runId: options.runId,
      taskId: options.taskId,
      eventType: PLATFORM_EVENT_TYPES.TASK_RETRY_SCHEDULED,
      payload: buildActionPayload(options, {
        retryCount: nextRetryCount,
        maxRetries: task.max_retries ?? DEFAULT_PLATFORM_MAX_RETRIES,
        previousStatus: task.status,
        reason: 'operator-retry',
        manual: true
      })
    },
    {
      eventId: randomUUID(),
      runId: options.runId,
      taskId: options.taskId,
      eventType: PLATFORM_EVENT_TYPES.TASK_REQUEUED,
      payload: buildActionPayload(options, {
        status: 'ready',
        previousStatus: task.status,
        reason: 'operator-retry'
      })
    }
  ];
  await insertPlatformEvents(executor, schema, events);

  return {
    action: 'retry',
    runId: options.runId,
    taskId: options.taskId,
    taskStatus: 'ready',
    runStatus: progress.status,
    currentStage: progress.currentStage,
    publicationId: null,
    publicationStatus: null
  };
}

async function resolveApprovalAction(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneTaskActionOptions,
  action: 'approve' | 'reject'
): Promise<PlatformControlPlaneTaskActionResult | null> {
  const task = await getTaskActionRow(executor, schema, options);
  if (!task) {
    return null;
  }

  const publication = await getPublicationActionRow(executor, schema, options);
  if (!publication) {
    throw new PlatformControlPlaneActionError(
      'approval-not-found',
      `Task ${options.taskId} does not have a publication approval record`,
      409,
      {
        runId: options.runId,
        taskId: options.taskId,
        action
      }
    );
  }

  if (publication.status !== 'approval-required') {
    throw new PlatformControlPlaneActionError(
      'invalid-task-action',
      `Task ${options.taskId} cannot be ${action}d because publication ${publication.publication_id} is ${publication.status}`,
      409,
      {
        runId: options.runId,
        taskId: options.taskId,
        publicationId: publication.publication_id,
        publicationStatus: publication.status,
        action
      }
    );
  }

  const nextPublicationStatus = action === 'approve' ? 'published' : 'blocked';
  const nextTaskStatus: PlatformTaskRecord['status'] = action === 'approve' ? 'completed' : 'blocked';
  const metadata = {
    ...publication.metadata,
    approvalStatus: action === 'approve' ? 'approved' : 'rejected',
    approvalActionAt: new Date().toISOString(),
    ...(options.actor ? { approvalActor: options.actor } : {}),
    ...(options.note ? { approvalNote: options.note } : {}),
    ...(action === 'reject' ? { gateReason: 'operator-rejected' } : {})
  };

  await updatePublication(executor, schema, publication.publication_id, options.runId, nextPublicationStatus, metadata);
  await updateTaskStatus(executor, schema, options, nextTaskStatus);

  const progress = await getUpdatedRunProgress(executor, schema, options.runId);
  await updateRunProgress(executor, schema, options.runId, progress);

  const events: PlatformEventRecord[] = action === 'approve'
    ? [
        {
          eventId: randomUUID(),
          runId: options.runId,
          taskId: options.taskId,
          eventType: PLATFORM_EVENT_TYPES.APPROVAL_APPROVED,
          payload: buildActionPayload(options, {
            publicationId: publication.publication_id,
            publishMode: publication.publish_mode,
            previousStatus: publication.status,
            gateReason: publication.metadata?.gateReason ?? null
          })
        },
        {
          eventId: randomUUID(),
          runId: options.runId,
          taskId: options.taskId,
          eventType: PLATFORM_EVENT_TYPES.PUBLICATION_PUBLISHED,
          payload: buildActionPayload(options, {
            publicationId: publication.publication_id,
            publishMode: publication.publish_mode,
            status: 'published',
            approvalRequired: true
          })
        },
        {
          eventId: randomUUID(),
          runId: options.runId,
          taskId: options.taskId,
          eventType: PLATFORM_EVENT_TYPES.TASK_COMPLETED,
          payload: buildActionPayload(options, {
            approvalAction: 'approved',
            publicationId: publication.publication_id
          })
        }
      ]
    : [
        {
          eventId: randomUUID(),
          runId: options.runId,
          taskId: options.taskId,
          eventType: PLATFORM_EVENT_TYPES.APPROVAL_REJECTED,
          payload: buildActionPayload(options, {
            publicationId: publication.publication_id,
            publishMode: publication.publish_mode,
            previousStatus: publication.status,
            gateReason: publication.metadata?.gateReason ?? null
          })
        },
        {
          eventId: randomUUID(),
          runId: options.runId,
          taskId: options.taskId,
          eventType: PLATFORM_EVENT_TYPES.PUBLICATION_BLOCKED,
          payload: buildActionPayload(options, {
            publicationId: publication.publication_id,
            publishMode: publication.publish_mode,
            status: 'blocked',
            gateReason: 'operator-rejected'
          })
        }
      ];
  await insertPlatformEvents(executor, schema, events);

  return {
    action,
    runId: options.runId,
    taskId: options.taskId,
    taskStatus: nextTaskStatus,
    runStatus: progress.status,
    currentStage: progress.currentStage,
    publicationId: publication.publication_id,
    publicationStatus: nextPublicationStatus
  };
}

export async function approvePlatformControlPlaneTask(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneTaskActionOptions
): Promise<PlatformControlPlaneTaskActionResult | null> {
  return resolveApprovalAction(executor, schema, options, 'approve');
}

export async function rejectPlatformControlPlaneTask(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneTaskActionOptions
): Promise<PlatformControlPlaneTaskActionResult | null> {
  return resolveApprovalAction(executor, schema, options, 'reject');
}