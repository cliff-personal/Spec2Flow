import path from 'node:path';
import {
  appendUniqueItems,
  buildTaskResultReceipt,
  getExecutionStateTaskIndex,
  getTaskGraphTaskIndex,
  inferCurrentStage,
  inferExecutionStateStatus,
  promoteReadyTasks,
  setTaskTerminalTimestamp,
  validateExecutionStatePayload
} from './execution-state-service.js';
import { fail, readStructuredFileFrom, writeJson } from '../shared/fs-utils.js';
import type { ArtifactRef, ErrorItem, ExecutionStateDocument, ExecutionStatus, TaskState } from '../types/execution-state.js';
import { getSchemaValidators } from '../shared/schema-registry.js';
import { validateSchemaBackedArtifacts } from './stage-deliverable-validation.js';
import type { ArtifactContractSummary, TaskResultDocument } from '../types/task-result.js';
import type { Task, TaskExecutorType, TaskGraphDocument, TaskStage, TaskStatus } from '../types/task-graph.js';

type FailureClass =
  | 'requirement-misunderstanding'
  | 'implementation-defect'
  | 'missing-or-weak-test-coverage'
  | 'execution-environment-failure'
  | 'release-or-review-readiness-issue';

export interface ApplyTaskResultPayload {
  taskId: string;
  taskStatus: TaskStatus;
  notes: string[];
  artifacts: ArtifactRef[];
  errors: ErrorItem[];
  executor?: string;
  workflowStatus?: ExecutionStatus;
  currentStage?: TaskStage;
}

function normalizeArtifactSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function inferArtifactBaseDir(statePath: string): string {
  const resolvedStatePath = path.resolve(statePath);
  const stateDir = path.dirname(resolvedStatePath);
  const nestedSpec2flowMarker = `${path.sep}.spec2flow${path.sep}`;
  const nestedSpec2flowIndex = stateDir.lastIndexOf(nestedSpec2flowMarker);

  if (nestedSpec2flowIndex >= 0) {
    return stateDir.slice(0, nestedSpec2flowIndex) || path.sep;
  }

  return stateDir;
}

function buildArtifactContractSummary(expectedArtifacts: string[], artifacts: ArtifactRef[]): ArtifactContractSummary {
  if (expectedArtifacts.length === 0) {
    return {
      status: 'not-applicable',
      expectedArtifacts: [],
      presentArtifacts: [],
      missingArtifacts: []
    };
  }

  const presentArtifacts = expectedArtifacts.filter((expectedArtifact) => {
    const normalizedExpectedArtifact = normalizeArtifactSearchValue(expectedArtifact);
    return artifacts.some((artifact) => {
      const searchableValues = [artifact.id, artifact.kind, artifact.path]
        .map((value) => normalizeArtifactSearchValue(String(value)));
      return searchableValues.some((value) => value.includes(normalizedExpectedArtifact));
    });
  });
  const missingArtifacts = expectedArtifacts.filter((expectedArtifact) => !presentArtifacts.includes(expectedArtifact));

  return {
    status: missingArtifacts.length === 0 ? 'satisfied' : 'missing',
    expectedArtifacts,
    presentArtifacts,
    missingArtifacts
  };
}

function validateTaskResultPayload(taskResultPayload: TaskResultDocument): void {
  const validators = getSchemaValidators();
  const valid = validators.taskResult(taskResultPayload);
  if (!valid) {
    fail(`task-result validation failed: ${JSON.stringify(validators.taskResult.errors ?? [])}`);
  }
}

function getRouteTaskId(taskId: string, stage: string): string | null {
  if (!taskId.includes('--')) {
    return null;
  }

  const [routeName] = taskId.split('--');
  return routeName ? `${routeName}--${stage}` : null;
}

function addTaskNotes(taskState: TaskState, notes: string[]): void {
  const nextNotes = appendUniqueItems(taskState.notes, notes);
  if (nextNotes !== undefined) {
    taskState.notes = nextNotes;
  }
}

function setTaskStateStatus(
  taskState: TaskState,
  status: TaskStatus,
  now: string,
  executor?: TaskExecutorType
): void {
  taskState.status = status;
  if (executor) {
    taskState.executor = executor;
  }
  setTaskTerminalTimestamp(taskState, status, now);
}

function shouldRouteToDefect(taskStatus: TaskStatus, artifactContract: ArtifactContractSummary): boolean {
  return taskStatus === 'failed' || taskStatus === 'blocked' || artifactContract.status === 'missing';
}

function getFailureClassForStage(stage: TaskStage): FailureClass | null {
  switch (stage) {
    case 'requirements-analysis':
      return 'requirement-misunderstanding';
    case 'code-implementation':
      return 'implementation-defect';
    case 'test-design':
      return 'missing-or-weak-test-coverage';
    case 'automated-execution':
      return 'execution-environment-failure';
    case 'collaboration':
      return 'release-or-review-readiness-issue';
    default:
      return null;
  }
}

function getStagesToSkipBeforeDefect(stage: TaskStage): TaskStage[] {
  switch (stage) {
    case 'requirements-analysis':
      return ['code-implementation', 'test-design', 'automated-execution'];
    case 'code-implementation':
      return ['test-design', 'automated-execution'];
    case 'test-design':
      return ['automated-execution'];
    default:
      return [];
  }
}

function skipRouteTasks(
  taskGraphTaskIndex: Map<string, Task>,
  taskStateIndex: Map<string, TaskState>,
  taskId: string,
  stagesToSkip: TaskStage[],
  failureClass: FailureClass,
  now: string
): void {
  for (const stage of stagesToSkip) {
    const routeTaskId = getRouteTaskId(taskId, stage);
    if (!routeTaskId) {
      continue;
    }

    const routeTask = taskGraphTaskIndex.get(routeTaskId);
    const routeTaskState = taskStateIndex.get(routeTaskId);

    if (!routeTask || !routeTaskState) {
      continue;
    }

    if (!['pending', 'ready'].includes(routeTaskState.status)) {
      continue;
    }

    setTaskStateStatus(routeTaskState, 'skipped', now, routeTask.executorType);
    addTaskNotes(routeTaskState, [
      `route-auto-skip:${stage}`,
      `route-class:${failureClass}`,
      `route-origin:${taskId}`
    ]);
  }
}

function routeStageOutcomeToDefect(
  taskGraphTaskIndex: Map<string, Task>,
  taskStateIndex: Map<string, TaskState>,
  taskId: string,
  stage: TaskStage,
  taskStatus: TaskStatus,
  artifactContract: ArtifactContractSummary,
  now: string
): void {
  const defectTaskId = getRouteTaskId(taskId, 'defect-feedback');
  const collaborationTaskId = getRouteTaskId(taskId, 'collaboration');
  const failureClass = getFailureClassForStage(stage);

  if (!defectTaskId || !collaborationTaskId || !failureClass || !shouldRouteToDefect(taskStatus, artifactContract)) {
    return;
  }

  const defectTask = taskGraphTaskIndex.get(defectTaskId);
  const defectTaskState = taskStateIndex.get(defectTaskId);
  const collaborationTaskState = taskStateIndex.get(collaborationTaskId);

  if (!defectTask || !defectTaskState || !collaborationTaskState) {
    return;
  }

  skipRouteTasks(taskGraphTaskIndex, taskStateIndex, taskId, getStagesToSkipBeforeDefect(stage), failureClass, now);
  addTaskNotes(defectTaskState, [
    `route-trigger:${stage}`,
    `route-class:${failureClass}`,
    `route-reason:${taskStatus === 'failed' || taskStatus === 'blocked' ? taskStatus : 'artifact-contract-missing'}`
  ]);

  if (collaborationTaskState.status === 'ready') {
    collaborationTaskState.status = 'pending';
  }

  if (stage === 'automated-execution') {
    return;
  }

  if (defectTaskState.status === 'pending') {
    defectTaskState.status = 'ready';
  }
}

function readCollaborationHandoffPayload(artifacts: ArtifactRef[], artifactBaseDir: string): Record<string, unknown> | null {
  const collaborationArtifact = artifacts.find((artifact) => {
    const searchableValues = [artifact.id, artifact.path].map((value) => normalizeArtifactSearchValue(String(value)));
    return searchableValues.some((value) => value.includes('collaboration-handoff'));
  });

  if (!collaborationArtifact) {
    return null;
  }

  try {
    return readStructuredFileFrom(artifactBaseDir, collaborationArtifact.path) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function enforceCollaborationApprovalGate(
  taskGraphTask: Task,
  taskState: TaskState,
  artifacts: ArtifactRef[],
  artifactContract: ArtifactContractSummary,
  now: string,
  artifactBaseDir: string
): void {
  if (taskGraphTask.stage !== 'collaboration' || taskGraphTask.reviewPolicy?.requireHumanApproval !== true) {
    return;
  }

  const handoffPayload = readCollaborationHandoffPayload(artifacts, artifactBaseDir);
  const readiness = typeof handoffPayload?.readiness === 'string' ? handoffPayload.readiness : null;
  const approvalRequired = handoffPayload?.approvalRequired === true;
  const shouldBlockForApproval =
    artifactContract.status === 'missing'
    || readiness === 'awaiting-approval'
    || readiness === 'blocked'
    || (approvalRequired && readiness !== 'ready');

  if (!shouldBlockForApproval) {
    return;
  }

  setTaskStateStatus(taskState, 'blocked', now, taskGraphTask.executorType);
  addTaskNotes(taskState, [
    'approval-gate:human-approval-required',
    `route-class:${getFailureClassForStage('collaboration')}`,
    `route-reason:${artifactContract.status === 'missing' ? 'artifact-contract-missing' : readiness ?? 'awaiting-approval'}`
  ]);
}

function routeAutomatedExecutionOutcome(
  taskGraphTaskIndex: Map<string, Task>,
  taskStateIndex: Map<string, TaskState>,
  taskId: string,
  taskStatus: TaskStatus,
  artifactContract: ArtifactContractSummary,
  now: string
): void {
  if (shouldRouteToDefect(taskStatus, artifactContract)) {
    routeStageOutcomeToDefect(taskGraphTaskIndex, taskStateIndex, taskId, 'automated-execution', taskStatus, artifactContract, now);
    return;
  }

  const defectTaskId = getRouteTaskId(taskId, 'defect-feedback');

  if (!defectTaskId) {
    return;
  }

  const defectTask = taskGraphTaskIndex.get(defectTaskId);
  const defectTaskState = taskStateIndex.get(defectTaskId);

  if (!defectTask || !defectTaskState) {
    return;
  }

  if (defectTaskState.status === 'pending') {
    setTaskStateStatus(defectTaskState, 'skipped', now, defectTask.executorType);
    addTaskNotes(defectTaskState, [
      'route-auto-skip:defect-feedback',
      'route-reason:execution-artifact-contract-satisfied'
    ]);
  }
}

export function applyTaskResult(
  executionStatePayload: ExecutionStateDocument,
  taskGraphPayload: TaskGraphDocument,
  statePath: string,
  payload: ApplyTaskResultPayload
): TaskResultDocument {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  const taskGraphTaskIndex = getTaskGraphTaskIndex(taskGraphPayload);
  const now = new Date().toISOString();
  const taskState = taskStateIndex.get(payload.taskId);
  const taskGraphTask = taskGraphTaskIndex.get(payload.taskId);

  const artifactBaseDir = inferArtifactBaseDir(statePath);
  if (!taskState || !taskGraphTask) {
    fail(`unknown task id: ${payload.taskId}`);
  }

  taskState.status = payload.taskStatus;
  const nextNotes = appendUniqueItems(taskState.notes, payload.notes);
  if (nextNotes !== undefined) {
    taskState.notes = nextNotes;
  }
  const nextArtifactRefs = appendUniqueItems(taskState.artifactRefs, payload.artifacts.map((artifact) => artifact.id));
  if (nextArtifactRefs !== undefined) {
    taskState.artifactRefs = nextArtifactRefs;
  }
  if (payload.executor !== undefined) {
    taskState.executor = payload.executor;
  }
  validateSchemaBackedArtifacts(payload.artifacts, { baseDir: artifactBaseDir });
  const artifactContract = buildArtifactContractSummary(taskGraphTask.roleProfile.expectedArtifacts, payload.artifacts);
  setTaskTerminalTimestamp(taskState, payload.taskStatus, now);

  if (payload.artifacts.length > 0) {
    executionStatePayload.executionState.artifacts = [
      ...(executionStatePayload.executionState.artifacts ?? []),
      ...payload.artifacts
    ];
  }

  if (payload.errors.length > 0) {
    executionStatePayload.executionState.errors = [
      ...(executionStatePayload.executionState.errors ?? []),
      ...payload.errors
    ];
  }

  if (artifactContract.status === 'missing') {
    const contractNotes = appendUniqueItems(taskState.notes, [
      `artifact-contract:missing`,
      `artifact-contract-missing:${artifactContract.missingArtifacts.join(',')}`
    ]);
    if (contractNotes !== undefined) {
      taskState.notes = contractNotes;
    }
  }

  if (['requirements-analysis', 'code-implementation', 'test-design'].includes(taskGraphTask.stage)) {
    routeStageOutcomeToDefect(taskGraphTaskIndex, taskStateIndex, payload.taskId, taskGraphTask.stage, payload.taskStatus, artifactContract, now);
  }

  if (taskGraphTask.stage === 'automated-execution') {
    routeAutomatedExecutionOutcome(taskGraphTaskIndex, taskStateIndex, payload.taskId, payload.taskStatus, artifactContract, now);
  }

  enforceCollaborationApprovalGate(taskGraphTask, taskState, payload.artifacts, artifactContract, now, artifactBaseDir);

  promoteReadyTasks(taskGraphPayload, executionStatePayload);
  executionStatePayload.executionState.status = payload.workflowStatus ?? inferExecutionStateStatus(executionStatePayload.executionState.tasks);
  const nextCurrentStage = payload.currentStage ?? inferCurrentStage(taskGraphPayload, executionStatePayload);
  if (nextCurrentStage !== undefined) {
    executionStatePayload.executionState.currentStage = nextCurrentStage;
  }
  executionStatePayload.executionState.updatedAt = now;
  validateExecutionStatePayload(executionStatePayload, statePath);
  writeJson(statePath, executionStatePayload);

  const receipt = buildTaskResultReceipt(
    payload.taskId,
    taskState.status,
    statePath,
    payload.notes,
    payload.artifacts,
    artifactContract,
    payload.errors
  );
  validateTaskResultPayload(receipt);
  return receipt;
}
