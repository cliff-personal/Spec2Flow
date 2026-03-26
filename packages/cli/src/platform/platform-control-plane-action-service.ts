import { randomUUID } from 'node:crypto';
import { insertPlatformEvents } from './platform-repository.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import { DEFAULT_PLATFORM_MAX_RETRIES } from './platform-scheduler-service.js';
import { PLATFORM_EVENT_TYPES } from './platform-event-taxonomy.js';
import type {
  PlatformControlPlaneRunActionResult,
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

interface PlatformRunActionRow extends Record<string, unknown> {
  run_id: string;
  status: PlatformRunRecord['status'];
  current_stage: PlatformRunRecord['currentStage'];
  metadata: Record<string, unknown>;
}

export interface PlatformControlPlaneTaskActionOptions {
  runId: string;
  taskId: string;
  actor?: string;
  note?: string;
}

export interface PlatformControlPlaneRunActionOptions {
  runId: string;
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

function buildRunActionPayload(options: PlatformControlPlaneRunActionOptions, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...extra,
    ...(options.actor ? { actor: options.actor } : {}),
    ...(options.note ? { note: options.note } : {})
  };
}

function isRunPaused(metadata: Record<string, unknown> | null | undefined): boolean {
  const controlPlane = metadata?.controlPlane;
  if (typeof controlPlane !== 'object' || controlPlane === null || Array.isArray(controlPlane)) {
    return false;
  }

  return (controlPlane as Record<string, unknown>).paused === true;
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

async function getRunActionRow(
  executor: SqlExecutor,
  schema: string,
  runId: string
): Promise<PlatformRunActionRow | null> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<PlatformRunActionRow>(
    `
      SELECT run_id, status, current_stage, metadata
      FROM ${quotedSchema}.runs
      WHERE run_id = $1
      LIMIT 1
    `,
    [runId]
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

function getRoutePrefix(taskId: string): string | null {
  return taskId.includes('--') ? (taskId.split('--')[0] ?? null) : null;
}

function isResolvedRouteFailureRow(
  row: PlatformTaskProgressRow,
  rowIndex: Map<string, PlatformTaskProgressRow>
): boolean {
  if (!['blocked', 'failed', 'cancelled'].includes(row.status)) {
    return false;
  }

  if (['environment-preparation', 'collaboration'].includes(row.stage)) {
    return false;
  }

  const routePrefix = getRoutePrefix(row.task_id);
  if (!routePrefix) {
    return false;
  }

  const collaborationRow = rowIndex.get(`${routePrefix}--collaboration`);
  return collaborationRow !== undefined && ['completed', 'skipped'].includes(collaborationRow.status);
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
  const rowIndex = new Map(orderedRows.map((row) => [row.task_id, row]));
  const activeRows = orderedRows.filter((row) => {
    if (['completed', 'skipped'].includes(row.status)) {
      return false;
    }

    return !isResolvedRouteFailureRow(row, rowIndex);
  });
  const firstActiveStage = activeRows[0]?.stage ?? null;
  const firstExecutableStage = activeRows.find((row) => ['ready', 'in-progress'].includes(row.status))?.stage ?? null;

  if (activeRows.length === 0) {
    return {
      status: 'completed',
      currentStage: null
    };
  }

  if (firstExecutableStage) {
    return {
      status: 'running',
      currentStage: firstExecutableStage
    };
  }

  if (activeRows.some((row) => row.status === 'failed')) {
    return {
      status: 'failed',
      currentStage: activeRows.find((row) => row.status === 'failed')?.stage ?? firstActiveStage
    };
  }

  if (activeRows.some((row) => ['blocked', 'cancelled'].includes(row.status))) {
    return {
      status: 'blocked',
      currentStage: activeRows.find((row) => ['blocked', 'cancelled'].includes(row.status))?.stage ?? firstActiveStage
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

async function updateRunActionState(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.runs
      SET metadata = $2::jsonb,
          updated_at = NOW()
      WHERE run_id = $1
    `,
    [runId, JSON.stringify(metadata)]
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

function buildRunControlPlaneMetadata(
  previousMetadata: Record<string, unknown>,
  action: 'pause' | 'resume',
  options: PlatformControlPlaneRunActionOptions
): Record<string, unknown> {
  const previousControlPlane = typeof previousMetadata.controlPlane === 'object'
    && previousMetadata.controlPlane !== null
    && !Array.isArray(previousMetadata.controlPlane)
    ? previousMetadata.controlPlane as Record<string, unknown>
    : {};
  const timestamp = new Date().toISOString();

  return {
    ...previousMetadata,
    controlPlane: {
      ...previousControlPlane,
      paused: action === 'pause',
      ...(action === 'pause'
        ? {
            pausedAt: timestamp,
            ...(options.actor ? { pausedBy: options.actor } : {}),
            ...(options.note ? { pauseNote: options.note } : {})
          }
        : {
            resumedAt: timestamp,
            ...(options.actor ? { resumedBy: options.actor } : {}),
            ...(options.note ? { resumeNote: options.note } : {})
          })
    }
  };
}

async function resolveRunAction(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions,
  action: 'pause' | 'resume'
): Promise<PlatformControlPlaneRunActionResult | null> {
  const run = await getRunActionRow(executor, schema, options.runId);
  if (!run) {
    return null;
  }

  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} cannot be ${action}d from status ${run.status}`,
      409,
      {
        runId: options.runId,
        runStatus: run.status,
        action
      }
    );
  }

  const currentlyPaused = isRunPaused(run.metadata);
  if (action === 'pause' && currentlyPaused) {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} is already paused`,
      409,
      {
        runId: options.runId,
        runStatus: run.status,
        action
      }
    );
  }

  if (action === 'resume' && !currentlyPaused) {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} is not paused`,
      409,
      {
        runId: options.runId,
        runStatus: run.status,
        action
      }
    );
  }

  const nextMetadata = buildRunControlPlaneMetadata(run.metadata ?? {}, action, options);
  await updateRunActionState(executor, schema, options.runId, nextMetadata);
  await insertPlatformEvents(executor, schema, [
    {
      eventId: randomUUID(),
      runId: options.runId,
      taskId: null,
      eventType: action === 'pause' ? PLATFORM_EVENT_TYPES.RUN_PAUSED : PLATFORM_EVENT_TYPES.RUN_RESUMED,
      payload: buildRunActionPayload(options, {
        paused: action === 'pause',
        previousPaused: currentlyPaused
      })
    }
  ]);

  return {
    action,
    runId: options.runId,
    runStatus: run.status,
    currentStage: run.current_stage,
    paused: action === 'pause'
  };
}

export async function pausePlatformControlPlaneRun(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions
): Promise<PlatformControlPlaneRunActionResult | null> {
  return resolveRunAction(executor, schema, options, 'pause');
}

export async function resumePlatformControlPlaneRun(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions
): Promise<PlatformControlPlaneRunActionResult | null> {
  return resolveRunAction(executor, schema, options, 'resume');
}
