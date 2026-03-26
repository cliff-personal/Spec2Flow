import { randomUUID } from 'node:crypto';
import { insertPlatformArtifacts, insertPlatformEvents } from './platform-repository.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import { reconcilePlatformPublications } from './platform-publication-service.js';
import { DEFAULT_PLATFORM_MAX_RETRIES, getPlatformRunState } from './platform-scheduler-service.js';
import { PLATFORM_EVENT_TYPES } from './platform-event-taxonomy.js';
import { applyCollaborationPublicationPolicy } from '../runtime/collaboration-publication-service.js';
import type {
  ArtifactRef,
  PlatformControlPlaneRunActionResult,
  PlatformControlPlaneTaskActionResult,
  PlatformEventRecord,
  PlatformRunRecord,
  PlatformRunStateSnapshot,
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

interface PlatformLatestRerouteRow extends Record<string, unknown> {
  task_id: string;
  requested_repair_target_stage: PlatformTaskRecord['requestedRepairTargetStage'];
}

interface PlatformRouteTaskStatusRow extends Record<string, unknown> {
  task_id: string;
  stage: PlatformTaskRecord['stage'];
  status: PlatformTaskRecord['status'];
}

type PlatformRerouteTargetStage = NonNullable<PlatformTaskRecord['requestedRepairTargetStage']>;

type PlatformRerouteRunAction =
  | 'reroute-to-requirements-analysis'
  | 'reroute-to-code-implementation'
  | 'reroute-to-test-design'
  | 'reroute-to-automated-execution';

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

function buildActorPayload(actor: string | undefined, note: string | undefined, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...extra,
    ...(actor ? { actor } : {}),
    ...(note ? { note } : {})
  };
}

function buildActionPayload(options: PlatformControlPlaneTaskActionOptions, extra: Record<string, unknown>): Record<string, unknown> {
  return buildActorPayload(options.actor, options.note, extra);
}

function buildRunActionPayload(options: PlatformControlPlaneRunActionOptions, extra: Record<string, unknown>): Record<string, unknown> {
  return buildActorPayload(options.actor, options.note, extra);
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

const REROUTE_STAGE_ORDER: Record<NonNullable<PlatformTaskRecord['requestedRepairTargetStage']> | 'defect-feedback' | 'collaboration' | 'evaluation', number> = {
  'requirements-analysis': 1,
  'code-implementation': 2,
  'test-design': 3,
  'automated-execution': 4,
  'defect-feedback': 5,
  'collaboration': 6,
  'evaluation': 7
};

const REROUTE_ACTION_BY_STAGE: Record<PlatformRerouteTargetStage, PlatformRerouteRunAction> = {
  'requirements-analysis': 'reroute-to-requirements-analysis',
  'code-implementation': 'reroute-to-code-implementation',
  'test-design': 'reroute-to-test-design',
  'automated-execution': 'reroute-to-automated-execution'
};

function getRouteTaskId(routePrefix: string, stage: NonNullable<PlatformTaskRecord['requestedRepairTargetStage']>): string {
  return `${routePrefix}--${stage}`;
}

function getPublicationTaskId(publication: PlatformPublicationActionRow): string | null {
  const taskId = publication.metadata?.taskId;
  return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId.trim() : null;
}

function buildExecutionArtifactRef(
  artifact: PlatformRunStateSnapshot['artifacts'][number]
): ArtifactRef {
  const originalArtifactId = typeof artifact.metadata?.originalArtifactId === 'string'
    && artifact.metadata.originalArtifactId.trim().length > 0
    ? artifact.metadata.originalArtifactId.trim()
    : artifact.artifactId;

  return {
    id: originalArtifactId,
    kind: artifact.kind,
    path: artifact.path,
    ...(artifact.taskId ? { taskId: artifact.taskId } : {})
  };
}

function buildPlatformArtifactsForRun(runId: string, artifacts: ArtifactRef[]): Array<{
  artifactId: string;
  runId: string;
  taskId?: string | null;
  kind: ArtifactRef['kind'];
  path: string;
  metadata: Record<string, unknown>;
}> {
  return artifacts.map((artifact) => ({
    artifactId: randomUUID(),
    runId,
    taskId: artifact.taskId ?? null,
    kind: artifact.kind,
    path: artifact.path,
    metadata: {
      originalArtifactId: artifact.id
    }
  }));
}

function resolvePublicationArtifactBaseDir(snapshot: PlatformRunStateSnapshot, runId: string): string {
  const artifactBaseDir = snapshot.workspace?.worktreePath
    ?? snapshot.workspace?.workspaceRootPath
    ?? snapshot.project?.workspaceRootPath
    ?? snapshot.project?.repositoryRootPath;

  if (!artifactBaseDir) {
    throw new PlatformControlPlaneActionError(
      'publication-context-missing',
      `Run ${runId} is missing workspace context for publication execution`,
      409,
      { runId }
    );
  }

  return artifactBaseDir;
}

function buildRerouteRunAction(stage: PlatformRerouteTargetStage): PlatformRerouteRunAction {
  return REROUTE_ACTION_BY_STAGE[stage];
}

async function getLatestRunRerouteTarget(
  executor: SqlExecutor,
  schema: string,
  runId: string
): Promise<PlatformLatestRerouteRow | null> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<PlatformLatestRerouteRow>(
    `
      SELECT task_id, requested_repair_target_stage
      FROM ${quotedSchema}.tasks
      WHERE run_id = $1
        AND evaluation_decision = 'needs-repair'
        AND requested_repair_target_stage IS NOT NULL
      ORDER BY updated_at DESC, task_id DESC
      LIMIT 1
    `,
    [runId]
  );

  return result.rows[0] ?? null;
}

async function getRouteTaskStatuses(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  routePrefix: string
): Promise<PlatformRouteTaskStatusRow[]> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<PlatformRouteTaskStatusRow>(
    `
      SELECT task_id, stage, status
      FROM ${quotedSchema}.tasks
      WHERE run_id = $1
        AND task_id LIKE $2
      ORDER BY created_at ASC, task_id ASC
    `,
    [runId, `${routePrefix}--%`]
  );

  return result.rows;
}

async function getLatestRunPublicationActionRow(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  statuses: string[]
): Promise<PlatformPublicationActionRow | null> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<PlatformPublicationActionRow>(
    `
      SELECT publication_id, run_id, publish_mode, status, metadata
      FROM ${quotedSchema}.publications
      WHERE run_id = $1
        AND status = ANY($2::text[])
        AND (metadata ->> 'supersededByPublicationId') IS NULL
      ORDER BY updated_at DESC, publication_id DESC
      LIMIT 1
    `,
    [runId, statuses]
  );

  return result.rows[0] ?? null;
}

async function updateEvaluationRerouteTarget(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  taskId: string,
  targetStage: PlatformRerouteTargetStage
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.tasks
      SET requested_repair_target_stage = $3,
          updated_at = NOW()
      WHERE run_id = $1
        AND task_id = $2
        AND stage = 'evaluation'
    `,
    [runId, taskId, targetStage]
  );
}

async function cancelRouteTasks(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  routePrefix: string
): Promise<string[]> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const routeTaskRows = await getRouteTaskStatuses(executor, schema, runId, routePrefix);
  const taskIdsToCancel = routeTaskRows
    .filter((row) => !['completed', 'skipped', 'cancelled'].includes(row.status))
    .map((row) => row.task_id);

  if (taskIdsToCancel.length === 0) {
    return [];
  }

  await executor.query(
    `
      UPDATE ${quotedSchema}.tasks
      SET status = 'cancelled',
          evaluation_decision = CASE WHEN stage = 'evaluation' THEN NULL ELSE evaluation_decision END,
          evaluation_summary = CASE WHEN stage = 'evaluation' THEN NULL ELSE evaluation_summary END,
          requested_repair_target_stage = CASE WHEN stage = 'evaluation' THEN NULL ELSE requested_repair_target_stage END,
          evaluation_findings = CASE WHEN stage = 'evaluation' THEN '[]'::jsonb ELSE evaluation_findings END,
          evaluation_next_actions = CASE WHEN stage = 'evaluation' THEN '[]'::jsonb ELSE evaluation_next_actions END,
          current_lease_id = NULL,
          leased_by_worker_id = NULL,
          lease_expires_at = NULL,
          last_heartbeat_at = NULL,
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
      WHERE run_id = $1
        AND task_id = ANY($2::text[])
    `,
    [runId, taskIdsToCancel]
  );

  return taskIdsToCancel;
}

async function rearmRunFromTargetStage(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  routePrefix: string,
  targetStage: NonNullable<PlatformTaskRecord['requestedRepairTargetStage']>
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const routeTaskRows = await getRouteTaskStatuses(executor, schema, runId, routePrefix);
  const targetTaskId = getRouteTaskId(routePrefix, targetStage);

  if (!routeTaskRows.some((row) => row.task_id === targetTaskId)) {
    throw new PlatformControlPlaneActionError(
      'reroute-target-not-found',
      `Run ${runId} does not have a task for reroute target ${targetStage}`,
      409,
      {
        runId,
        routePrefix,
        targetStage,
        targetTaskId
      }
    );
  }

  const targetStageOrder = REROUTE_STAGE_ORDER[targetStage];
  const taskIdsToReady = routeTaskRows
    .filter((row) => row.stage === targetStage)
    .map((row) => row.task_id);
  const taskIdsToPending = routeTaskRows
    .filter((row) => {
      const stageOrder = REROUTE_STAGE_ORDER[row.stage as keyof typeof REROUTE_STAGE_ORDER];
      return typeof stageOrder === 'number' && stageOrder > targetStageOrder;
    })
    .map((row) => row.task_id);

  if (taskIdsToReady.length > 0) {
    await executor.query(
      `
        UPDATE ${quotedSchema}.tasks
        SET status = 'ready',
            current_lease_id = NULL,
            leased_by_worker_id = NULL,
            lease_expires_at = NULL,
            last_heartbeat_at = NULL,
            started_at = NULL,
            completed_at = NULL,
            updated_at = NOW()
        WHERE run_id = $1
          AND task_id = ANY($2::text[])
      `,
      [runId, taskIdsToReady]
    );
  }

  if (taskIdsToPending.length > 0) {
    await executor.query(
      `
        UPDATE ${quotedSchema}.tasks
        SET status = 'pending',
            evaluation_decision = CASE WHEN stage = 'evaluation' THEN NULL ELSE evaluation_decision END,
            evaluation_summary = CASE WHEN stage = 'evaluation' THEN NULL ELSE evaluation_summary END,
            requested_repair_target_stage = CASE WHEN stage = 'evaluation' THEN NULL ELSE requested_repair_target_stage END,
            evaluation_findings = CASE WHEN stage = 'evaluation' THEN '[]'::jsonb ELSE evaluation_findings END,
            evaluation_next_actions = CASE WHEN stage = 'evaluation' THEN '[]'::jsonb ELSE evaluation_next_actions END,
            current_lease_id = NULL,
            leased_by_worker_id = NULL,
            lease_expires_at = NULL,
            last_heartbeat_at = NULL,
            started_at = NULL,
            completed_at = NULL,
            updated_at = NOW()
        WHERE run_id = $1
          AND task_id = ANY($2::text[])
      `,
      [runId, taskIdsToPending]
    );
  }
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
  retryCount?: number,
  clearEvaluationSignals = false
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.tasks
      SET status = $3,
          retry_count = COALESCE($4, retry_count),
          evaluation_decision = CASE WHEN $5 THEN NULL ELSE evaluation_decision END,
          evaluation_summary = CASE WHEN $5 THEN NULL ELSE evaluation_summary END,
          requested_repair_target_stage = CASE WHEN $5 THEN NULL ELSE requested_repair_target_stage END,
          evaluation_findings = CASE WHEN $5 THEN '[]'::jsonb ELSE evaluation_findings END,
          evaluation_next_actions = CASE WHEN $5 THEN '[]'::jsonb ELSE evaluation_next_actions END,
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
    [options.runId, options.taskId, status, retryCount ?? null, clearEvaluationSignals]
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
  await updateTaskStatus(executor, schema, options, 'ready', nextRetryCount, task.stage === 'evaluation');

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

async function resolvePublicationRunAction(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions,
  action: 'approve-publication' | 'force-publish'
): Promise<PlatformControlPlaneRunActionResult | null> {
  const run = await getRunActionRow(executor, schema, options.runId);
  if (!run) {
    return null;
  }

  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} cannot execute ${action} while ${run.status}`,
      409,
      {
        runId: options.runId,
        runStatus: run.status,
        action
      }
    );
  }

  const publication = await getLatestRunPublicationActionRow(
    executor,
    schema,
    options.runId,
    action === 'approve-publication' ? ['approval-required'] : ['approval-required', 'blocked']
  );
  if (!publication) {
    throw new PlatformControlPlaneActionError(
      'approval-not-found',
      `Run ${options.runId} does not have a publication gate for ${action}`,
      409,
      {
        runId: options.runId,
        action
      }
    );
  }

  if (action === 'approve-publication' && publication.status !== 'approval-required') {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} cannot approve publication ${publication.publication_id} because it is ${publication.status}`,
      409,
      {
        runId: options.runId,
        publicationId: publication.publication_id,
        publicationStatus: publication.status,
        action
      }
    );
  }

  const taskId = getPublicationTaskId(publication);
  if (!taskId) {
    throw new PlatformControlPlaneActionError(
      'approval-not-found',
      `Publication ${publication.publication_id} is missing its task binding`,
      409,
      {
        runId: options.runId,
        publicationId: publication.publication_id,
        action
      }
    );
  }

  if (action === 'force-publish') {
    return resolveForcedPublicationRunAction(executor, schema, options, run, publication, taskId);
  }

  return resolveApprovedPublicationRunAction(executor, schema, options, run, publication, taskId);
}

async function resolveApprovedPublicationRunAction(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions,
  run: PlatformRunActionRow,
  publication: PlatformPublicationActionRow,
  taskId: string
): Promise<PlatformControlPlaneRunActionResult> {
  const snapshot = await getPlatformRunState(executor, schema, { runId: options.runId });
  const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) {
    throw new PlatformControlPlaneActionError(
      'task-not-found',
      `Run ${options.runId} is missing collaboration task ${taskId} for approve-publication`,
      409,
      {
        runId: options.runId,
        taskId,
        publicationId: publication.publication_id,
        action: 'approve-publication'
      }
    );
  }

  if (task.stage !== 'collaboration') {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} cannot approve publication for task ${taskId} because it is ${task.stage}`,
      409,
      {
        runId: options.runId,
        taskId,
        taskStage: task.stage,
        publicationId: publication.publication_id,
        action: 'approve-publication'
      }
    );
  }

  const taskStateStatus = task.status === 'blocked' || task.status === 'completed'
    ? task.status
    : null;
  if (!taskStateStatus) {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} cannot approve publication for task ${taskId} while it is ${task.status}`,
      409,
      {
        runId: options.runId,
        taskId,
        taskStatus: task.status,
        publicationId: publication.publication_id,
        action: 'approve-publication'
      }
    );
  }

  const artifactBaseDir = resolvePublicationArtifactBaseDir(snapshot, options.runId);
  const allArtifacts = snapshot.artifacts.map((artifact) => buildExecutionArtifactRef(artifact));
  const taskArtifacts = allArtifacts.filter((artifact) => artifact.taskId === taskId);
  const decision = applyCollaborationPublicationPolicy({
    taskGraphTask: {
      id: task.taskId,
      stage: task.stage,
      ...(task.reviewPolicy ? { reviewPolicy: task.reviewPolicy } : {})
    },
    taskState: {
      taskId,
      status: taskStateStatus,
      notes: []
    },
    artifacts: taskArtifacts,
    allArtifacts,
    artifactBaseDir,
    approvalMode: 'operator-approved',
    remotePublication: {
      createPullRequest: true,
      requestMerge: true,
      mergeMethod: 'squash'
    }
  });

  if (decision.status === 'not-applicable') {
    throw new PlatformControlPlaneActionError(
      'publication-context-missing',
      `Run ${options.runId} could not rehydrate publication context for ${taskId}`,
      409,
      {
        runId: options.runId,
        taskId,
        publicationId: publication.publication_id,
        action: 'approve-publication'
      }
    );
  }

  if (decision.generatedArtifacts.length > 0) {
    await insertPlatformArtifacts(executor, schema, buildPlatformArtifactsForRun(options.runId, decision.generatedArtifacts));
  }
  await reconcilePlatformPublications(executor, schema, {
    runId: options.runId,
    taskId,
    artifactBaseDir,
    newArtifacts: decision.generatedArtifacts
  });

  const timestamp = new Date().toISOString();
  const approvalMetadata = {
    ...publication.metadata,
    approvalStatus: 'approved',
    approvalActionAt: timestamp,
    ...(options.actor ? { approvalActor: options.actor } : {}),
    ...(options.note ? { approvalNote: options.note } : {}),
    approvalResult: decision.status,
    supersededByPublicationId: decision.publication.publicationId
  };
  await updatePublication(executor, schema, publication.publication_id, options.runId, publication.status, approvalMetadata);

  const approvalEvents: PlatformEventRecord[] = [{
    eventId: randomUUID(),
    runId: options.runId,
    taskId,
    eventType: PLATFORM_EVENT_TYPES.APPROVAL_APPROVED,
    payload: buildRunActionPayload(options, {
      publicationId: decision.publication.publicationId,
      sourcePublicationId: publication.publication_id,
      publishMode: decision.publication.publishMode,
      previousStatus: publication.status,
      forced: false,
      gateReason: publication.metadata?.gateReason ?? null,
      approvalResult: decision.status
    })
  }];

  if (decision.status !== 'published') {
    await insertPlatformEvents(executor, schema, approvalEvents);
    return {
      action: 'approve-publication',
      runId: options.runId,
      runStatus: run.status,
      currentStage: run.current_stage,
      paused: isRunPaused(run.metadata),
      publicationId: decision.publication.publicationId,
      publicationStatus: decision.publication.status
    };
  }

  await updateTaskStatus(executor, schema, { runId: options.runId, taskId }, 'completed');
  const progress = await getUpdatedRunProgress(executor, schema, options.runId);
  await updateRunProgress(executor, schema, options.runId, progress);
  approvalEvents.push({
    eventId: randomUUID(),
    runId: options.runId,
    taskId,
    eventType: PLATFORM_EVENT_TYPES.TASK_COMPLETED,
    payload: buildRunActionPayload(options, {
      publicationId: decision.publication.publicationId,
      sourcePublicationId: publication.publication_id,
      publicationStatus: decision.publication.status,
      forced: false
    })
  });
  await insertPlatformEvents(executor, schema, approvalEvents);

  return {
    action: 'approve-publication',
    runId: options.runId,
    runStatus: progress.status,
    currentStage: progress.currentStage,
    paused: isRunPaused(run.metadata),
    publicationId: decision.publication.publicationId,
    publicationStatus: decision.publication.status
  };
}

async function resolveForcedPublicationRunAction(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions,
  run: PlatformRunActionRow,
  publication: PlatformPublicationActionRow,
  taskId: string
): Promise<PlatformControlPlaneRunActionResult> {
  const snapshot = await getPlatformRunState(executor, schema, { runId: options.runId });
  const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) {
    throw new PlatformControlPlaneActionError(
      'task-not-found',
      `Run ${options.runId} is missing collaboration task ${taskId} for force-publish`,
      409,
      {
        runId: options.runId,
        taskId,
        publicationId: publication.publication_id,
        action: 'force-publish'
      }
    );
  }

  if (task.stage !== 'collaboration') {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} cannot force-publish task ${taskId} because it is ${task.stage}`,
      409,
      {
        runId: options.runId,
        taskId,
        taskStage: task.stage,
        publicationId: publication.publication_id,
        action: 'force-publish'
      }
    );
  }

  const artifactBaseDir = resolvePublicationArtifactBaseDir(snapshot, options.runId);
  const allArtifacts = snapshot.artifacts.map((artifact) => buildExecutionArtifactRef(artifact));
  const taskArtifacts = allArtifacts.filter((artifact) => artifact.taskId === taskId);
  const taskStateStatus = task.status === 'blocked' || task.status === 'completed'
    ? task.status
    : null;
  if (!taskStateStatus) {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} cannot force-publish task ${taskId} while it is ${task.status}`,
      409,
      {
        runId: options.runId,
        taskId,
        taskStatus: task.status,
        publicationId: publication.publication_id,
        action: 'force-publish'
      }
    );
  }

  const decision = applyCollaborationPublicationPolicy({
    taskGraphTask: {
      id: task.taskId,
      stage: task.stage,
      ...(task.reviewPolicy ? { reviewPolicy: task.reviewPolicy } : {})
    },
    taskState: {
      taskId,
      status: taskStateStatus,
      notes: []
    },
    artifacts: taskArtifacts,
    allArtifacts,
    artifactBaseDir,
    forcePublish: true
  });

  if (decision.status === 'not-applicable') {
    throw new PlatformControlPlaneActionError(
      'publication-context-missing',
      `Run ${options.runId} could not rehydrate publication context for ${taskId}`,
      409,
      {
        runId: options.runId,
        taskId,
        publicationId: publication.publication_id,
        action: 'force-publish'
      }
    );
  }

  if (decision.generatedArtifacts.length > 0) {
    await insertPlatformArtifacts(executor, schema, buildPlatformArtifactsForRun(options.runId, decision.generatedArtifacts));
  }
  await reconcilePlatformPublications(executor, schema, {
    runId: options.runId,
    taskId,
    artifactBaseDir,
    newArtifacts: decision.generatedArtifacts
  });

  const timestamp = new Date().toISOString();
  const attemptMetadata = {
    ...publication.metadata,
    forcePublishAttemptedAt: timestamp,
    ...(options.actor ? { forcePublishActor: options.actor } : {}),
    ...(options.note ? { forcePublishNote: options.note } : {}),
    forcePublishResult: decision.status,
    forcePublishAttemptPublicationId: decision.publication.publicationId,
    ...(decision.status === 'published'
      ? {
          forcePublished: true,
          forcePublishedAt: timestamp,
          supersededByPublicationId: decision.publication.publicationId
        }
      : {
          forcePublishGateReason: decision.reason
        })
  };
  await updatePublication(executor, schema, publication.publication_id, options.runId, publication.status, attemptMetadata);

  if (decision.status !== 'published') {
    return {
      action: 'force-publish',
      runId: options.runId,
      runStatus: run.status,
      currentStage: run.current_stage,
      paused: isRunPaused(run.metadata),
      publicationId: decision.publication.publicationId,
      publicationStatus: decision.publication.status
    };
  }

  await updateTaskStatus(executor, schema, { runId: options.runId, taskId }, 'completed');
  const progress = await getUpdatedRunProgress(executor, schema, options.runId);
  await updateRunProgress(executor, schema, options.runId, progress);

  const events: PlatformEventRecord[] = [
    ...(publication.status === 'approval-required'
      ? [{
          eventId: randomUUID(),
          runId: options.runId,
          taskId,
          eventType: PLATFORM_EVENT_TYPES.APPROVAL_APPROVED,
          payload: buildRunActionPayload(options, {
            publicationId: decision.publication.publicationId,
            sourcePublicationId: publication.publication_id,
            publishMode: decision.publication.publishMode,
            previousStatus: publication.status,
            forced: true,
            gateReason: publication.metadata?.gateReason ?? null
          })
        }]
      : []),
    {
      eventId: randomUUID(),
      runId: options.runId,
      taskId,
      eventType: PLATFORM_EVENT_TYPES.TASK_COMPLETED,
      payload: buildRunActionPayload(options, {
        publicationId: decision.publication.publicationId,
        sourcePublicationId: publication.publication_id,
        publicationStatus: decision.publication.status,
        forced: true
      })
    }
  ];
  await insertPlatformEvents(executor, schema, events);

  return {
    action: 'force-publish',
    runId: options.runId,
    runStatus: progress.status,
    currentStage: progress.currentStage,
    paused: isRunPaused(run.metadata),
    publicationId: decision.publication.publicationId,
    publicationStatus: decision.publication.status
  };
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

export async function resumePlatformControlPlaneRunFromTargetStage(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions
): Promise<PlatformControlPlaneRunActionResult | null> {
  const run = await getRunActionRow(executor, schema, options.runId);
  if (!run) {
    return null;
  }

  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} cannot be resumed from target stage while ${run.status}`,
      409,
      {
        runId: options.runId,
        runStatus: run.status,
        action: 'resume-from-target-stage'
      }
    );
  }

  const reroute = await getLatestRunRerouteTarget(executor, schema, options.runId);
  const targetStage = reroute?.requested_repair_target_stage ?? null;
  const routePrefix = reroute?.task_id ? getRoutePrefix(reroute.task_id) : null;
  if (!reroute?.task_id || !targetStage || !routePrefix) {
    throw new PlatformControlPlaneActionError(
      'reroute-target-missing',
      `Run ${options.runId} does not have an active evaluator reroute target`,
      409,
      {
        runId: options.runId,
        action: 'resume-from-target-stage'
      }
    );
  }

  await rearmRunFromTargetStage(executor, schema, options.runId, routePrefix, targetStage);

  const nextMetadata = buildRunControlPlaneMetadata(run.metadata ?? {}, 'resume', options);
  await updateRunActionState(executor, schema, options.runId, nextMetadata);

  const progress = await getUpdatedRunProgress(executor, schema, options.runId);
  await updateRunProgress(executor, schema, options.runId, progress);

  await insertPlatformEvents(executor, schema, [
    {
      eventId: randomUUID(),
      runId: options.runId,
      taskId: reroute.task_id,
      eventType: PLATFORM_EVENT_TYPES.RUN_RESUMED_FROM_TARGET_STAGE,
      payload: buildRunActionPayload(options, {
        targetStage,
        targetTaskId: getRouteTaskId(routePrefix, targetStage),
        rerouteTaskId: reroute.task_id,
        previousPaused: isRunPaused(run.metadata)
      })
    }
  ]);

  return {
    action: 'resume-from-target-stage',
    runId: options.runId,
    runStatus: progress.status,
    currentStage: progress.currentStage,
    paused: false,
    rerouteTargetStage: targetStage
  };
}

export async function approvePlatformControlPlaneRunPublication(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions
): Promise<PlatformControlPlaneRunActionResult | null> {
  return resolvePublicationRunAction(executor, schema, options, 'approve-publication');
}

export async function forcePublishPlatformControlPlaneRun(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions
): Promise<PlatformControlPlaneRunActionResult | null> {
  return resolvePublicationRunAction(executor, schema, options, 'force-publish');
}

export async function reroutePlatformControlPlaneRunToStage(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions,
  targetStage: PlatformRerouteTargetStage
): Promise<PlatformControlPlaneRunActionResult | null> {
  const run = await getRunActionRow(executor, schema, options.runId);
  if (!run) {
    return null;
  }

  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} cannot reroute while ${run.status}`,
      409,
      {
        runId: options.runId,
        runStatus: run.status,
        action: buildRerouteRunAction(targetStage)
      }
    );
  }

  const reroute = await getLatestRunRerouteTarget(executor, schema, options.runId);
  const routePrefix = reroute?.task_id ? getRoutePrefix(reroute.task_id) : null;
  if (!reroute?.task_id || !routePrefix) {
    throw new PlatformControlPlaneActionError(
      'reroute-target-missing',
      `Run ${options.runId} does not have an active evaluator reroute target`,
      409,
      {
        runId: options.runId,
        action: buildRerouteRunAction(targetStage)
      }
    );
  }

  await updateEvaluationRerouteTarget(executor, schema, options.runId, reroute.task_id, targetStage);
  await rearmRunFromTargetStage(executor, schema, options.runId, routePrefix, targetStage);

  const nextMetadata = buildRunControlPlaneMetadata(run.metadata ?? {}, 'resume', options);
  await updateRunActionState(executor, schema, options.runId, nextMetadata);

  const progress = await getUpdatedRunProgress(executor, schema, options.runId);
  await updateRunProgress(executor, schema, options.runId, progress);

  await insertPlatformEvents(executor, schema, [
    {
      eventId: randomUUID(),
      runId: options.runId,
      taskId: reroute.task_id,
      eventType: PLATFORM_EVENT_TYPES.RUN_REROUTED_TO_STAGE,
      payload: buildRunActionPayload(options, {
        previousTargetStage: reroute.requested_repair_target_stage ?? null,
        targetStage,
        rerouteTaskId: reroute.task_id,
        routePrefix
      })
    }
  ]);

  return {
    action: buildRerouteRunAction(targetStage),
    runId: options.runId,
    runStatus: progress.status,
    currentStage: progress.currentStage,
    paused: false,
    rerouteTargetStage: targetStage
  };
}

export async function cancelPlatformControlPlaneRunRoute(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunActionOptions
): Promise<PlatformControlPlaneRunActionResult | null> {
  const run = await getRunActionRow(executor, schema, options.runId);
  if (!run) {
    return null;
  }

  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} cannot cancel a route while ${run.status}`,
      409,
      {
        runId: options.runId,
        runStatus: run.status,
        action: 'cancel-route'
      }
    );
  }

  const reroute = await getLatestRunRerouteTarget(executor, schema, options.runId);
  const routePrefix = reroute?.task_id ? getRoutePrefix(reroute.task_id) : null;
  if (!reroute?.task_id || !routePrefix) {
    throw new PlatformControlPlaneActionError(
      'reroute-target-missing',
      `Run ${options.runId} does not have an active evaluator reroute route to cancel`,
      409,
      {
        runId: options.runId,
        action: 'cancel-route'
      }
    );
  }

  const cancelledTaskIds = await cancelRouteTasks(executor, schema, options.runId, routePrefix);
  if (cancelledTaskIds.length === 0) {
    throw new PlatformControlPlaneActionError(
      'invalid-run-action',
      `Run ${options.runId} does not have an open route to cancel`,
      409,
      {
        runId: options.runId,
        action: 'cancel-route',
        routePrefix
      }
    );
  }

  const nextMetadata = buildRunControlPlaneMetadata(run.metadata ?? {}, 'resume', options);
  await updateRunActionState(executor, schema, options.runId, nextMetadata);

  const progress = await getUpdatedRunProgress(executor, schema, options.runId);
  await updateRunProgress(executor, schema, options.runId, progress);

  await insertPlatformEvents(executor, schema, [
    {
      eventId: randomUUID(),
      runId: options.runId,
      taskId: reroute.task_id,
      eventType: PLATFORM_EVENT_TYPES.RUN_ROUTE_CANCELLED,
      payload: buildRunActionPayload(options, {
        rerouteTaskId: reroute.task_id,
        routePrefix,
        cancelledTaskIds,
        previousTargetStage: reroute.requested_repair_target_stage ?? null
      })
    }
  ]);

  return {
    action: 'cancel-route',
    runId: options.runId,
    runStatus: progress.status,
    currentStage: progress.currentStage,
    paused: false
  };
}
