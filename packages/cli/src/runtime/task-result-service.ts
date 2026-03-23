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
import { getSchemaValidators } from '../shared/schema-registry.js';
import type { ArtifactContractSummary, TaskResultDocument } from '../types/task-result.js';

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
    payload.taskStatus,
    statePath,
    payload.notes,
    payload.artifacts,
    artifactContract,
    payload.errors
  );
  validateTaskResultPayload(receipt);
  return receipt;
}