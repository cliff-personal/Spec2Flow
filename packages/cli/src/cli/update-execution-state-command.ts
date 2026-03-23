import {
  appendUniqueItems,
  getExecutionStateTaskIndex,
  getTaskGraphTaskIndex,
  inferCurrentStage,
  inferExecutionStateStatus,
  parseArtifactOption,
  parseErrorOption,
  promoteReadyTasks,
  setTaskTerminalTimestamp,
  validateExecutionStatePayload
} from '../runtime/execution-state-service.js';
import type { ExecutionStateDocument, ExecutionStatus, TaskGraphDocument, TaskStage, TaskStatus } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface UpdateExecutionStateDependencies {
  fail: (message: string) => void;
  parseCsvOption: (value: string | undefined) => string[];
  printJson: (value: ExecutionStateDocument) => void;
  readStructuredFile: (filePath: string) => ExecutionStateDocument | TaskGraphDocument;
  writeJson: (filePath: string, payload: unknown) => void;
}

function parseTaskStatus(value: string | boolean | undefined): TaskStatus | undefined {
  return value === 'pending' ||
    value === 'ready' ||
    value === 'in-progress' ||
    value === 'blocked' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped'
    ? value
    : undefined;
}

function parseExecutionStatus(value: string | boolean | undefined): ExecutionStatus | undefined {
  return value === 'pending' ||
    value === 'running' ||
    value === 'blocked' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
    ? value
    : undefined;
}

function parseTaskStage(value: string | boolean | undefined): TaskStage | undefined {
  return value === 'environment-preparation' ||
    value === 'requirements-analysis' ||
    value === 'code-implementation' ||
    value === 'test-design' ||
    value === 'automated-execution' ||
    value === 'defect-feedback' ||
    value === 'collaboration'
    ? value
    : undefined;
}

export function runUpdateExecutionState(options: CliOptions, dependencies: UpdateExecutionStateDependencies): void {
  const statePath = typeof options.state === 'string' ? options.state : undefined;
  const taskGraphPath = typeof options['task-graph'] === 'string' ? options['task-graph'] : undefined;

  if (!statePath || !taskGraphPath) {
    dependencies.fail('update-execution-state requires --state and --task-graph');
    throw new Error('unreachable');
  }

  const executionStatePayload = dependencies.readStructuredFile(statePath) as ExecutionStateDocument;
  const taskGraphPayload = dependencies.readStructuredFile(taskGraphPath) as TaskGraphDocument;
  const taskGraphTaskIndex = getTaskGraphTaskIndex(taskGraphPayload);
  const taskStateIndex = getExecutionStateTaskIndex(executionStatePayload);
  const taskId = typeof options['task-id'] === 'string' ? options['task-id'] : undefined;
  const taskStatus = parseTaskStatus(options['task-status']);
  const now = new Date().toISOString();

  if (taskId) {
    const taskState = taskStateIndex.get(taskId);
    const taskGraphTask = taskGraphTaskIndex.get(taskId);

    if (!taskState || !taskGraphTask) {
      dependencies.fail(`unknown task id: ${taskId}`);
      throw new Error('unreachable');
    }

    if (taskStatus) {
      taskState.status = taskStatus;
      if ((taskStatus === 'in-progress' || options['increment-attempts']) && typeof taskState.attempts === 'number') {
        taskState.attempts += 1;
      }
      setTaskTerminalTimestamp(taskState, taskStatus, now);
    }

    if (typeof options.executor === 'string') {
      taskState.executor = options.executor;
    }

    const notes = appendUniqueItems(taskState.notes, dependencies.parseCsvOption(typeof options.notes === 'string' ? options.notes : undefined));
    if (notes) {
      taskState.notes = notes;
    }

    const artifactRefs = appendUniqueItems(
      taskState.artifactRefs,
      dependencies.parseCsvOption(typeof options['artifact-refs'] === 'string' ? options['artifact-refs'] : undefined)
    );
    if (artifactRefs) {
      taskState.artifactRefs = artifactRefs;
    }
  }

  const artifactsToAdd = parseArtifactOption(typeof options['add-artifacts'] === 'string' ? options['add-artifacts'] : undefined, taskId);
  const errorsToAdd = parseErrorOption(typeof options['add-errors'] === 'string' ? options['add-errors'] : undefined, taskId);

  if (artifactsToAdd.length > 0) {
    executionStatePayload.executionState.artifacts = [
      ...(executionStatePayload.executionState.artifacts ?? []),
      ...artifactsToAdd
    ];
  }

  if (errorsToAdd.length > 0) {
    executionStatePayload.executionState.errors = [
      ...(executionStatePayload.executionState.errors ?? []),
      ...errorsToAdd
    ];
  }

  promoteReadyTasks(taskGraphPayload, executionStatePayload);
  executionStatePayload.executionState.status = parseExecutionStatus(options.status) ?? inferExecutionStateStatus(executionStatePayload.executionState.tasks);
  const currentStage = parseTaskStage(options.stage) ?? inferCurrentStage(taskGraphPayload, executionStatePayload);
  if (currentStage) {
    executionStatePayload.executionState.currentStage = currentStage;
  }
  executionStatePayload.executionState.updatedAt = now;

  validateExecutionStatePayload(executionStatePayload, statePath);

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  if (outputPath) {
    dependencies.writeJson(outputPath, executionStatePayload);
    console.log(`Wrote execution state to ${outputPath}`);
    return;
  }

  dependencies.writeJson(statePath, executionStatePayload);
  console.log(`Updated execution state at ${statePath}`);
}