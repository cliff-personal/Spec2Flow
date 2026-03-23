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
import { fail, writeJson } from '../shared/fs-utils.js';
import type { ArtifactRef, ErrorItem, ExecutionStateDocument, ExecutionStatus } from '../types/execution-state.js';
import type { TaskGraphDocument, TaskStage, TaskStatus } from '../types/task-graph.js';
import type { TaskResultDocument } from '../types/task-result.js';

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

  promoteReadyTasks(taskGraphPayload, executionStatePayload);
  executionStatePayload.executionState.status = payload.workflowStatus ?? inferExecutionStateStatus(executionStatePayload.executionState.tasks);
  const nextCurrentStage = payload.currentStage ?? inferCurrentStage(taskGraphPayload, executionStatePayload);
  if (nextCurrentStage !== undefined) {
    executionStatePayload.executionState.currentStage = nextCurrentStage;
  }
  executionStatePayload.executionState.updatedAt = now;
  validateExecutionStatePayload(executionStatePayload, statePath);
  writeJson(statePath, executionStatePayload);

  return buildTaskResultReceipt(payload.taskId, payload.taskStatus, statePath, payload.notes, payload.artifacts, payload.errors);
}