import { readStructuredFileFrom } from '../shared/fs-utils.js';
import type { ArtifactRef, TaskState } from '../types/execution-state.js';
import type { Task, TaskStage, TaskStatus } from '../types/task-graph.js';
import type { ArtifactContractSummary } from '../types/task-result.js';

export type AutoRepairEscalationReason =
  | 'unsupported-target'
  | 'policy-disabled'
  | 'blocked-risk-level'
  | 'budget-exhausted';

export type AutoRepairDecision =
  | {
      status: 'not-applicable' | 'no-op';
    }
  | {
      status: 'triggered';
      targetTaskId: string;
      attemptNumber: number;
    }
  | {
      status: 'escalated';
      reason: AutoRepairEscalationReason;
      targetTaskId: string | null;
      attemptNumber: number | null;
    };

export interface ApplyAutoRepairPolicyOptions {
  taskGraphTaskIndex: Map<string, Task>;
  taskStateIndex: Map<string, TaskState>;
  taskGraphTask: Task;
  taskState: TaskState;
  artifacts: ArtifactRef[];
  artifactContract: ArtifactContractSummary;
  artifactBaseDir: string;
}

type DefectSummaryPayload = {
  recommendedAction?: string;
  failureType?: string;
};

function normalizeArtifactSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function addTaskNotes(taskState: TaskState, notes: string[]): void {
  const currentNotes = taskState.notes ?? [];
  const nextNotes = [...currentNotes];

  for (const note of notes) {
    if (!nextNotes.includes(note)) {
      nextNotes.push(note);
    }
  }

  taskState.notes = nextNotes;
}

function getLatestTaskNoteValue(notes: string[] | undefined, prefix: string): string | null {
  const match = [...(notes ?? [])].reverse().find((note) => note.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function getLatestTaskNoteNumber(notes: string[] | undefined, prefix: string): number {
  const values = (notes ?? [])
    .filter((note) => note.startsWith(prefix))
    .map((note) => Number.parseInt(note.slice(prefix.length), 10))
    .filter((value) => Number.isInteger(value) && value >= 0);

  return values.length > 0 ? Math.max(...values) : 0;
}

function getRoutePrefix(taskId: string): string | null {
  if (!taskId.includes('--')) {
    return null;
  }

  return taskId.split('--')[0] ?? null;
}

function readDefectSummaryPayload(artifacts: ArtifactRef[], artifactBaseDir: string): DefectSummaryPayload | null {
  const defectArtifact = artifacts.find((artifact) => {
    const searchableValues = [artifact.id, artifact.path].map((value) => normalizeArtifactSearchValue(String(value)));
    return searchableValues.some((value) => value.includes('defect-summary'));
  });

  if (!defectArtifact) {
    return null;
  }

  try {
    return readStructuredFileFrom(artifactBaseDir, defectArtifact.path) as DefectSummaryPayload;
  } catch {
    return null;
  }
}

function getRepairTargetStageFromDefectSummary(defectSummaryPayload: DefectSummaryPayload | null): Exclude<TaskStage, 'environment-preparation' | 'defect-feedback' | 'collaboration' | 'evaluation'> | null {
  switch (defectSummaryPayload?.recommendedAction) {
    case 'clarify-requirements':
      return 'requirements-analysis';
    case 'fix-implementation':
      return 'code-implementation';
    case 'expand-tests':
      return 'test-design';
    case 'rerun-execution':
      return 'automated-execution';
    default:
      break;
  }

  switch (defectSummaryPayload?.failureType) {
    case 'requirements':
      return 'requirements-analysis';
    case 'implementation':
      return 'code-implementation';
    case 'test-design':
      return 'test-design';
    case 'execution':
      return 'automated-execution';
    default:
      return null;
  }
}

function resetTaskStateForRetry(taskState: TaskState, status: TaskStatus): void {
  taskState.status = status;
  delete taskState.startedAt;
  delete taskState.completedAt;
}

function appendEscalationNotes(
  defectTaskState: TaskState,
  collaborationTaskState: TaskState | null,
  reason: AutoRepairEscalationReason,
  targetTaskId: string | null,
  attemptNumber: number | null,
  recommendedAction: string | null
): void {
  const notes = [
    `auto-repair-escalated:${reason}`,
    `auto-repair-target:${targetTaskId ?? 'none'}`,
    ...(attemptNumber === null ? [] : [`auto-repair-next-attempt:${attemptNumber}`]),
    ...(recommendedAction ? [`auto-repair-reason:${recommendedAction}`] : [])
  ];

  addTaskNotes(defectTaskState, notes);
  if (collaborationTaskState) {
    resetTaskStateForRetry(collaborationTaskState, 'ready');
    addTaskNotes(collaborationTaskState, notes);
  }
}

export function applyAutoRepairPolicy(options: ApplyAutoRepairPolicyOptions): AutoRepairDecision {
  if (
    options.taskGraphTask.stage !== 'defect-feedback'
    || options.taskState.status !== 'completed'
    || options.artifactContract.status === 'missing'
  ) {
    return { status: 'not-applicable' };
  }

  const routePrefix = getRoutePrefix(options.taskGraphTask.id);
  const defectSummaryPayload = readDefectSummaryPayload(options.artifacts, options.artifactBaseDir);
  const targetStage = getRepairTargetStageFromDefectSummary(defectSummaryPayload);
  const collaborationTaskId = routePrefix ? `${routePrefix}--collaboration` : null;
  const collaborationTaskState = collaborationTaskId
    ? options.taskStateIndex.get(collaborationTaskId) ?? null
    : null;

  if (!routePrefix || !targetStage) {
    appendEscalationNotes(
      options.taskState,
      collaborationTaskState,
      'unsupported-target',
      null,
      null,
      defectSummaryPayload?.recommendedAction ?? null
    );
    return {
      status: 'escalated',
      reason: 'unsupported-target',
      targetTaskId: null,
      attemptNumber: null
    };
  }

  const targetTaskId = `${routePrefix}--${targetStage}`;
  const targetTask = options.taskGraphTaskIndex.get(targetTaskId);
  const targetTaskState = options.taskStateIndex.get(targetTaskId);
  if (!targetTask || !targetTaskState) {
    appendEscalationNotes(
      options.taskState,
      collaborationTaskState,
      'unsupported-target',
      targetTaskId,
      null,
      defectSummaryPayload?.recommendedAction ?? null
    );
    return {
      status: 'escalated',
      reason: 'unsupported-target',
      targetTaskId,
      attemptNumber: null
    };
  }

  const nextAttemptNumber = getLatestTaskNoteNumber(targetTaskState.notes, 'auto-repair-attempt:') + 1;
  const maxAutoRepairAttempts = targetTask.reviewPolicy?.maxAutoRepairAttempts ?? 0;
  const recommendedAction = defectSummaryPayload?.recommendedAction ?? null;

  if (maxAutoRepairAttempts <= 0) {
    appendEscalationNotes(options.taskState, collaborationTaskState, 'policy-disabled', targetTaskId, nextAttemptNumber, recommendedAction);
    return {
      status: 'escalated',
      reason: 'policy-disabled',
      targetTaskId,
      attemptNumber: nextAttemptNumber
    };
  }

  if ((targetTask.reviewPolicy?.blockedRiskLevels ?? []).includes(targetTask.riskLevel ?? 'low')) {
    appendEscalationNotes(options.taskState, collaborationTaskState, 'blocked-risk-level', targetTaskId, nextAttemptNumber, recommendedAction);
    return {
      status: 'escalated',
      reason: 'blocked-risk-level',
      targetTaskId,
      attemptNumber: nextAttemptNumber
    };
  }

  if (nextAttemptNumber > maxAutoRepairAttempts) {
    appendEscalationNotes(options.taskState, collaborationTaskState, 'budget-exhausted', targetTaskId, nextAttemptNumber, recommendedAction);
    return {
      status: 'escalated',
      reason: 'budget-exhausted',
      targetTaskId,
      attemptNumber: nextAttemptNumber
    };
  }

  const stageOrder: Record<Exclude<TaskStage, 'environment-preparation'>, number> = {
    'requirements-analysis': 1,
    'code-implementation': 2,
    'test-design': 3,
    'automated-execution': 4,
    'defect-feedback': 5,
    'collaboration': 6,
    'evaluation': 7
  };

  resetTaskStateForRetry(targetTaskState, 'ready');
  addTaskNotes(targetTaskState, [
    `auto-repair-attempt:${nextAttemptNumber}`,
    `auto-repair-trigger:${options.taskGraphTask.id}`,
    `auto-repair-class:${getLatestTaskNoteValue(options.taskState.notes, 'route-class:') ?? 'unknown'}`,
    `auto-repair-reason:${recommendedAction ?? 'unknown'}`
  ]);

  for (const [candidateTaskId, candidateTask] of options.taskGraphTaskIndex) {
    if (
      !candidateTaskId.startsWith(`${routePrefix}--`)
      || candidateTaskId === targetTaskId
      || candidateTask.stage === 'environment-preparation'
    ) {
      continue;
    }

    const candidateTaskState = options.taskStateIndex.get(candidateTaskId);
    if (!candidateTaskState) {
      continue;
    }

    const candidateStage = candidateTask.stage as Exclude<TaskStage, 'environment-preparation'>;
    if (stageOrder[candidateStage] > stageOrder[targetStage]) {
      resetTaskStateForRetry(candidateTaskState, 'pending');
      addTaskNotes(candidateTaskState, [
        `auto-repair-reset:${targetTaskId}`
      ]);
    }
  }

  addTaskNotes(options.taskState, [
    `auto-repair-triggered:${targetTaskId}`,
    `auto-repair-attempt:${nextAttemptNumber}`
  ]);

  return {
    status: 'triggered',
    targetTaskId,
    attemptNumber: nextAttemptNumber
  };
}
