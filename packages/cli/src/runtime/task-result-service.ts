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
import { resolveEvaluationRepairTargetStage, type EvaluationRepairTargetStage } from '../shared/evaluation-repair-target.js';
import type { ArtifactRef, ErrorItem, ExecutionStateDocument, ExecutionStatus, TaskState } from '../types/execution-state.js';
import { getSchemaValidators } from '../shared/schema-registry.js';
import { validateSchemaBackedArtifacts } from './stage-deliverable-validation.js';
import { applyAutoRepairPolicy } from './auto-repair-policy-service.js';
import { applyCollaborationPublicationPolicy, type CollaborationPublicationDecision } from './collaboration-publication-service.js';
import type { ArtifactContractSummary, TaskResultDocument } from '../types/task-result.js';
import type { Task, TaskExecutorType, TaskGraphDocument, TaskStage, TaskStatus } from '../types/task-graph.js';

type FailureClass =
  | 'requirement-misunderstanding'
  | 'implementation-defect'
  | 'missing-or-weak-test-coverage'
  | 'execution-environment-failure'
  | 'release-or-review-readiness-issue';

type RepairableTaskStage = EvaluationRepairTargetStage;

const REPAIRABLE_STAGE_ORDER: Record<RepairableTaskStage | 'defect-feedback' | 'collaboration' | 'evaluation', number> = {
  'requirements-analysis': 1,
  'code-implementation': 2,
  'test-design': 3,
  'automated-execution': 4,
  'defect-feedback': 5,
  'collaboration': 6,
  'evaluation': 7
};

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

function resetTaskStateForReroute(taskState: TaskState, status: TaskStatus): void {
  taskState.status = status;
  delete taskState.startedAt;
  delete taskState.completedAt;
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

function shouldRouteToDefect(
  taskStatus: TaskStatus,
  artifactContract: ArtifactContractSummary,
  errors: ErrorItem[]
): boolean {
  if (taskStatus === 'failed') return true;
  if (artifactContract.status === 'missing') return true;
  if (taskStatus === 'blocked') {
    // Do not route to defect when the block is caused solely by recoverable
    // infrastructure errors (e.g. missing adapter). Those blocks are retried
    // automatically, and routing to defect would permanently skip downstream
    // stages before the retry can succeed.
    if (errors.length > 0 && errors.every((e) => e.recoverable === true)) {
      return false;
    }
    return true;
  }
  return false;
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
    case 'evaluation':
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
  errors: ErrorItem[],
  now: string
): void {
  const defectTaskId = getRouteTaskId(taskId, 'defect-feedback');
  const collaborationTaskId = getRouteTaskId(taskId, 'collaboration');
  const failureClass = getFailureClassForStage(stage);

  if (!defectTaskId || !collaborationTaskId || !failureClass || !shouldRouteToDefect(taskStatus, artifactContract, errors)) {
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
    `route-reason:${taskStatus === 'failed' || taskStatus === 'blocked' ? taskStatus : 'artifact-contract-missing'}`,
    `route-origin:${taskId}`
  ]);

  if (collaborationTaskState.status === 'ready') {
    collaborationTaskState.status = 'pending';
  }

  if (stage === 'automated-execution') {
    return;
  }

  if (['pending', 'completed', 'skipped', 'blocked'].includes(defectTaskState.status)) {
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

function readEvaluationSummaryPayload(artifacts: ArtifactRef[], artifactBaseDir: string): Record<string, unknown> | null {
  const evaluationArtifact = artifacts.find((artifact) => {
    const searchableValues = [artifact.id, artifact.path].map((value) => normalizeArtifactSearchValue(String(value)));
    return searchableValues.some((value) => value.includes('evaluation-summary'));
  });

  if (!evaluationArtifact) {
    return null;
  }

  try {
    return readStructuredFileFrom(artifactBaseDir, evaluationArtifact.path) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function inferEvaluationRepairTargetStage(evaluationPayload: Record<string, unknown> | null): RepairableTaskStage | null {
  return resolveEvaluationRepairTargetStage({
    explicitRepairTargetStage: typeof evaluationPayload?.repairTargetStage === 'string' ? evaluationPayload.repairTargetStage : null,
    nextActions: readStringArray(evaluationPayload?.nextActions),
    findings: readStringArray(evaluationPayload?.findings)
  });
}

function rerouteEvaluationNeedsRepair(
  taskGraphTaskIndex: Map<string, Task>,
  taskStateIndex: Map<string, TaskState>,
  taskGraphTask: Task,
  taskState: TaskState,
  now: string,
  targetStage: RepairableTaskStage
): boolean {
  const routePrefix = taskGraphTask.id.includes('--') ? (taskGraphTask.id.split('--')[0] ?? null) : null;
  const targetTaskId = getRouteTaskId(taskGraphTask.id, targetStage);
  const targetTask = targetTaskId ? taskGraphTaskIndex.get(targetTaskId) ?? null : null;
  const targetTaskState = targetTaskId ? taskStateIndex.get(targetTaskId) ?? null : null;
  const failureClass = getFailureClassForStage('evaluation');

  if (!routePrefix || !targetTaskId || !targetTask || !targetTaskState || !failureClass) {
    return false;
  }

  resetTaskStateForReroute(targetTaskState, 'ready');
  addTaskNotes(targetTaskState, [
    'route-trigger:evaluation',
    `route-class:${failureClass}`,
    'route-reason:evaluator-needs-repair',
    `route-origin:${taskGraphTask.id}`
  ]);

  for (const [candidateTaskId, candidateTask] of taskGraphTaskIndex) {
    if (!candidateTaskId.startsWith(`${routePrefix}--`) || candidateTaskId === targetTaskId || candidateTask.stage === 'environment-preparation') {
      continue;
    }

    const candidateTaskState = taskStateIndex.get(candidateTaskId);
    if (!candidateTaskState) {
      continue;
    }

    const candidateStage = candidateTask.stage;
    const candidateStageOrder = REPAIRABLE_STAGE_ORDER[candidateStage as keyof typeof REPAIRABLE_STAGE_ORDER];
    const targetStageOrder = REPAIRABLE_STAGE_ORDER[targetStage];
    if (candidateStageOrder > targetStageOrder) {
      resetTaskStateForReroute(candidateTaskState, 'pending');
      addTaskNotes(candidateTaskState, [
        `evaluation-reset:${taskGraphTask.id}`,
        `route-origin:${taskGraphTask.id}`
      ]);
    }
  }

  setTaskStateStatus(taskState, 'blocked', now, taskGraphTask.executorType);
  addTaskNotes(taskState, [
    'evaluation-gate:needs-repair-rerouted',
    'evaluation-decision:needs-repair',
    `route-target:${targetTaskId}`,
    `route-target-stage:${targetStage}`
  ]);

  return true;
}

function applyEvaluationTriggeredPublication(
  taskGraphTaskIndex: Map<string, Task>,
  taskStateIndex: Map<string, TaskState>,
  taskId: string,
  currentTaskStatus: TaskStatus,
  allArtifacts: ArtifactRef[],
  artifactBaseDir: string
): CollaborationPublicationDecision | { status: 'not-applicable'; generatedArtifacts: ArtifactRef[]; notes: string[] } {
  if (getRouteTaskId(taskId, 'evaluation') !== taskId || currentTaskStatus !== 'completed') {
    return {
      generatedArtifacts: [],
      notes: [],
      status: 'not-applicable' as const
    };
  }

  const collaborationTaskId = getRouteTaskId(taskId, 'collaboration');
  if (!collaborationTaskId) {
    return {
      generatedArtifacts: [],
      notes: [],
      status: 'not-applicable' as const
    };
  }

  const collaborationTask = taskGraphTaskIndex.get(collaborationTaskId);
  const collaborationTaskState = taskStateIndex.get(collaborationTaskId);

  if (!collaborationTask || collaborationTaskState?.status !== 'completed') {
    return {
      generatedArtifacts: [],
      notes: [],
      status: 'not-applicable' as const
    };
  }

  if (collaborationTask.reviewPolicy?.allowAutoCommit !== true) {
    return {
      generatedArtifacts: [],
      notes: [],
      status: 'not-applicable' as const
    };
  }

  return applyCollaborationPublicationPolicy({
    taskGraphTask: collaborationTask,
    taskState: collaborationTaskState,
    artifacts: allArtifacts,
    allArtifacts,
    artifactBaseDir
  });
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

function enforceEvaluationAcceptanceGate(
  taskGraphTaskIndex: Map<string, Task>,
  taskStateIndex: Map<string, TaskState>,
  taskGraphTask: Task,
  taskState: TaskState,
  artifacts: ArtifactRef[],
  artifactContract: ArtifactContractSummary,
  now: string,
  artifactBaseDir: string
): void {
  if (taskGraphTask.stage !== 'evaluation') {
    return;
  }

  const evaluationPayload = readEvaluationSummaryPayload(artifacts, artifactBaseDir);
  const decision = typeof evaluationPayload?.decision === 'string' ? evaluationPayload.decision : null;
  const accepted = decision === 'accepted';

  if (decision === 'needs-repair' && artifactContract.status !== 'missing') {
    const preciseRepairTarget = inferEvaluationRepairTargetStage(evaluationPayload);

    if (preciseRepairTarget && rerouteEvaluationNeedsRepair(
      taskGraphTaskIndex,
      taskStateIndex,
      taskGraphTask,
      taskState,
      now,
      preciseRepairTarget
    )) {
      return;
    }

    const defectTaskId = getRouteTaskId(taskGraphTask.id, 'defect-feedback');
    const collaborationTaskId = getRouteTaskId(taskGraphTask.id, 'collaboration');
    const defectTaskState = defectTaskId ? taskStateIndex.get(defectTaskId) ?? null : null;
    const collaborationTaskState = collaborationTaskId ? taskStateIndex.get(collaborationTaskId) ?? null : null;
    const failureClass = getFailureClassForStage('evaluation');

    if (defectTaskId && collaborationTaskId && defectTaskState && collaborationTaskState && failureClass) {
      resetTaskStateForReroute(defectTaskState, 'ready');
      resetTaskStateForReroute(collaborationTaskState, 'pending');
      setTaskStateStatus(taskState, 'blocked', now, taskGraphTask.executorType);

      addTaskNotes(defectTaskState, [
        'route-trigger:evaluation',
        `route-class:${failureClass}`,
        'route-reason:evaluator-needs-repair',
        `route-origin:${taskGraphTask.id}`
      ]);
      addTaskNotes(collaborationTaskState, [
        `evaluation-reset:${taskGraphTask.id}`,
        `route-origin:${taskGraphTask.id}`
      ]);
      addTaskNotes(taskState, [
        'evaluation-gate:needs-repair-rerouted',
        'evaluation-decision:needs-repair',
        `route-target:${defectTaskId}`,
        'route-target-stage:defect-feedback'
      ]);
      return;
    }
  }

  if (artifactContract.status === 'missing' || !accepted) {
    setTaskStateStatus(taskState, 'blocked', now, taskGraphTask.executorType);
    addTaskNotes(taskState, [
      'evaluation-gate:not-accepted',
      `evaluation-decision:${artifactContract.status === 'missing' ? 'artifact-contract-missing' : decision ?? 'missing-decision'}`
    ]);
    return;
  }

  addTaskNotes(taskState, ['evaluation-gate:accepted']);
}

function routeAutomatedExecutionOutcome(
  taskGraphTaskIndex: Map<string, Task>,
  taskStateIndex: Map<string, TaskState>,
  taskId: string,
  taskStatus: TaskStatus,
  artifactContract: ArtifactContractSummary,
  errors: ErrorItem[],
  now: string
): void {
  if (shouldRouteToDefect(taskStatus, artifactContract, errors)) {
    routeStageOutcomeToDefect(taskGraphTaskIndex, taskStateIndex, taskId, 'automated-execution', taskStatus, artifactContract, errors, now);
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

function appendTaskResultPayload(
  executionStatePayload: ExecutionStateDocument,
  taskState: TaskState,
  payload: ApplyTaskResultPayload
): void {
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
}

function addMissingArtifactContractNotes(taskState: TaskState, artifactContract: ArtifactContractSummary): void {
  if (artifactContract.status !== 'missing') {
    return;
  }

  const contractNotes = appendUniqueItems(taskState.notes, [
    'artifact-contract:missing',
    `artifact-contract-missing:${artifactContract.missingArtifacts.join(',')}`
  ]);
  if (contractNotes !== undefined) {
    taskState.notes = contractNotes;
  }
}

function applyRouteOutcome(
  taskGraphTaskIndex: Map<string, Task>,
  taskStateIndex: Map<string, TaskState>,
  taskId: string,
  taskGraphTask: Task,
  taskStatus: TaskStatus,
  artifactContract: ArtifactContractSummary,
  errors: ErrorItem[],
  now: string
): void {
  if (['requirements-analysis', 'code-implementation', 'test-design'].includes(taskGraphTask.stage)) {
    routeStageOutcomeToDefect(taskGraphTaskIndex, taskStateIndex, taskId, taskGraphTask.stage, taskStatus, artifactContract, errors, now);
  }

  if (taskGraphTask.stage === 'automated-execution') {
    routeAutomatedExecutionOutcome(taskGraphTaskIndex, taskStateIndex, taskId, taskStatus, artifactContract, errors, now);
  }
}

function applyPublicationDecision(
  executionStatePayload: ExecutionStateDocument,
  taskGraphTask: Task,
  taskState: TaskState,
  decision: CollaborationPublicationDecision | { status: 'not-applicable'; generatedArtifacts: ArtifactRef[]; notes: string[] },
  generatedArtifacts: ArtifactRef[],
  now: string
): void {
  if (decision.generatedArtifacts.length > 0) {
    generatedArtifacts.push(...decision.generatedArtifacts);
    const nextTaskArtifactRefs = appendUniqueItems(
      taskState.artifactRefs,
      decision.generatedArtifacts.map((artifact) => artifact.id)
    );
    if (nextTaskArtifactRefs !== undefined) {
      taskState.artifactRefs = nextTaskArtifactRefs;
    }
    executionStatePayload.executionState.artifacts = [
      ...(executionStatePayload.executionState.artifacts ?? []),
      ...decision.generatedArtifacts
    ];
  }

  if (decision.notes.length > 0) {
    addTaskNotes(taskState, decision.notes);
  }

  if (decision.status === 'blocked') {
    setTaskStateStatus(taskState, 'blocked', now, taskGraphTask.executorType);
  }
}

function resolveNextCurrentStage(
  payload: ApplyTaskResultPayload,
  autoRepairDecision: ReturnType<typeof applyAutoRepairPolicy>,
  taskGraphTaskIndex: Map<string, Task>,
  taskGraphPayload: TaskGraphDocument,
  executionStatePayload: ExecutionStateDocument
): TaskStage | undefined {
  if (payload.currentStage !== undefined) {
    return payload.currentStage;
  }

  if (autoRepairDecision.status === 'triggered') {
    return taskGraphTaskIndex.get(autoRepairDecision.targetTaskId)?.stage;
  }

  if (autoRepairDecision.status === 'escalated') {
    return 'collaboration';
  }

  return inferCurrentStage(taskGraphPayload, executionStatePayload);
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
  const generatedArtifacts: ArtifactRef[] = [];
  if (!taskState || !taskGraphTask) {
    fail(`unknown task id: ${payload.taskId}`);
  }

  taskState.status = payload.taskStatus;
  appendTaskResultPayload(executionStatePayload, taskState, payload);
  validateSchemaBackedArtifacts(payload.artifacts, { baseDir: artifactBaseDir });
  const artifactContract = buildArtifactContractSummary(taskGraphTask.roleProfile.expectedArtifacts, payload.artifacts);
  setTaskTerminalTimestamp(taskState, payload.taskStatus, now);

  addMissingArtifactContractNotes(taskState, artifactContract);
  applyRouteOutcome(taskGraphTaskIndex, taskStateIndex, payload.taskId, taskGraphTask, payload.taskStatus, artifactContract, payload.errors, now);

  enforceCollaborationApprovalGate(taskGraphTask, taskState, payload.artifacts, artifactContract, now, artifactBaseDir);
  enforceEvaluationAcceptanceGate(
    taskGraphTaskIndex,
    taskStateIndex,
    taskGraphTask,
    taskState,
    payload.artifacts,
    artifactContract,
    now,
    artifactBaseDir
  );
  const publicationDecision = applyEvaluationTriggeredPublication(
    taskGraphTaskIndex,
    taskStateIndex,
    payload.taskId,
    taskState.status,
    [
      ...(executionStatePayload.executionState.artifacts ?? []),
      ...payload.artifacts
    ],
    artifactBaseDir
  );
  applyPublicationDecision(executionStatePayload, taskGraphTask, taskState, publicationDecision, generatedArtifacts, now);
  const autoRepairDecision = applyAutoRepairPolicy({
    taskGraphTaskIndex,
    taskStateIndex,
    taskGraphTask,
    taskState,
    artifacts: payload.artifacts,
    artifactContract,
    artifactBaseDir
  });

  promoteReadyTasks(taskGraphPayload, executionStatePayload);
  executionStatePayload.executionState.status = payload.workflowStatus ?? inferExecutionStateStatus(executionStatePayload.executionState.tasks);
  const nextCurrentStage = resolveNextCurrentStage(
    payload,
    autoRepairDecision,
    taskGraphTaskIndex,
    taskGraphPayload,
    executionStatePayload
  );
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
    [...payload.artifacts, ...generatedArtifacts],
    artifactContract,
    payload.errors
  );
  validateTaskResultPayload(receipt);
  return receipt;
}
