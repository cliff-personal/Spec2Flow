import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { executeTaskRunAsync, type AdapterRunnerDependencies, type CliOptions as AdapterCliOptions } from '../adapters/adapter-runner.js';
import {
  buildTaskClaim,
  type AdapterCapabilityDocument,
  type ProjectPayload
} from '../runtime/task-claim-service.js';
import {
  validateExecutionStatePayload
} from '../runtime/execution-state-service.js';
import { applyTaskResult } from '../runtime/task-result-service.js';
import { runDeterministicTaskAsync } from '../runtime/deterministic-execution-service.js';
import { loadOptionalStructuredFile, readStructuredFile, writeJson } from '../shared/fs-utils.js';
import { insertPlatformArtifacts, insertPlatformEvents } from './platform-repository.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import { getPlatformRunState } from './platform-scheduler-service.js';
import type {
  AdapterRunDocument,
  ArtifactRef,
  ErrorItem,
  ExecutionStateDocument,
  PlatformRunStatus,
  PlatformArtifactRecord,
  PlatformRunStateSnapshot,
  PlatformTaskRecord,
  PlatformWorkerIdentity,
  TaskClaimPayload,
  TaskGraphDocument,
  TaskResultDocument,
  TaskStage,
  TaskStatus
} from '../types/index.js';

const DEFAULT_PLATFORM_WORKER_EVENT_LIMIT = 20;

export interface PlatformWorkerClaimOptions extends PlatformWorkerIdentity {
  runId: string;
  taskId: string;
  outputBaseDir?: string;
  adapterCapabilityPath?: string;
  adapter?: string;
  model?: string;
  sessionId?: string;
}

export interface PlatformWorkerMaterialization {
  runId: string;
  taskId: string;
  workerId: string;
  stage: TaskStage;
  outputBaseDir: string;
  taskGraphPath: string;
  executionStatePath: string;
  claimPath: string;
  taskGraphPayload: TaskGraphDocument;
  executionStatePayload: ExecutionStateDocument;
  claimPayload: TaskClaimPayload;
  snapshot: PlatformRunStateSnapshot;
}

export interface PersistPlatformWorkerResultOptions extends PlatformWorkerIdentity {
  runId: string;
  taskId: string;
  materialization: PlatformWorkerMaterialization;
  adapterRun: AdapterRunDocument['adapterRun'];
  receipt: TaskResultDocument['taskResult'];
  eventLimit?: number;
}

export interface PersistPlatformWorkerResult {
  runId: string;
  taskId: string;
  workerId: string;
  updatedTasks: Array<{
    taskId: string;
    previousStatus: TaskStatus;
    nextStatus: TaskStatus;
  }>;
  insertedArtifactCount: number;
  platformRunState: PlatformRunStateSnapshot;
}

export interface ExecutePlatformWorkerMaterializationOptions {
  materialization: PlatformWorkerMaterialization;
  adapterRuntimePath?: string;
  adapterRuntimePayloadProvided?: boolean;
  adapterCapabilityPath?: string;
  executor?: string;
  expectedStage?: TaskStage;
  signal?: AbortSignal;
}

export interface PlatformWorkerExecutionResult {
  mode: 'deterministic' | 'external-adapter' | 'stopped';
  adapterRun: AdapterRunDocument['adapterRun'];
  receipt: TaskResultDocument['taskResult'];
  materialization: PlatformWorkerMaterialization;
}

export interface BuildStoppedPlatformWorkerExecutionOptions {
  materialization: PlatformWorkerMaterialization;
  message: string;
  code?: string;
  recoverable?: boolean;
}

function sanitizeFileToken(value: string): string {
  return value.replaceAll(/[^a-z0-9-]+/gi, '-').replaceAll(/^-+|-+$/g, '').toLowerCase() || 'task';
}

function getPlatformArtifactRefId(artifact: PlatformRunStateSnapshot['artifacts'][number]): string {
  const metadataRef = typeof artifact.metadata?.originalArtifactId === 'string'
    ? artifact.metadata.originalArtifactId
    : null;
  return metadataRef ?? artifact.artifactId;
}

function mapPlatformTaskStatusToTaskStatus(status: PlatformTaskRecord['status']): TaskStatus {
  switch (status) {
    case 'pending':
    case 'ready':
    case 'in-progress':
    case 'blocked':
    case 'completed':
    case 'failed':
    case 'skipped':
      return status;
    case 'leased':
      return 'in-progress';
    case 'retryable-failed':
      return 'failed';
    case 'cancelled':
      return 'blocked';
    default:
      return 'pending';
  }
}

function toExecutionStateStatus(status: PlatformRunStatus): ExecutionStateDocument['executionState']['status'] {
  switch (status) {
    case 'pending':
    case 'running':
    case 'blocked':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return status;
    default:
      return 'pending';
  }
}

function buildExecutionStateFromPlatformSnapshot(
  snapshot: PlatformRunStateSnapshot,
  taskGraphPayload: TaskGraphDocument,
  taskGraphPath: string,
  options: PlatformWorkerClaimOptions
): ExecutionStateDocument {
  const taskIndex = new Map(snapshot.tasks.map((task) => [task.taskId, task]));
  const artifactRefs: ArtifactRef[] = snapshot.artifacts.map((artifact) => ({
    id: getPlatformArtifactRefId(artifact),
    kind: artifact.kind,
    path: artifact.path,
    ...(artifact.taskId ? { taskId: artifact.taskId } : {})
  }));
  const unscopedArtifactIds = artifactRefs.filter((artifact) => !artifact.taskId).map((artifact) => artifact.id);

  const tasks = taskGraphPayload.taskGraph.tasks.map((task) => {
    const platformTask = taskIndex.get(task.id);
    const taskArtifactRefs = artifactRefs
      .filter((artifact) => artifact.taskId === task.id)
      .map((artifact) => artifact.id);

    return {
      taskId: task.id,
      status: mapPlatformTaskStatusToTaskStatus(platformTask?.status ?? task.status),
      executor: task.executorType,
      attempts: platformTask?.attempts ?? 0,
      ...(platformTask?.startedAt ? { startedAt: platformTask.startedAt } : {}),
      ...(platformTask?.completedAt ? { completedAt: platformTask.completedAt } : {}),
      artifactRefs: task.id === 'environment-preparation'
        ? [...new Set([...taskArtifactRefs, ...unscopedArtifactIds])]
        : taskArtifactRefs
    };
  });

  const provider = {
    adapter: options.adapter ?? 'spec2flow-platform-worker',
    ...(options.model ? { model: options.model } : {}),
    ...(options.sessionId ? { sessionId: options.sessionId } : {})
  };

  return {
    executionState: {
      runId: snapshot.run?.runId ?? options.runId,
      workflowName: snapshot.run?.workflowName ?? taskGraphPayload.taskGraph.workflowName,
      status: toExecutionStateStatus(snapshot.run?.status ?? 'pending'),
      ...(snapshot.run?.currentStage ? { currentStage: snapshot.run.currentStage } : {}),
      provider,
      startedAt: snapshot.run?.startedAt ?? snapshot.run?.createdAt ?? new Date().toISOString(),
      updatedAt: snapshot.run?.updatedAt ?? snapshot.run?.createdAt ?? new Date().toISOString(),
      tasks,
      artifacts: [
        ...artifactRefs,
        ...artifactRefs.some((artifact) => artifact.id === 'task-graph')
          ? []
          : [{
              id: 'task-graph',
              kind: 'report' as const,
              path: taskGraphPath
            }]
      ],
      errors: []
    }
  };
}

function getTaskGraphArtifact(snapshot: PlatformRunStateSnapshot): PlatformRunStateSnapshot['artifacts'][number] | null {
  return snapshot.artifacts.find((artifact) => artifact.schemaType === 'task-graph') ?? null;
}

function resolvePlatformWorkerOutputBaseDir(options: PlatformWorkerClaimOptions): string {
  if (options.outputBaseDir) {
    return path.resolve(options.outputBaseDir);
  }

  return path.resolve(
    '.spec2flow',
    'runtime',
    'platform-workers',
    sanitizeFileToken(options.runId),
    sanitizeFileToken(options.taskId)
  );
}

function assertPlatformWorkerTask(
  snapshot: PlatformRunStateSnapshot,
  options: PlatformWorkerClaimOptions
): PlatformTaskRecord {
  const task = snapshot.tasks.find((entry) => entry.taskId === options.taskId) ?? null;
  if (!task) {
    throw new Error(`unknown platform task: ${options.taskId}`);
  }

  if (!['leased', 'in-progress'].includes(task.status)) {
    throw new Error(`platform task ${options.taskId} is not leased or in-progress`);
  }

  if (task.leasedByWorkerId !== options.workerId) {
    throw new Error(`platform task ${options.taskId} is not owned by worker ${options.workerId}`);
  }

  if (!task.leaseExpiresAt) {
    throw new Error(`platform task ${options.taskId} does not have an active lease expiry`);
  }

  const leaseExpiryTime = Date.parse(task.leaseExpiresAt);
  if (Number.isNaN(leaseExpiryTime) || leaseExpiryTime < Date.now()) {
    throw new Error(`platform task ${options.taskId} lease has expired`);
  }

  return task;
}

function readTaskGraphDocument(taskGraphPath: string): TaskGraphDocument {
  return readStructuredFile(taskGraphPath) as TaskGraphDocument;
}

export async function materializePlatformWorkerClaim(
  executor: SqlExecutor,
  schema: string,
  options: PlatformWorkerClaimOptions
): Promise<PlatformWorkerMaterialization> {
  const snapshot = await getPlatformRunState(executor, schema, {
    runId: options.runId,
    eventLimit: DEFAULT_PLATFORM_WORKER_EVENT_LIMIT
  });
  if (!snapshot.run) {
    throw new Error(`unknown platform run: ${options.runId}`);
  }

  const platformTask = assertPlatformWorkerTask(snapshot, options);
  const taskGraphArtifact = getTaskGraphArtifact(snapshot);
  if (!taskGraphArtifact) {
    throw new Error(`platform run ${options.runId} does not include a task-graph artifact`);
  }

  const taskGraphPayload = readTaskGraphDocument(taskGraphArtifact.path);
  const taskGraphTask = taskGraphPayload.taskGraph.tasks.find((task) => task.id === options.taskId) ?? null;
  if (!taskGraphTask) {
    throw new Error(`task graph does not define task ${options.taskId}`);
  }

  const outputBaseDir = resolvePlatformWorkerOutputBaseDir(options);
  const executionStatePath = path.join(outputBaseDir, 'execution-state.json');
  const claimPath = path.join(outputBaseDir, 'task-claim.json');
  const executionStatePayload = buildExecutionStateFromPlatformSnapshot(snapshot, taskGraphPayload, taskGraphArtifact.path, options);
  validateExecutionStatePayload(executionStatePayload, executionStatePath);
  writeJson(executionStatePath, executionStatePayload);

  const projectPayload = loadOptionalStructuredFile<ProjectPayload>(taskGraphPayload.taskGraph.source?.projectAdapterRef ?? undefined);
  const adapterCapabilityPayload = loadOptionalStructuredFile<AdapterCapabilityDocument>(options.adapterCapabilityPath);
  const claimPayload = buildTaskClaim(
    taskGraphTask,
    executionStatePayload,
    taskGraphPayload,
    projectPayload,
    adapterCapabilityPayload,
    {
      state: executionStatePath,
      taskGraph: taskGraphArtifact.path,
      adapterCapability: options.adapterCapabilityPath ?? null
    }
  );
  writeJson(claimPath, claimPayload);

  return {
    runId: options.runId,
    taskId: options.taskId,
    workerId: options.workerId,
    stage: platformTask.stage,
    outputBaseDir,
    taskGraphPath: taskGraphArtifact.path,
    executionStatePath,
    claimPath,
    taskGraphPayload,
    executionStatePayload,
    claimPayload,
    snapshot
  };
}

function assertExpectedStage(actualStage: TaskStage, expectedStage: TaskStage | undefined): void {
  if (expectedStage && actualStage !== expectedStage) {
    throw new Error(`platform worker expected stage ${expectedStage} but task is ${actualStage}`);
  }
}

async function runDeterministicMaterializedTask(
  materialization: PlatformWorkerMaterialization,
  options: ExecutePlatformWorkerMaterializationOptions
): Promise<PlatformWorkerExecutionResult> {
  const adapterRunDocument = await runDeterministicTaskAsync(
    materialization.claimPayload,
    process.cwd(),
    options.signal ? { signal: options.signal } : {}
  );
  const executionStatePayload = readStructuredFile(materialization.executionStatePath) as ExecutionStateDocument;
  const receipt = applyTaskResult(executionStatePayload, materialization.taskGraphPayload, materialization.executionStatePath, {
    taskId: materialization.taskId,
    taskStatus: adapterRunDocument.adapterRun.status,
    notes: [`summary:${adapterRunDocument.adapterRun.summary}`, ...adapterRunDocument.adapterRun.notes],
    artifacts: adapterRunDocument.adapterRun.artifacts,
    errors: adapterRunDocument.adapterRun.errors,
    ...(options.executor ? { executor: options.executor } : {})
  });

  return {
    mode: 'deterministic',
    adapterRun: adapterRunDocument.adapterRun,
    receipt: receipt.taskResult,
    materialization
  };
}

async function runExternalMaterializedTask(
  materialization: PlatformWorkerMaterialization,
  options: ExecutePlatformWorkerMaterializationOptions,
  dependencies: AdapterRunnerDependencies
): Promise<PlatformWorkerExecutionResult> {
  if (!options.adapterRuntimePath) {
    throw new Error(`platform worker for ${materialization.stage} requires --adapter-runtime`);
  }

  const result = await executeTaskRunAsync(
    materialization.executionStatePath,
    materialization.taskGraphPath,
    materialization.claimPayload,
    {
      ...(options.adapterCapabilityPath ? { 'adapter-capability': options.adapterCapabilityPath } : {}),
      'adapter-runtime': options.adapterRuntimePath,
      ...(options.executor ? { executor: options.executor } : {})
    } satisfies AdapterCliOptions,
    {
      ...dependencies,
      ...(options.signal ? { signal: options.signal } : {})
    }
  );

  return {
    mode: 'external-adapter',
    adapterRun: result.adapterRun,
    receipt: result.receipt,
    materialization
  };
}

export async function executePlatformWorkerMaterialization(
  options: ExecutePlatformWorkerMaterializationOptions,
  dependencies: AdapterRunnerDependencies
): Promise<PlatformWorkerExecutionResult> {
  assertExpectedStage(options.materialization.stage, options.expectedStage);

  if (
    !options.adapterRuntimePath &&
    ['environment-preparation', 'automated-execution'].includes(options.materialization.stage)
  ) {
    return runDeterministicMaterializedTask(options.materialization, options);
  }

  return runExternalMaterializedTask(options.materialization, options, dependencies);
}

export function buildStoppedPlatformWorkerExecutionResult(
  options: BuildStoppedPlatformWorkerExecutionOptions
): PlatformWorkerExecutionResult {
  const executionStatePayload = readStructuredFile(options.materialization.executionStatePath) as ExecutionStateDocument;
  const code = options.code ?? 'platform-worker-stopped';
  const receipt = applyTaskResult(executionStatePayload, options.materialization.taskGraphPayload, options.materialization.executionStatePath, {
    taskId: options.materialization.taskId,
    taskStatus: 'blocked',
    notes: [`summary:${options.message}`, `platform-worker-stop:${code}`],
    artifacts: [],
    errors: [
      {
        code,
        message: options.message,
        taskId: options.materialization.taskId,
        recoverable: options.recoverable ?? true
      }
    ]
  });

  return {
    mode: 'stopped',
    adapterRun: {
      adapterName: 'spec2flow-platform-worker',
      provider: 'spec2flow-platform-worker',
      taskId: options.materialization.taskId,
      runId: options.materialization.runId,
      stage: options.materialization.stage,
      status: 'blocked',
      summary: options.message,
      notes: [`platform-worker-stop:${code}`],
      activity: {
        commands: [],
        editedFiles: [],
        artifactFiles: [],
        collaborationActions: []
      },
      artifacts: [],
      errors: [
        {
          code,
          message: options.message,
          taskId: options.materialization.taskId,
          recoverable: options.recoverable ?? true
        }
      ]
    },
    receipt: receipt.taskResult,
    materialization: options.materialization
  };
}

function buildExecutionStateTaskIndex(executionStatePayload: ExecutionStateDocument): Map<string, ExecutionStateDocument['executionState']['tasks'][number]> {
  return new Map(executionStatePayload.executionState.tasks.map((task) => [task.taskId, task]));
}

function collectChangedTaskStates(
  previousState: ExecutionStateDocument,
  nextState: ExecutionStateDocument
): Array<{
  taskId: string;
  previousStatus: TaskStatus;
  nextStatus: TaskStatus;
  nextTaskState: ExecutionStateDocument['executionState']['tasks'][number];
}> {
  const previousIndex = buildExecutionStateTaskIndex(previousState);
  const nextIndex = buildExecutionStateTaskIndex(nextState);
  const changedTasks: Array<{
    taskId: string;
    previousStatus: TaskStatus;
    nextStatus: TaskStatus;
    nextTaskState: ExecutionStateDocument['executionState']['tasks'][number];
  }> = [];

  for (const [taskId, nextTaskState] of nextIndex) {
    const previousTaskState = previousIndex.get(taskId);
    const previousStatus = previousTaskState?.status ?? 'pending';
    if (
      previousStatus !== nextTaskState.status ||
      previousTaskState?.startedAt !== nextTaskState.startedAt ||
      previousTaskState?.completedAt !== nextTaskState.completedAt
    ) {
      changedTasks.push({
        taskId,
        previousStatus,
        nextStatus: nextTaskState.status,
        nextTaskState
      });
    }
  }

  return changedTasks;
}

function collectNewArtifacts(previousState: ExecutionStateDocument, nextState: ExecutionStateDocument): ArtifactRef[] {
  const previousArtifactKeys = new Set(
    (previousState.executionState.artifacts ?? []).map((artifact) => `${artifact.id}|${artifact.kind}|${artifact.path}|${artifact.taskId ?? ''}`)
  );

  return (nextState.executionState.artifacts ?? []).filter((artifact) => {
    const key = `${artifact.id}|${artifact.kind}|${artifact.path}|${artifact.taskId ?? ''}`;
    return !previousArtifactKeys.has(key);
  });
}

function collectNewErrors(previousState: ExecutionStateDocument, nextState: ExecutionStateDocument, taskId: string): ErrorItem[] {
  const previousErrorKeys = new Set(
    (previousState.executionState.errors ?? []).map((error) => JSON.stringify(error))
  );

  return (nextState.executionState.errors ?? [])
    .filter((error) => error.taskId === taskId)
    .filter((error) => !previousErrorKeys.has(JSON.stringify(error)));
}

function inferTaskStatusEventType(status: TaskStatus): string | null {
  switch (status) {
    case 'ready':
      return 'task.ready';
    case 'completed':
      return 'task.completed';
    case 'failed':
      return 'task.failed';
    case 'blocked':
      return 'task.blocked';
    case 'skipped':
      return 'task.skipped';
    case 'in-progress':
      return 'task.started';
    default:
      return null;
  }
}

async function updatePlatformRunFromExecutionState(
  executor: SqlExecutor,
  schema: string,
  executionStatePayload: ExecutionStateDocument
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const nextStatus = executionStatePayload.executionState.status;

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
    [
      executionStatePayload.executionState.runId,
      nextStatus,
      executionStatePayload.executionState.currentStage ?? null
    ]
  );
}

async function updatePlatformTaskFromExecutionState(
  executor: SqlExecutor,
  schema: string,
  runId: string,
  taskId: string,
  taskState: ExecutionStateDocument['executionState']['tasks'][number],
  releaseLease: boolean
): Promise<void> {
  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.tasks
      SET status = $3,
          attempts = $4,
          started_at = $5,
          completed_at = $6,
          updated_at = NOW(),
          current_lease_id = CASE WHEN $7 THEN NULL ELSE current_lease_id END,
          leased_by_worker_id = CASE WHEN $7 THEN NULL ELSE leased_by_worker_id END,
          lease_expires_at = CASE WHEN $7 THEN NULL ELSE lease_expires_at END,
          last_heartbeat_at = CASE WHEN $7 THEN NULL ELSE last_heartbeat_at END
      WHERE run_id = $1
        AND task_id = $2
    `,
    [
      runId,
      taskId,
      taskState.status,
      taskState.attempts ?? 0,
      taskState.startedAt ?? null,
      taskState.completedAt ?? null,
      releaseLease
    ]
  );
}

async function updatePlatformTaskAttempt(
  executor: SqlExecutor,
  schema: string,
  task: PlatformTaskRecord,
  adapterRun: AdapterRunDocument['adapterRun'],
  receipt: TaskResultDocument['taskResult']
): Promise<void> {
  if (!task.currentLeaseId) {
    return;
  }

  const quotedSchema = quoteSqlIdentifier(schema);
  await executor.query(
    `
      UPDATE ${quotedSchema}.task_attempts
      SET status = $4,
          completed_at = CASE
            WHEN $4 IN ('completed', 'failed', 'blocked', 'skipped') THEN COALESCE(completed_at, NOW())
            ELSE completed_at
          END,
          summary = $5,
          metadata = $6::jsonb
      WHERE attempt_id = $1
        AND run_id = $2
        AND task_id = $3
    `,
    [
      task.currentLeaseId,
      task.runId,
      task.taskId,
      receipt.status,
      adapterRun.summary,
      JSON.stringify({
        notes: receipt.notes,
        errors: receipt.errors,
        artifactIds: receipt.artifacts.map((artifact) => artifact.id),
        artifactContract: receipt.artifactContract
      })
    ]
  );
}

function buildPlatformArtifacts(runId: string, artifacts: ArtifactRef[]): PlatformArtifactRecord[] {
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

function buildPlatformWorkerEvents(
  options: PersistPlatformWorkerResultOptions,
  changedTasks: Array<{
    taskId: string;
    previousStatus: TaskStatus;
    nextStatus: TaskStatus;
  }>,
  newArtifacts: ArtifactRef[],
  newErrors: ErrorItem[]
): Array<{
  eventId: string;
  runId: string;
  taskId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}> {
  const events: Array<{
    eventId: string;
    runId: string;
    taskId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }> = [];

  for (const changedTask of changedTasks) {
    const eventType = inferTaskStatusEventType(changedTask.nextStatus);
    if (!eventType) {
      continue;
    }

    events.push({
      eventId: randomUUID(),
      runId: options.runId,
      taskId: changedTask.taskId,
      eventType,
      payload: {
        previousStatus: changedTask.previousStatus,
        nextStatus: changedTask.nextStatus,
        workerId: options.workerId
      }
    });
  }

  if (newArtifacts.length > 0) {
    events.push({
      eventId: randomUUID(),
      runId: options.runId,
      taskId: options.taskId,
      eventType: 'artifact.attached',
      payload: {
        workerId: options.workerId,
        artifactRefs: newArtifacts.map((artifact) => ({
          id: artifact.id,
          kind: artifact.kind,
          path: artifact.path,
          taskId: artifact.taskId ?? null
        }))
      }
    });
  }

  if (newErrors.length > 0) {
    events.push({
      eventId: randomUUID(),
      runId: options.runId,
      taskId: options.taskId,
      eventType: 'task.errors-recorded',
      payload: {
        workerId: options.workerId,
        errors: newErrors
      }
    });
  }

  return events;
}

export async function persistPlatformWorkerResult(
  executor: SqlExecutor,
  schema: string,
  options: PersistPlatformWorkerResultOptions
): Promise<PersistPlatformWorkerResult> {
  const previousState = options.materialization.executionStatePayload;
  const nextState = readStructuredFile(options.materialization.executionStatePath) as ExecutionStateDocument;
  const currentSnapshot = await getPlatformRunState(executor, schema, {
    runId: options.runId,
    eventLimit: options.eventLimit ?? DEFAULT_PLATFORM_WORKER_EVENT_LIMIT
  });
  if (!currentSnapshot.run) {
    throw new Error(`unknown platform run: ${options.runId}`);
  }

  const currentTask = assertPlatformWorkerTask(currentSnapshot, {
    runId: options.runId,
    taskId: options.taskId,
    workerId: options.workerId
  });

  const changedTasks = collectChangedTaskStates(previousState, nextState);
  const newArtifacts = collectNewArtifacts(previousState, nextState);
  const newErrors = collectNewErrors(previousState, nextState, options.taskId);

  for (const changedTask of changedTasks) {
    await updatePlatformTaskFromExecutionState(
      executor,
      schema,
      options.runId,
      changedTask.taskId,
      changedTask.nextTaskState,
      changedTask.taskId === options.taskId && ['completed', 'failed', 'blocked', 'skipped'].includes(changedTask.nextStatus)
    );
  }

  await updatePlatformRunFromExecutionState(executor, schema, nextState);
  await updatePlatformTaskAttempt(executor, schema, currentTask, options.adapterRun, options.receipt);

  const platformArtifacts = buildPlatformArtifacts(options.runId, newArtifacts);
  if (platformArtifacts.length > 0) {
    await insertPlatformArtifacts(executor, schema, platformArtifacts);
  }

  const events = buildPlatformWorkerEvents(options, changedTasks, newArtifacts, newErrors);
  if (events.length > 0) {
    await insertPlatformEvents(executor, schema, events);
  }

  const platformRunState = await getPlatformRunState(executor, schema, {
    runId: options.runId,
    eventLimit: options.eventLimit ?? DEFAULT_PLATFORM_WORKER_EVENT_LIMIT
  });

  return {
    runId: options.runId,
    taskId: options.taskId,
    workerId: options.workerId,
    updatedTasks: changedTasks.map((task) => ({
      taskId: task.taskId,
      previousStatus: task.previousStatus,
      nextStatus: task.nextStatus
    })),
    insertedArtifactCount: platformArtifacts.length,
    platformRunState
  };
}
