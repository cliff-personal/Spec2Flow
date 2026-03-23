import path from 'node:path';
import type { AdapterRuntimeDocument } from '../types/adapter-runtime.js';
import type { TaskClaimPayload } from '../types/task-claim.js';
import type { TaskExecutionResult } from '../types/adapter-run.js';
import type { WorkflowLoopSummaryDocument } from '../types/workflow-loop-summary.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface WorkflowLoopDependencies {
  fail: (message: string) => never;
  readStructuredFile: (filePath: string) => any;
  writeJson: (filePath: string, payload: unknown) => void;
  claimNextTaskPayload: (statePath: string, taskGraphPath: string, options: CliOptions) => TaskClaimPayload;
  executeTaskRun: (statePath: string, taskGraphPath: string, claimPayload: TaskClaimPayload, options: CliOptions) => TaskExecutionResult;
  validateAdapterRuntimePayload: (payload: AdapterRuntimeDocument, runtimePath: string) => void;
  ensureAdapterPreflight: (options: CliOptions, payload: AdapterRuntimeDocument) => void;
}

export function runWorkflowLoopWithExecutor(options: CliOptions, dependencies: WorkflowLoopDependencies): WorkflowLoopSummaryDocument {
  const {
    fail,
    readStructuredFile,
    writeJson,
    claimNextTaskPayload,
    executeTaskRun,
    validateAdapterRuntimePayload,
    ensureAdapterPreflight
  } = dependencies;
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];

  if (typeof statePath !== 'string' || typeof taskGraphPath !== 'string') {
    fail('run-workflow-loop requires --state and --task-graph');
  }

  const stateFilePath = statePath as string;
  const taskGraphFilePath = taskGraphPath as string;

  const maxStepsInput = typeof options['max-steps'] === 'string' ? options['max-steps'] : '100';
  const maxSteps = Number.parseInt(maxStepsInput, 10);
  if (Number.isNaN(maxSteps) || maxSteps < 1) {
    fail('--max-steps must be a positive integer');
  }

  const adapterRuntimePath = typeof options['adapter-runtime'] === 'string' ? options['adapter-runtime'] : undefined;
  const adapterRuntimePayload = adapterRuntimePath ? readStructuredFile(adapterRuntimePath) as AdapterRuntimeDocument : null;
  if (adapterRuntimePayload && adapterRuntimePath) {
    validateAdapterRuntimePayload(adapterRuntimePayload, adapterRuntimePath);
    ensureAdapterPreflight(options, adapterRuntimePayload);
  }

  const outputBase = typeof options['output-base'] === 'string'
    ? options['output-base']
    : 'docs/examples/synapse-network/generated';
  const loopSummary: WorkflowLoopSummaryDocument = {
    workflowLoop: {
      runId: null,
      workflowName: null,
      maxSteps,
      stepsExecuted: 0,
      stopReason: 'max-steps-reached',
      claimedTaskIds: [],
      receipts: []
    }
  };

  for (let step = 1; step <= maxSteps; step += 1) {
    const claimPayload = claimNextTaskPayload(stateFilePath, taskGraphFilePath, {
      ...options,
      'allow-resume-in-progress': true,
      output: undefined
    });

    if (!loopSummary.workflowLoop.runId) {
      const statePayload = readStructuredFile(stateFilePath) as { executionState: { runId: string; workflowName: string } };
      loopSummary.workflowLoop.runId = claimPayload.runId ?? claimPayload.taskClaim?.runId ?? statePayload.executionState.runId;
      loopSummary.workflowLoop.workflowName = claimPayload.workflowName ?? claimPayload.taskClaim?.workflowName ?? statePayload.executionState.workflowName;
    }

    const claimedTask = claimPayload.taskClaim;

    if (!claimedTask) {
      loopSummary.workflowLoop.stopReason = claimPayload.status ?? 'no-ready-task';
      break;
    }

    const claimFile = path.join(outputBase, `task-claim-step-${step}.json`);
    writeJson(claimFile, claimPayload);

    const adapterFile = path.join(
      outputBase,
      `${adapterRuntimePath ? 'adapter-run' : 'simulated-model-run'}-step-${step}.json`
    );
    const result = executeTaskRun(stateFilePath, taskGraphFilePath, claimPayload, {
      ...options,
      claim: claimFile,
      'adapter-output': adapterFile
    });
    writeJson(adapterFile, {
      adapterRun: result.adapterRun,
      receipt: result.receipt
    });

    loopSummary.workflowLoop.stepsExecuted = step;
    loopSummary.workflowLoop.claimedTaskIds.push(claimedTask.taskId);
    loopSummary.workflowLoop.receipts.push({
      taskId: result.receipt.taskId,
      status: result.receipt.status,
      claimRef: claimFile,
      adapterRunRef: adapterFile,
      executionMode: result.mode
    });

    const updatedState = readStructuredFile(stateFilePath) as { executionState: { status: string } };
    if (updatedState.executionState.status === 'completed') {
      loopSummary.workflowLoop.stopReason = 'completed';
      break;
    }
  }

  return loopSummary;
}