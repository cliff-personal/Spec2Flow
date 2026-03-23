import { dedupe } from '../shared/collection-utils.js';
import { fail } from '../shared/fs-utils.js';
import { getSchemaValidators } from '../shared/schema-registry.js';
import type {
  ArtifactRef,
  ErrorItem,
  ExecutionStateDocument,
  ExecutionStatus,
  ProviderSessionMetadata,
  TaskState
} from '../types/execution-state.js';
import type { TaskGraphDocument, Task, TaskStage, TaskStatus } from '../types/task-graph.js';
import type { TaskResultDocument } from '../types/task-result.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface ExecutionArtifactPaths {
  taskGraph?: string;
}

export function buildExecutionArtifacts(taskGraphPayload: TaskGraphDocument, paths: ExecutionArtifactPaths): ArtifactRef[] {
  const source = taskGraphPayload.taskGraph.source ?? {};
  const artifacts: ArtifactRef[] = [];

  if (paths.taskGraph) {
    artifacts.push({
      id: 'task-graph',
      kind: 'report',
      path: paths.taskGraph
    });
  }

  if (source.projectAdapterRef) {
    artifacts.push({ id: 'project-adapter', kind: 'other', path: source.projectAdapterRef });
  }

  if (source.topologyRef) {
    artifacts.push({ id: 'topology', kind: 'other', path: source.topologyRef });
  }

  if (source.riskPolicyRef) {
    artifacts.push({ id: 'risk-policy', kind: 'other', path: source.riskPolicyRef });
  }

  return artifacts;
}

export function buildInitialTaskState(task: Task): TaskState {
  const notes = dedupe<string>([
    `stage:${task.stage}`,
    `role-profile:${task.roleProfile.profileId}`,
    `risk:${task.riskLevel}`,
    task.reviewPolicy?.requireHumanApproval ? 'requires-human-approval' : null,
    task.reviewPolicy?.required ? `review-agents:${task.reviewPolicy.reviewAgentCount}` : null
  ]);

  return {
    taskId: task.id,
    status: task.status === 'ready' ? 'ready' : 'pending',
    executor: task.executorType,
    attempts: 0,
    artifactRefs: task.id === 'environment-preparation' ? ['task-graph'] : [],
    notes
  };
}

export function buildExecutionState(
  taskGraphPayload: TaskGraphDocument,
  options: CliOptions,
  paths: ExecutionArtifactPaths
): ExecutionStateDocument {
  const now = new Date().toISOString();
  const workflowName = taskGraphPayload.taskGraph.workflowName;
  const taskStates = taskGraphPayload.taskGraph.tasks.map((task) => buildInitialTaskState(task));
  const provider: ProviderSessionMetadata = {
    adapter: typeof options.adapter === 'string' ? options.adapter : 'spec2flow-cli'
  };

  if (typeof options.model === 'string') {
    provider.model = options.model;
  }

  if (typeof options['session-id'] === 'string') {
    provider.sessionId = options['session-id'];
  }

  const runId = typeof options['run-id'] === 'string' ? options['run-id'] : `${workflowName}-${Date.now()}`;

  return {
    executionState: {
      runId,
      workflowName,
      status: 'pending',
      currentStage: taskGraphPayload.taskGraph.tasks.find((task) => task.status === 'ready')?.stage ?? 'environment-preparation',
      provider,
      startedAt: now,
      updatedAt: now,
      tasks: taskStates,
      artifacts: buildExecutionArtifacts(taskGraphPayload, paths),
      errors: []
    }
  };
}

export function getExecutionStateTaskIndex(executionStatePayload: ExecutionStateDocument): Map<string, TaskState> {
  return new Map(executionStatePayload.executionState.tasks.map((task) => [task.taskId, task]));
}

export function getTaskGraphTaskIndex(taskGraphPayload: TaskGraphDocument): Map<string, Task> {
  return new Map(taskGraphPayload.taskGraph.tasks.map((task) => [task.id, task]));
}

export function inferExecutionStateStatus(taskStates: TaskState[]): ExecutionStatus {
  if (taskStates.every((task) => ['completed', 'skipped'].includes(task.status))) {
    return 'completed';
  }

  if (taskStates.some((task) => task.status === 'failed')) {
    return 'failed';
  }

  if (taskStates.some((task) => task.status === 'blocked')) {
    return 'blocked';
  }

  if (taskStates.some((task) => task.status === 'in-progress')) {
    return 'running';
  }

  if (taskStates.some((task) => task.status === 'completed')) {
    return 'running';
  }

  return 'pending';
}

export function inferCurrentStage(taskGraphPayload: TaskGraphDocument, executionStatePayload: ExecutionStateDocument): TaskStage | undefined {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);

  for (const preferredStatus of ['in-progress', 'ready', 'pending', 'blocked', 'failed', 'completed'] as const) {
    const matchingTask = taskGraphPayload.taskGraph.tasks.find((task) => taskStateIndex.get(task.id)?.status === preferredStatus);
    if (matchingTask) {
      return matchingTask.stage;
    }
  }

  return undefined;
}

export function setTaskTerminalTimestamp(taskState: TaskState, status: TaskStatus, now: string): void {
  if (status === 'in-progress' && !taskState.startedAt) {
    taskState.startedAt = now;
  }

  if (['completed', 'failed', 'skipped'].includes(status)) {
    if (!taskState.startedAt) {
      taskState.startedAt = now;
    }
    taskState.completedAt = now;
  }
}

export function promoteReadyTasks(taskGraphPayload: TaskGraphDocument, executionStatePayload: ExecutionStateDocument): void {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);

  for (const task of taskGraphPayload.taskGraph.tasks) {
    const taskState = taskStateIndex.get(task.id);
    if (taskState?.status !== 'pending') {
      continue;
    }

    const dependencies = task.dependsOn ?? [];
    const dependenciesSatisfied = dependencies.every((dependencyId) => {
      const dependencyState = taskStateIndex.get(dependencyId);
      return dependencyState !== undefined && ['completed', 'skipped'].includes(dependencyState.status);
    });

    if (dependencies.length > 0 && dependenciesSatisfied) {
      taskState.status = 'ready';
    }
  }
}

export function appendUniqueItems(target: string[] | undefined, values: Array<string | null | undefined>): string[] | undefined {
  const combined = dedupe<string>([...(target ?? []), ...values]);
  return combined.length > 0 ? combined : undefined;
}

export function parseArtifactOption(value: string | undefined, defaultTaskId: string | undefined): ArtifactRef[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, kind, artifactPath, taskId] = entry.split('|');
      if (!id || !kind || !artifactPath) {
        fail('--add-artifacts entries must use id|kind|path or id|kind|path|taskId');
      }

      const resolvedTaskId = taskId || defaultTaskId;
      const artifact: ArtifactRef = {
        id,
        kind: kind as ArtifactRef['kind'],
        path: artifactPath,
        ...(resolvedTaskId ? { taskId: resolvedTaskId } : {})
      };
      if (resolvedTaskId) {
        artifact.taskId = resolvedTaskId;
      }
      return artifact;
    });
}

export function parseErrorOption(value: string | undefined, defaultTaskId: string | undefined): ErrorItem[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [code, message, taskId, recoverable] = entry.split('|');
      if (!code || !message) {
        fail('--add-errors entries must use code|message or code|message|taskId|recoverable');
      }

      const error: ErrorItem = { code, message };
      const resolvedTaskId = taskId || defaultTaskId;
      if (resolvedTaskId) {
        error.taskId = resolvedTaskId;
      }
      if (recoverable) {
        error.recoverable = recoverable === 'true';
      }
      return error;
    });
}

export function validateExecutionStatePayload(executionStatePayload: ExecutionStateDocument, statePath: string): void {
  const validators = getSchemaValidators();
  const valid = validators.executionState(executionStatePayload);
  if (!valid) {
    fail(`execution-state validation failed for ${statePath}: ${JSON.stringify(validators.executionState.errors ?? [])}`);
  }
}

export function getTaskArtifacts(executionStatePayload: ExecutionStateDocument, taskId: string): ArtifactRef[] {
  return (executionStatePayload.executionState.artifacts ?? []).filter((artifact) => artifact.taskId === taskId);
}

export function getTaskErrors(executionStatePayload: ExecutionStateDocument, taskId: string): ErrorItem[] {
  return (executionStatePayload.executionState.errors ?? []).filter((error) => error.taskId === taskId);
}

export function buildTaskResultReceipt(
  taskId: string,
  status: TaskStatus,
  statePath: string,
  notes: string[],
  artifacts: ArtifactRef[],
  errors: ErrorItem[]
): TaskResultDocument {
  return {
    taskResult: {
      taskId,
      status,
      executionStateRef: statePath,
      notes,
      artifacts,
      errors,
      submittedAt: new Date().toISOString()
    }
  };
}