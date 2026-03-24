import { randomUUID } from 'node:crypto';
import { insertPlatformEvents } from './platform-repository.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import type {
  PlatformArtifactRecord,
  PlatformEventRecord,
  PlatformRunRecord,
  PlatformRunStateSnapshot,
  PlatformTaskLeaseRecord,
  PlatformTaskRecord,
  PlatformWorkerIdentity
} from '../types/platform-persistence.js';
import type { ReviewPolicy } from '../types/review-policy.js';
import type { TaskRoleProfile, TaskStage } from '../types/task-graph.js';

export const DEFAULT_PLATFORM_LEASE_TTL_SECONDS = 60;
export const DEFAULT_PLATFORM_HEARTBEAT_INTERVAL_SECONDS = 20;
export const DEFAULT_PLATFORM_MAX_RETRIES = 3;
export const DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT = 20;

interface PlatformTaskRow extends Record<string, unknown> {
  run_id: string;
  task_id: string;
  stage: TaskStage;
  title: string;
  goal: string;
  executor_type: PlatformTaskRecord['executorType'];
  status: PlatformTaskRecord['status'];
  risk_level: PlatformTaskRecord['riskLevel'];
  depends_on: string[];
  target_files: string[];
  verify_commands: string[];
  inputs: Record<string, unknown>;
  role_profile: TaskRoleProfile;
  review_policy: ReviewPolicy | null;
  artifacts_dir: string | null;
  attempts: number;
  retry_count: number;
  max_retries: number;
  current_lease_id: string | null;
  leased_by_worker_id: string | null;
  lease_expires_at: Date | string | null;
  last_heartbeat_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface PlatformRunRow extends Record<string, unknown> {
  run_id: string;
  repository_id: string;
  workflow_name: string;
  request_text: string | null;
  status: PlatformRunRecord['status'];
  current_stage: PlatformRunRecord['currentStage'];
  risk_level: PlatformRunRecord['riskLevel'];
  request_payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface PlatformEventRow extends Record<string, unknown> {
  event_id: string;
  run_id: string;
  task_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date | string | null;
}

interface PlatformArtifactRow extends Record<string, unknown> {
  artifact_id: string;
  run_id: string;
  task_id: string | null;
  kind: PlatformArtifactRecord['kind'];
  path: string;
  schema_type: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string | null;
}

export interface LeaseNextPlatformTaskOptions extends PlatformWorkerIdentity {
  runId: string;
  leaseTtlSeconds?: number;
  heartbeatIntervalSeconds?: number;
}

export interface LeaseNextPlatformTaskResult {
  status: 'leased' | 'no-ready-task';
  runId: string;
  workerId: string;
  leaseTtlSeconds: number;
  heartbeatIntervalSeconds: number;
  task: PlatformTaskRecord | null;
  lease: PlatformTaskLeaseRecord | null;
}

export interface HeartbeatPlatformTaskOptions extends PlatformWorkerIdentity {
  runId: string;
  taskId: string;
  leaseTtlSeconds?: number;
  heartbeatIntervalSeconds?: number;
}

export interface HeartbeatPlatformTaskResult {
  status: 'renewed' | 'rejected';
  runId: string;
  taskId: string;
  workerId: string;
  leaseTtlSeconds: number;
  heartbeatIntervalSeconds: number;
  reason?: 'not-found' | 'not-owned' | 'lease-expired' | 'not-leased';
  lease: PlatformTaskLeaseRecord | null;
}

export interface StartPlatformTaskOptions extends PlatformWorkerIdentity {
  runId: string;
  taskId: string;
  leaseTtlSeconds?: number;
  heartbeatIntervalSeconds?: number;
}

export interface StartPlatformTaskResult {
  status: 'started' | 'rejected';
  runId: string;
  taskId: string;
  workerId: string;
  leaseTtlSeconds: number;
  heartbeatIntervalSeconds: number;
  reason?: 'not-found' | 'not-owned' | 'lease-expired' | 'not-leased';
  lease: PlatformTaskLeaseRecord | null;
}

export interface ExpirePlatformLeasesOptions {
  runId: string;
}

export interface ExpirePlatformLeasesResult {
  status: 'completed';
  runId: string;
  expiredLeaseCount: number;
  requeuedTaskIds: string[];
  blockedTaskIds: string[];
  eventsWritten: number;
}

export interface GetPlatformRunStateOptions {
  runId: string;
  eventLimit?: number;
}

function normalizeTimestamp(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toISOString();
  }

  return null;
}

function mapPlatformTaskRow(row: PlatformTaskRow): PlatformTaskRecord {
  return {
    runId: row.run_id,
    taskId: row.task_id,
    stage: row.stage,
    title: row.title,
    goal: row.goal,
    executorType: row.executor_type,
    status: row.status,
    riskLevel: row.risk_level ?? null,
    dependsOn: row.depends_on ?? [],
    targetFiles: row.target_files ?? [],
    verifyCommands: row.verify_commands ?? [],
    inputs: row.inputs ?? {},
    roleProfile: row.role_profile,
    reviewPolicy: row.review_policy,
    artifactsDir: row.artifacts_dir,
    attempts: row.attempts,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    currentLeaseId: row.current_lease_id,
    leasedByWorkerId: row.leased_by_worker_id,
    leaseExpiresAt: normalizeTimestamp(row.lease_expires_at),
    lastHeartbeatAt: normalizeTimestamp(row.last_heartbeat_at),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    startedAt: normalizeTimestamp(row.started_at),
    completedAt: normalizeTimestamp(row.completed_at)
  };
}

function mapPlatformRunRow(row: PlatformRunRow): PlatformRunRecord {
  return {
    runId: row.run_id,
    repositoryId: row.repository_id,
    workflowName: row.workflow_name,
    requestText: row.request_text,
    status: row.status,
    currentStage: row.current_stage,
    riskLevel: row.risk_level,
    requestPayload: row.request_payload ?? {},
    metadata: row.metadata ?? {},
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    startedAt: normalizeTimestamp(row.started_at),
    completedAt: normalizeTimestamp(row.completed_at)
  };
}

function mapPlatformEventRow(row: PlatformEventRow): PlatformEventRecord {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    taskId: row.task_id,
    eventType: row.event_type,
    payload: row.payload ?? {},
    createdAt: normalizeTimestamp(row.created_at)
  };
}

function mapPlatformArtifactRow(row: PlatformArtifactRow): PlatformArtifactRecord {
  return {
    artifactId: row.artifact_id,
    runId: row.run_id,
    taskId: row.task_id,
    kind: row.kind,
    path: row.path,
    schemaType: row.schema_type,
    metadata: row.metadata ?? {},
    createdAt: normalizeTimestamp(row.created_at)
  };
}

function buildTaskLeaseRecord(
  task: PlatformTaskRecord,
  workerId: string,
  leaseTtlSeconds: number,
  heartbeatIntervalSeconds: number
): PlatformTaskLeaseRecord {
  if (!task.currentLeaseId || !task.leaseExpiresAt || !task.lastHeartbeatAt) {
    throw new Error(`task ${task.taskId} is missing active lease metadata`);
  }

  return {
    runId: task.runId,
    taskId: task.taskId,
    stage: task.stage,
    status: task.status === 'in-progress' ? 'in-progress' : 'leased',
    workerId,
    leaseId: task.currentLeaseId,
    attemptNumber: task.attempts ?? 0,
    leaseExpiresAt: task.leaseExpiresAt,
    lastHeartbeatAt: task.lastHeartbeatAt,
    leaseTtlSeconds,
    heartbeatIntervalSeconds
  };
}

async function updatePlatformRunProgress(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  status: PlatformRunRecord['status'],
  currentStage: PlatformRunRecord['currentStage']
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.runs
      SET status = $2,
          current_stage = $3,
          updated_at = NOW(),
          started_at = COALESCE(started_at, NOW())
      WHERE run_id = $1
    `,
    [runId, status, currentStage]
  );
}

async function getPlatformTaskRow(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  taskId: string
): Promise<PlatformTaskRow | null> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<PlatformTaskRow>(
    `
      SELECT *
      FROM ${quotedSchema}.tasks
      WHERE run_id = $1 AND task_id = $2
      LIMIT 1
    `,
    [runId, taskId]
  );

  return result.rows[0] ?? null;
}

function inferLeaseRejectionReason(taskRow: PlatformTaskRow | null, workerId: string): HeartbeatPlatformTaskResult['reason'] {
  if (!taskRow) {
    return 'not-found';
  }

  if (!['leased', 'in-progress'].includes(taskRow.status)) {
    return 'not-leased';
  }

  if (taskRow.leased_by_worker_id !== workerId) {
    return 'not-owned';
  }

  return 'lease-expired';
}

function buildRejectedHeartbeatResult(
  options: HeartbeatPlatformTaskOptions,
  leaseTtlSeconds: number,
  heartbeatIntervalSeconds: number,
  reason: NonNullable<HeartbeatPlatformTaskResult['reason']>
): HeartbeatPlatformTaskResult {
  return {
    status: 'rejected',
    runId: options.runId,
    taskId: options.taskId,
    workerId: options.workerId,
    leaseTtlSeconds,
    heartbeatIntervalSeconds,
    reason,
    lease: null
  };
}

function buildRejectedStartResult(
  options: StartPlatformTaskOptions,
  leaseTtlSeconds: number,
  heartbeatIntervalSeconds: number,
  reason: NonNullable<StartPlatformTaskResult['reason']>
): StartPlatformTaskResult {
  return {
    status: 'rejected',
    runId: options.runId,
    taskId: options.taskId,
    workerId: options.workerId,
    leaseTtlSeconds,
    heartbeatIntervalSeconds,
    reason,
    lease: null
  };
}

export async function leaseNextPlatformTask(
  executor: SqlExecutor,
  schema: string,
  options: LeaseNextPlatformTaskOptions
): Promise<LeaseNextPlatformTaskResult> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const leaseTtlSeconds = options.leaseTtlSeconds ?? DEFAULT_PLATFORM_LEASE_TTL_SECONDS;
  const heartbeatIntervalSeconds = options.heartbeatIntervalSeconds ?? DEFAULT_PLATFORM_HEARTBEAT_INTERVAL_SECONDS;
  const leaseId = randomUUID();

  const leaseResult = await executor.query<PlatformTaskRow>(
    `
      WITH candidate AS (
        SELECT t.run_id, t.task_id
        FROM ${quotedSchema}.tasks t
        WHERE t.run_id = $1
          AND t.status = 'ready'
        ORDER BY
          CASE WHEN t.stage = 'environment-preparation' THEN 0 ELSE 1 END,
          jsonb_array_length(t.depends_on) ASC,
          t.created_at ASC,
          t.task_id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ),
      updated AS (
        UPDATE ${quotedSchema}.tasks t
        SET status = 'leased',
            attempts = t.attempts + 1,
            current_lease_id = $3,
            leased_by_worker_id = $2,
            lease_expires_at = NOW() + ($4 * INTERVAL '1 second'),
            last_heartbeat_at = NOW(),
            updated_at = NOW()
        FROM candidate
        WHERE t.run_id = candidate.run_id
          AND t.task_id = candidate.task_id
          AND t.status = 'ready'
        RETURNING t.*
      )
      SELECT *
      FROM updated
    `,
    [options.runId, options.workerId, leaseId, leaseTtlSeconds]
  );

  const leasedRow = leaseResult.rows[0] ?? null;
  if (!leasedRow) {
    return {
      status: 'no-ready-task',
      runId: options.runId,
      workerId: options.workerId,
      leaseTtlSeconds,
      heartbeatIntervalSeconds,
      task: null,
      lease: null
    };
  }

  const leasedTask = mapPlatformTaskRow(leasedRow);
  await executor.query(
    `
      INSERT INTO ${quotedSchema}.task_attempts (
        attempt_id,
        run_id,
        task_id,
        attempt_number,
        worker_id,
        leased_at,
        lease_expires_at,
        last_heartbeat_at,
        status,
        summary,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW(), $7, $8, $9::jsonb)
    `,
    [
      leaseId,
      leasedTask.runId,
      leasedTask.taskId,
      leasedTask.attempts ?? 0,
      options.workerId,
      leasedTask.leaseExpiresAt,
      'leased',
      'Task leased by scheduler primitive.',
      JSON.stringify({
        leaseTtlSeconds,
        heartbeatIntervalSeconds
      })
    ]
  );
  await updatePlatformRunProgress(executor, schema, options.runId, 'running', leasedTask.stage);
  await insertPlatformEvents(executor, schema, [
    {
      eventId: randomUUID(),
      runId: options.runId,
      taskId: leasedTask.taskId,
      eventType: 'task.leased',
      payload: {
        workerId: options.workerId,
        leaseId,
        attemptNumber: leasedTask.attempts ?? 0,
        leaseExpiresAt: leasedTask.leaseExpiresAt
      }
    }
  ]);

  return {
    status: 'leased',
    runId: options.runId,
    workerId: options.workerId,
    leaseTtlSeconds,
    heartbeatIntervalSeconds,
    task: leasedTask,
    lease: buildTaskLeaseRecord(leasedTask, options.workerId, leaseTtlSeconds, heartbeatIntervalSeconds)
  };
}

export async function heartbeatPlatformTask(
  executor: SqlExecutor,
  schema: string,
  options: HeartbeatPlatformTaskOptions
): Promise<HeartbeatPlatformTaskResult> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const leaseTtlSeconds = options.leaseTtlSeconds ?? DEFAULT_PLATFORM_LEASE_TTL_SECONDS;
  const heartbeatIntervalSeconds = options.heartbeatIntervalSeconds ?? DEFAULT_PLATFORM_HEARTBEAT_INTERVAL_SECONDS;
  const updateResult = await executor.query<PlatformTaskRow>(
    `
      UPDATE ${quotedSchema}.tasks
      SET lease_expires_at = NOW() + ($4 * INTERVAL '1 second'),
          last_heartbeat_at = NOW(),
          updated_at = NOW()
      WHERE run_id = $1
        AND task_id = $2
        AND status IN ('leased', 'in-progress')
        AND leased_by_worker_id = $3
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at >= NOW()
      RETURNING *
    `,
    [options.runId, options.taskId, options.workerId, leaseTtlSeconds]
  );

  const updatedRow = updateResult.rows[0] ?? null;
  if (!updatedRow) {
    const currentTask = await getPlatformTaskRow(executor, schema, options.runId, options.taskId);
    return buildRejectedHeartbeatResult(
      options,
      leaseTtlSeconds,
      heartbeatIntervalSeconds,
      inferLeaseRejectionReason(currentTask, options.workerId) ?? 'not-leased'
    );
  }

  const updatedTask = mapPlatformTaskRow(updatedRow);
  await executor.query(
    `
      UPDATE ${quotedSchema}.task_attempts
      SET lease_expires_at = $4,
          last_heartbeat_at = NOW(),
          status = $5,
          summary = $6
      WHERE attempt_id = $1
        AND run_id = $2
        AND task_id = $3
    `,
    [
      updatedTask.currentLeaseId,
      options.runId,
      options.taskId,
      updatedTask.leaseExpiresAt,
      updatedTask.status,
      'Lease heartbeat recorded.'
    ]
  );
  await insertPlatformEvents(executor, schema, [
    {
      eventId: randomUUID(),
      runId: options.runId,
      taskId: options.taskId,
      eventType: 'task.heartbeat',
      payload: {
        workerId: options.workerId,
        leaseId: updatedTask.currentLeaseId,
        leaseExpiresAt: updatedTask.leaseExpiresAt
      }
    }
  ]);

  return {
    status: 'renewed',
    runId: options.runId,
    taskId: options.taskId,
    workerId: options.workerId,
    leaseTtlSeconds,
    heartbeatIntervalSeconds,
    lease: buildTaskLeaseRecord(updatedTask, options.workerId, leaseTtlSeconds, heartbeatIntervalSeconds)
  };
}

export async function startPlatformTask(
  executor: SqlExecutor,
  schema: string,
  options: StartPlatformTaskOptions
): Promise<StartPlatformTaskResult> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const leaseTtlSeconds = options.leaseTtlSeconds ?? DEFAULT_PLATFORM_LEASE_TTL_SECONDS;
  const heartbeatIntervalSeconds = options.heartbeatIntervalSeconds ?? DEFAULT_PLATFORM_HEARTBEAT_INTERVAL_SECONDS;
  const updateResult = await executor.query<PlatformTaskRow>(
    `
      UPDATE ${quotedSchema}.tasks
      SET status = 'in-progress',
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW()
      WHERE run_id = $1
        AND task_id = $2
        AND status = 'leased'
        AND leased_by_worker_id = $3
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at >= NOW()
      RETURNING *
    `,
    [options.runId, options.taskId, options.workerId]
  );

  const updatedRow = updateResult.rows[0] ?? null;
  if (!updatedRow) {
    const currentTask = await getPlatformTaskRow(executor, schema, options.runId, options.taskId);
    return buildRejectedStartResult(
      options,
      leaseTtlSeconds,
      heartbeatIntervalSeconds,
      inferLeaseRejectionReason(currentTask, options.workerId) ?? 'not-leased'
    );
  }

  const updatedTask = mapPlatformTaskRow(updatedRow);
  await executor.query(
    `
      UPDATE ${quotedSchema}.task_attempts
      SET status = 'in-progress',
          started_at = COALESCE(started_at, NOW()),
          summary = 'Task execution started.'
      WHERE attempt_id = $1
        AND run_id = $2
        AND task_id = $3
    `,
    [updatedTask.currentLeaseId, options.runId, options.taskId]
  );
  await updatePlatformRunProgress(executor, schema, options.runId, 'running', updatedTask.stage);
  await insertPlatformEvents(executor, schema, [
    {
      eventId: randomUUID(),
      runId: options.runId,
      taskId: options.taskId,
      eventType: 'task.started',
      payload: {
        workerId: options.workerId,
        leaseId: updatedTask.currentLeaseId
      }
    }
  ]);

  return {
    status: 'started',
    runId: options.runId,
    taskId: options.taskId,
    workerId: options.workerId,
    leaseTtlSeconds,
    heartbeatIntervalSeconds,
    lease: buildTaskLeaseRecord(updatedTask, options.workerId, leaseTtlSeconds, heartbeatIntervalSeconds)
  };
}

export async function expirePlatformLeases(
  executor: SqlExecutor,
  schema: string,
  options: ExpirePlatformLeasesOptions
): Promise<ExpirePlatformLeasesResult> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const expiredRows = await executor.query<PlatformTaskRow>(
    `
      SELECT *
      FROM ${quotedSchema}.tasks
      WHERE run_id = $1
        AND status IN ('leased', 'in-progress')
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < NOW()
      ORDER BY lease_expires_at ASC, task_id ASC
      FOR UPDATE SKIP LOCKED
    `,
    [options.runId]
  );

  const requeuedTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  let eventsWritten = 0;

  for (const expiredRow of expiredRows.rows) {
    const expiredTask = mapPlatformTaskRow(expiredRow);
    const nextRetryCount = (expiredTask.retryCount ?? 0) + 1;
    const canRetry = nextRetryCount <= (expiredTask.maxRetries ?? DEFAULT_PLATFORM_MAX_RETRIES);
    const nextStatus: PlatformTaskRecord['status'] = canRetry ? 'ready' : 'blocked';

    await executor.query(
      `
        UPDATE ${quotedSchema}.tasks
        SET status = $4,
            retry_count = $5,
            current_lease_id = NULL,
            leased_by_worker_id = NULL,
            lease_expires_at = NULL,
            last_heartbeat_at = NULL,
            updated_at = NOW()
        WHERE run_id = $1
          AND task_id = $2
          AND current_lease_id = $3
      `,
      [expiredTask.runId, expiredTask.taskId, expiredTask.currentLeaseId, nextStatus, nextRetryCount]
    );
    await executor.query(
      `
        UPDATE ${quotedSchema}.task_attempts
        SET status = 'expired',
            completed_at = NOW(),
            summary = $4
        WHERE attempt_id = $1
          AND run_id = $2
          AND task_id = $3
      `,
      [
        expiredTask.currentLeaseId,
        expiredTask.runId,
        expiredTask.taskId,
        canRetry ? 'Lease expired; task requeued.' : 'Lease expired; retry budget exhausted.'
      ]
    );

    const events: PlatformEventRecord[] = [
      {
        eventId: randomUUID(),
        runId: expiredTask.runId,
        taskId: expiredTask.taskId,
        eventType: 'task.lease-expired',
        payload: {
          leaseId: expiredTask.currentLeaseId,
          leaseExpiresAt: expiredTask.leaseExpiresAt,
          retryCount: nextRetryCount,
          maxRetries: expiredTask.maxRetries ?? DEFAULT_PLATFORM_MAX_RETRIES
        }
      }
    ];

    if (canRetry) {
      requeuedTaskIds.push(expiredTask.taskId);
      events.push(
        {
          eventId: randomUUID(),
          runId: expiredTask.runId,
          taskId: expiredTask.taskId,
          eventType: 'task.retry-scheduled',
          payload: {
            retryCount: nextRetryCount,
            maxRetries: expiredTask.maxRetries ?? DEFAULT_PLATFORM_MAX_RETRIES
          }
        },
        {
          eventId: randomUUID(),
          runId: expiredTask.runId,
          taskId: expiredTask.taskId,
          eventType: 'task.requeued',
          payload: {
            status: 'ready'
          }
        }
      );
    } else {
      blockedTaskIds.push(expiredTask.taskId);
      events.push({
        eventId: randomUUID(),
        runId: expiredTask.runId,
        taskId: expiredTask.taskId,
        eventType: 'task.retry-exhausted',
        payload: {
          retryCount: nextRetryCount,
          maxRetries: expiredTask.maxRetries ?? DEFAULT_PLATFORM_MAX_RETRIES,
          terminalStatus: 'blocked'
        }
      });
      await updatePlatformRunProgress(executor, schema, expiredTask.runId, 'blocked', expiredTask.stage);
    }

    await insertPlatformEvents(executor, schema, events);
    eventsWritten += events.length;
  }

  return {
    status: 'completed',
    runId: options.runId,
    expiredLeaseCount: expiredRows.rows.length,
    requeuedTaskIds,
    blockedTaskIds,
    eventsWritten
  };
}

export async function getPlatformRunState(
  executor: SqlExecutor,
  schema: string,
  options: GetPlatformRunStateOptions
): Promise<PlatformRunStateSnapshot> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const eventLimit = options.eventLimit ?? DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT;

  const runResult = await executor.query<PlatformRunRow>(
    `
      SELECT *
      FROM ${quotedSchema}.runs
      WHERE run_id = $1
      LIMIT 1
    `,
    [options.runId]
  );
  const taskResult = await executor.query<PlatformTaskRow>(
    `
      SELECT *
      FROM ${quotedSchema}.tasks
      WHERE run_id = $1
      ORDER BY
        CASE WHEN stage = 'environment-preparation' THEN 0 ELSE 1 END,
        created_at ASC,
        task_id ASC
    `,
    [options.runId]
  );
  const eventResult = await executor.query<PlatformEventRow>(
    `
      SELECT *
      FROM ${quotedSchema}.events
      WHERE run_id = $1
      ORDER BY created_at DESC, event_id DESC
      LIMIT $2
    `,
    [options.runId, eventLimit]
  );
  const artifactResult = await executor.query<PlatformArtifactRow>(
    `
      SELECT *
      FROM ${quotedSchema}.artifacts
      WHERE run_id = $1
      ORDER BY created_at ASC, artifact_id ASC
    `,
    [options.runId]
  );

  return {
    run: runResult.rows[0] ? mapPlatformRunRow(runResult.rows[0]) : null,
    tasks: taskResult.rows.map((row) => mapPlatformTaskRow(row)),
    recentEvents: eventResult.rows.map((row) => mapPlatformEventRow(row)),
    artifacts: artifactResult.rows.map((row) => mapPlatformArtifactRow(row))
  };
}
