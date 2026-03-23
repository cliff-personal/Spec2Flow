import { loadOptionalStructuredFile, parseCsvOption } from '../shared/fs-utils.js';
import { parseArtifactOption, parseErrorOption } from '../runtime/execution-state-service.js';
import { getTaskIdFromClaim } from '../runtime/task-claim-service.js';
import { applyTaskResult } from '../runtime/task-result-service.js';
import type { ExecutionStateDocument, TaskClaimPayload, TaskGraphDocument, TaskResultDocument } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface SubmitTaskResultDependencies {
  fail: (message: string) => void;
  printJson: (value: TaskResultDocument) => void;
  readStructuredFile: (filePath: string) => any;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function runSubmitTaskResult(options: CliOptions, dependencies: SubmitTaskResultDependencies): void {
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];

  if (typeof statePath !== 'string' || typeof taskGraphPath !== 'string') {
    dependencies.fail('submit-task-result requires --state and --task-graph');
    throw new Error('unreachable');
  }

  const executionStatePayload = dependencies.readStructuredFile(statePath) as ExecutionStateDocument;
  const taskGraphPayload = dependencies.readStructuredFile(taskGraphPath) as TaskGraphDocument;
  const claimPayload = loadOptionalStructuredFile<TaskClaimPayload>(typeof options.claim === 'string' ? options.claim : undefined);
  const taskId = typeof options['task-id'] === 'string' ? options['task-id'] : getTaskIdFromClaim(claimPayload);
  const requestedTaskStatus = typeof options['result-status'] === 'string'
    ? options['result-status']
    : typeof options['task-status'] === 'string'
      ? options['task-status']
      : undefined;
  const taskStatus =
    requestedTaskStatus === 'pending' ||
    requestedTaskStatus === 'ready' ||
    requestedTaskStatus === 'in-progress' ||
    requestedTaskStatus === 'blocked' ||
    requestedTaskStatus === 'completed' ||
    requestedTaskStatus === 'failed' ||
    requestedTaskStatus === 'skipped'
      ? requestedTaskStatus
      : 'completed';
  const workflowStatus =
    options.status === 'pending' ||
    options.status === 'running' ||
    options.status === 'blocked' ||
    options.status === 'completed' ||
    options.status === 'failed' ||
    options.status === 'cancelled'
      ? options.status
      : undefined;
  const currentStage =
    options.stage === 'environment-preparation' ||
    options.stage === 'requirements-analysis' ||
    options.stage === 'code-implementation' ||
    options.stage === 'test-design' ||
    options.stage === 'automated-execution' ||
    options.stage === 'defect-feedback' ||
    options.stage === 'collaboration'
      ? options.stage
      : undefined;

  if (!taskId) {
    dependencies.fail('submit-task-result requires --task-id or --claim');
    throw new Error('unreachable');
  }

  const notes = parseCsvOption(typeof options.notes === 'string' ? options.notes : undefined);
  if (typeof options.summary === 'string') {
    notes.unshift(`summary:${options.summary}`);
  }

  const artifactsToAdd = parseArtifactOption(typeof options['add-artifacts'] === 'string' ? options['add-artifacts'] : undefined, taskId);
  const errorsToAdd = parseErrorOption(typeof options['add-errors'] === 'string' ? options['add-errors'] : undefined, taskId);
  const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
    taskId,
    taskStatus,
    notes,
    artifacts: artifactsToAdd,
    errors: errorsToAdd,
    ...(typeof options.executor === 'string' ? { executor: options.executor } : {}),
    ...(workflowStatus !== undefined ? { workflowStatus } : {}),
    ...(currentStage !== undefined ? { currentStage } : {})
  });

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  if (outputPath) {
    dependencies.writeJson(outputPath, receipt);
    console.log(`Wrote task result to ${outputPath}`);
    return;
  }

  dependencies.printJson(receipt);
}