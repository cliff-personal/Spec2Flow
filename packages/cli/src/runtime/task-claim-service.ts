import {
  getExecutionStateTaskIndex,
  getTaskArtifacts,
  getTaskErrors,
  setTaskTerminalTimestamp,
  validateExecutionStatePayload
} from './execution-state-service.js';
import { fail } from '../shared/fs-utils.js';
import type { ExecutionStateDocument } from '../types/execution-state.js';
import type { ModelAdapterCapability, TaskClaimPayload } from '../types/task-claim.js';
import type { Task, TaskGraphDocument } from '../types/task-graph.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface ProjectPayload {
  spec2flow?: {
    docs?: Record<string, Array<string | null | undefined> | undefined>;
  };
}

export interface AdapterCapabilityDocument {
  adapter?: ModelAdapterCapability;
}

export interface TaskClaimPaths {
  state: string;
  taskGraph: string;
  adapterCapability: string | null;
}

export interface TaskClaimDependencies {
  readStructuredFile: (filePath: string) => any;
  loadOptionalStructuredFile: <T = unknown>(filePath: string | undefined) => T | null;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function flattenProjectDocRefs(projectPayload: ProjectPayload | null | undefined): string[] {
  const docs = projectPayload?.spec2flow?.docs ?? {};
  return [...new Set(Object.values(docs).flatMap((value) => value ?? []).filter(Boolean))] as string[];
}

export function findNextReadyTask(taskGraphPayload: TaskGraphDocument, executionStatePayload: ExecutionStateDocument): Task | null {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  return taskGraphPayload.taskGraph.tasks.find((task) => taskStateIndex.get(task.id)?.status === 'ready') ?? null;
}

export function findInProgressTask(taskGraphPayload: TaskGraphDocument, executionStatePayload: ExecutionStateDocument): Task | null {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  return taskGraphPayload.taskGraph.tasks.find((task) => taskStateIndex.get(task.id)?.status === 'in-progress') ?? null;
}

export function getRouteNameFromTaskId(taskId: string | null | undefined): string {
  if (!taskId) {
    return '';
  }

  return taskId.includes('--') ? taskId.split('--')[0] ?? '' : taskId;
}

export function buildTaskClaim(
  task: Task,
  executionStatePayload: ExecutionStateDocument,
  taskGraphPayload: TaskGraphDocument,
  projectPayload: ProjectPayload | null | undefined,
  adapterCapabilityPayload: AdapterCapabilityDocument | null | undefined,
  paths: TaskClaimPaths
): TaskClaimPayload {
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  const taskState = taskStateIndex.get(task.id);
  if (!taskState) {
    fail(`missing execution state for task: ${task.id}`);
  }
  const source = taskGraphPayload.taskGraph.source ?? {};

  return {
    taskClaim: {
      runId: executionStatePayload.executionState.runId,
      workflowName: executionStatePayload.executionState.workflowName,
      taskId: task.id,
      title: task.title,
      stage: task.stage,
      goal: task.goal,
      executorType: task.executorType,
      ...(task.riskLevel ? { riskLevel: task.riskLevel } : {}),
      ...(task.reviewPolicy ? { reviewPolicy: task.reviewPolicy } : {}),
      modelAdapterCapabilityRef: paths.adapterCapability,
      modelAdapterCapability: adapterCapabilityPayload?.adapter ?? null,
      repositoryContext: {
        requirementRef: source.requirementRef ?? null,
        requirementText: source.requirementText ?? null,
        routeSelectionMode: source.routeSelectionMode ?? null,
        selectedRoutes: source.selectedRoutes ?? [],
        projectAdapterRef: source.projectAdapterRef ?? null,
        topologyRef: source.topologyRef ?? null,
        riskPolicyRef: source.riskPolicyRef ?? null,
        docs: flattenProjectDocRefs(projectPayload),
        changedFiles: source.changeSet ?? [],
        targetFiles: task.targetFiles ?? [],
        verifyCommands: task.verifyCommands ?? [],
        taskInputs: task.inputs ?? {}
      },
      runtimeContext: {
        executionStateRef: paths.state,
        taskGraphRef: paths.taskGraph,
        currentRunStatus: executionStatePayload.executionState.status,
        ...(executionStatePayload.executionState.currentStage
          ? { currentStage: executionStatePayload.executionState.currentStage }
          : {}),
        ...(executionStatePayload.executionState.provider !== undefined
          ? { provider: executionStatePayload.executionState.provider ?? null }
          : {}),
        attempt: taskState.attempts ?? 0,
        artifactRefs: taskState.artifactRefs ?? [],
        taskArtifacts: getTaskArtifacts(executionStatePayload, task.id),
        taskErrors: getTaskErrors(executionStatePayload, task.id),
        artifactsDir: task.artifactsDir ?? null,
        dependsOn: task.dependsOn ?? []
      },
      instructions: [
        `Execute only the task identified by ${task.id}.`,
        'Respect the declared target files, verification commands, and review policy.',
        'Persist outputs back into execution-state.json before moving to downstream tasks.'
      ]
    }
  };
}

export function claimNextTaskPayload(
  statePath: string,
  taskGraphPath: string,
  options: CliOptions,
  dependencies: TaskClaimDependencies
): TaskClaimPayload {
  const { readStructuredFile, loadOptionalStructuredFile, writeJson } = dependencies;
  const executionStatePayload = readStructuredFile(statePath) as ExecutionStateDocument;
  const taskGraphPayload = readStructuredFile(taskGraphPath) as TaskGraphDocument;
  const projectPayload = loadOptionalStructuredFile<ProjectPayload>(taskGraphPayload.taskGraph.source?.projectAdapterRef ?? undefined);
  const adapterCapabilityPayload = loadOptionalStructuredFile<AdapterCapabilityDocument>(
    typeof options['adapter-capability'] === 'string' ? options['adapter-capability'] : undefined
  );
  const nextTask = findNextReadyTask(taskGraphPayload, executionStatePayload);
  const resumableTask = !nextTask && options['allow-resume-in-progress'] ? findInProgressTask(taskGraphPayload, executionStatePayload) : null;
  const taskToClaim = nextTask ?? resumableTask;

  if (!taskToClaim) {
    return {
      taskClaim: null,
      message: 'no ready task available for claiming',
      runId: executionStatePayload.executionState.runId,
      workflowName: executionStatePayload.executionState.workflowName,
      status: executionStatePayload.executionState.status
    };
  }

  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  const taskState = taskStateIndex.get(taskToClaim.id);
  if (!taskState) {
    fail(`missing execution state for task: ${taskToClaim.id}`);
  }
  const now = new Date().toISOString();
  const shouldMarkInProgress = !options['no-mark-in-progress'] && !resumableTask;

  if (shouldMarkInProgress) {
    taskState.status = 'in-progress';
    taskState.attempts = (taskState.attempts ?? 0) + 1;
    if (typeof options.executor === 'string') {
      taskState.executor = options.executor;
    }
    setTaskTerminalTimestamp(taskState, 'in-progress', now);
    executionStatePayload.executionState.status = 'running';
    executionStatePayload.executionState.currentStage = taskToClaim.stage;
    executionStatePayload.executionState.updatedAt = now;
    validateExecutionStatePayload(executionStatePayload, statePath);
    writeJson(statePath, executionStatePayload);
  }

  return buildTaskClaim(taskToClaim, executionStatePayload, taskGraphPayload, projectPayload, adapterCapabilityPayload, {
    state: statePath,
    taskGraph: taskGraphPath,
    adapterCapability: typeof options['adapter-capability'] === 'string' ? options['adapter-capability'] : null
  });
}

export function getTaskIdFromClaim(claimPayload: TaskClaimPayload | null | undefined): string | null {
  return claimPayload?.taskClaim?.taskId ?? null;
}