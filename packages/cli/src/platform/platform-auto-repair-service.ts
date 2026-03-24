import { randomUUID } from 'node:crypto';
import { insertPlatformEvents } from './platform-repository.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import type { ExecutionStateDocument, PlatformEventRecord, PlatformRepairAttemptRecord, TaskStage, TaskStatus } from '../types/index.js';

interface RepairAttemptRow extends Record<string, unknown> {
  repair_attempt_id: string;
  run_id: string;
  source_task_id: string;
  trigger_task_id: string;
  source_stage: TaskStage;
  failure_class: string;
  recommended_action: string | null;
  attempt_number: number;
  status: PlatformRepairAttemptRecord['status'];
  metadata: Record<string, unknown>;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  completed_at: Date | string | null;
}

export interface ReconcilePlatformAutoRepairOptions {
  runId: string;
  currentTaskId: string;
  previousState: ExecutionStateDocument;
  nextState: ExecutionStateDocument;
}

export interface ReconcilePlatformAutoRepairResult {
  requestedRepairAttempts: number;
  resolvedRepairAttempts: number;
  blockedRepairAttempts: number;
  eventsWritten: number;
}

function normalizeMaybeTaskId(value: string | null): string | null {
  if (!value || value === 'none') {
    return null;
  }

  return value;
}

function getTaskStateIndex(state: ExecutionStateDocument): Map<string, ExecutionStateDocument['executionState']['tasks'][number]> {
  return new Map(state.executionState.tasks.map((task) => [task.taskId, task]));
}

function extractLatestNumericNote(notes: string[] | undefined, prefix: string): number {
  const matches = (notes ?? [])
    .filter((note) => note.startsWith(prefix))
    .map((note) => Number.parseInt(note.slice(prefix.length), 10))
    .filter((value) => Number.isInteger(value) && value >= 0);

  return matches.length > 0 ? Math.max(...matches) : 0;
}

function extractLatestTextNote(notes: string[] | undefined, prefix: string): string | null {
  const match = [...(notes ?? [])].reverse().find((note) => note.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function getTaskStage(taskId: string): TaskStage | null {
  if (!taskId.includes('--')) {
    return null;
  }

  const stage = taskId.split('--').slice(1).join('--');
  switch (stage) {
    case 'requirements-analysis':
    case 'code-implementation':
    case 'test-design':
    case 'automated-execution':
    case 'defect-feedback':
    case 'collaboration':
    case 'environment-preparation':
      return stage;
    default:
      return null;
  }
}

async function listOpenRepairAttempts(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  sourceTaskId: string
): Promise<RepairAttemptRow[]> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<RepairAttemptRow>(
    `
      SELECT *
      FROM ${quotedSchema}.repair_attempts
      WHERE run_id = $1
        AND source_task_id = $2
        AND status = 'requested'
      ORDER BY attempt_number DESC, created_at DESC
    `,
    [runId, sourceTaskId]
  );

  return result.rows;
}

async function insertRepairAttempt(
  executor: SqlExecutor,
  schema: string,
  attempt: Omit<PlatformRepairAttemptRecord, 'createdAt' | 'updatedAt' | 'completedAt'>
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      INSERT INTO ${quotedSchema}.repair_attempts (
        repair_attempt_id,
        run_id,
        source_task_id,
        trigger_task_id,
        source_stage,
        failure_class,
        recommended_action,
        attempt_number,
        status,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    `,
    [
      attempt.repairAttemptId,
      attempt.runId,
      attempt.sourceTaskId,
      attempt.triggerTaskId,
      attempt.sourceStage,
      attempt.failureClass,
      attempt.recommendedAction ?? null,
      attempt.attemptNumber,
      attempt.status,
      JSON.stringify(attempt.metadata ?? {})
    ]
  );
}

async function updateRepairAttemptStatus(
  executor: SqlExecutor,
  schema: string,
  repairAttemptId: string,
  status: PlatformRepairAttemptRecord['status'],
  metadata: Record<string, unknown>
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.repair_attempts
      SET status = $2,
          metadata = $3::jsonb,
          updated_at = NOW(),
          completed_at = NOW()
      WHERE repair_attempt_id = $1
    `,
    [repairAttemptId, status, JSON.stringify(metadata)]
  );
}

async function updateTaskAutoRepairCount(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  taskId: string,
  autoRepairCount: number
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.tasks
      SET auto_repair_count = GREATEST(auto_repair_count, $3),
          updated_at = NOW()
      WHERE run_id = $1
        AND task_id = $2
    `,
    [runId, taskId, autoRepairCount]
  );
}

export async function reconcilePlatformAutoRepair(
  executor: SqlExecutor,
  schema: string,
  options: ReconcilePlatformAutoRepairOptions
): Promise<ReconcilePlatformAutoRepairResult> {
  const previousIndex = getTaskStateIndex(options.previousState);
  const nextIndex = getTaskStateIndex(options.nextState);
  const events: PlatformEventRecord[] = [];
  let requestedRepairAttempts = 0;
  let resolvedRepairAttempts = 0;
  let blockedRepairAttempts = 0;

  for (const [taskId, nextTask] of nextIndex) {
    const previousTask = previousIndex.get(taskId);
    const previousAttemptCount = extractLatestNumericNote(previousTask?.notes, 'auto-repair-attempt:');
    const nextAttemptCount = extractLatestNumericNote(nextTask.notes, 'auto-repair-attempt:');

    if (nextAttemptCount <= previousAttemptCount) {
      continue;
    }

    const sourceStage = getTaskStage(taskId);
    if (!sourceStage) {
      continue;
    }

    const failureClass = extractLatestTextNote(nextTask.notes, 'auto-repair-class:') ?? 'unknown';
    const recommendedAction = extractLatestTextNote(nextTask.notes, 'auto-repair-reason:');

    await insertRepairAttempt(executor, schema, {
      repairAttemptId: randomUUID(),
      runId: options.runId,
      sourceTaskId: taskId,
      triggerTaskId: options.currentTaskId,
      sourceStage,
      failureClass,
      recommendedAction,
      attemptNumber: nextAttemptCount,
      status: 'requested',
      metadata: {
        currentTaskId: options.currentTaskId
      }
    });
    await updateTaskAutoRepairCount(executor, schema, options.runId, taskId, nextAttemptCount);
    requestedRepairAttempts += 1;
    events.push({
      eventId: randomUUID(),
      runId: options.runId,
      taskId,
      eventType: 'repair.triggered',
      payload: {
        triggerTaskId: options.currentTaskId,
        sourceStage,
        attemptNumber: nextAttemptCount,
        failureClass,
        recommendedAction
      }
    });
  }

  const currentTask = nextIndex.get(options.currentTaskId);
  const currentTaskStatus = currentTask?.status;
  const currentTaskAttemptCount = extractLatestNumericNote(currentTask?.notes, 'auto-repair-attempt:');
  const previousEscalationReason = extractLatestTextNote(previousIndex.get(options.currentTaskId)?.notes, 'auto-repair-escalated:');
  const nextEscalationReason = extractLatestTextNote(currentTask?.notes, 'auto-repair-escalated:');

  if (currentTask && nextEscalationReason && nextEscalationReason !== previousEscalationReason) {
    const targetTaskId = normalizeMaybeTaskId(extractLatestTextNote(currentTask.notes, 'auto-repair-target:'));
    const attemptNumber = extractLatestNumericNote(currentTask.notes, 'auto-repair-next-attempt:');
    const recommendedAction = extractLatestTextNote(currentTask.notes, 'auto-repair-reason:');
    const failureClass = extractLatestTextNote(currentTask.notes, 'route-class:') ?? 'unknown';
    const sourceStage = targetTaskId ? getTaskStage(targetTaskId) : null;

    if (targetTaskId && sourceStage && attemptNumber > 0) {
      await insertRepairAttempt(executor, schema, {
        repairAttemptId: randomUUID(),
        runId: options.runId,
        sourceTaskId: targetTaskId,
        triggerTaskId: options.currentTaskId,
        sourceStage,
        failureClass,
        recommendedAction,
        attemptNumber,
        status: 'blocked',
        metadata: {
          escalationReason: nextEscalationReason
        }
      });
    }

    blockedRepairAttempts += 1;
    events.push({
      eventId: randomUUID(),
      runId: options.runId,
      taskId: options.currentTaskId,
      eventType: 'repair.escalated',
      payload: {
        reason: nextEscalationReason,
        targetTaskId,
        attemptNumber: attemptNumber > 0 ? attemptNumber : null,
        recommendedAction
      }
    });
  }

  if (currentTask && currentTaskAttemptCount > 0 && ['completed', 'failed', 'blocked'].includes(currentTaskStatus ?? '')) {
    const openAttempts = await listOpenRepairAttempts(executor, schema, options.runId, options.currentTaskId);
    const openAttempt = openAttempts.find((attempt) => attempt.attempt_number === currentTaskAttemptCount) ?? openAttempts[0] ?? null;

    if (openAttempt) {
      const nextStatus: PlatformRepairAttemptRecord['status'] =
        currentTaskStatus === 'completed' ? 'succeeded'
          : currentTaskStatus === 'blocked' ? 'blocked'
            : 'failed';
      await updateRepairAttemptStatus(executor, schema, openAttempt.repair_attempt_id, nextStatus, {
        taskStatus: currentTaskStatus
      });
      if (nextStatus === 'blocked') {
        blockedRepairAttempts += 1;
      } else {
        resolvedRepairAttempts += 1;
      }
      events.push({
        eventId: randomUUID(),
        runId: options.runId,
        taskId: options.currentTaskId,
        eventType: nextStatus === 'succeeded' ? 'repair.succeeded' : nextStatus === 'blocked' ? 'repair.blocked' : 'repair.failed',
        payload: {
          attemptNumber: openAttempt.attempt_number,
          taskStatus: currentTaskStatus
        }
      });
    }
  }

  if (events.length > 0) {
    await insertPlatformEvents(executor, schema, events);
  }

  return {
    requestedRepairAttempts,
    resolvedRepairAttempts,
    blockedRepairAttempts,
    eventsWritten: events.length
  };
}
