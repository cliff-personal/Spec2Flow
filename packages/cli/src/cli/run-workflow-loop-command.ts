import { loadOptionalStructuredFile } from '../shared/fs-utils.js';
import { claimNextTaskPayload } from '../runtime/task-claim-service.js';
import { runWorkflowLoopWithExecutor } from '../runtime/workflow-loop-service.js';
import { executeTaskRun } from '../adapters/adapter-runner.js';
import type { AdapterRuntimeDocument, TaskClaimPayload, WorkflowLoopSummaryDocument } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface RunWorkflowLoopDependencies {
  ensureAdapterPreflight: (options: CliOptions, adapterRuntimePayload: AdapterRuntimeDocument) => void;
  fail: (message: string) => void;
  getRouteNameFromTaskId: (taskId: string | null | undefined) => string;
  parseCsvOption: (value: string | undefined) => string[];
  printJson: (value: WorkflowLoopSummaryDocument) => void;
  readStructuredFile: (filePath: string) => any;
  sanitizeStageName: (stage: string) => string;
  validateAdapterRuntimePayload: (adapterRuntimePayload: AdapterRuntimeDocument, runtimePath: string) => void;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function runWorkflowLoop(options: CliOptions, dependencies: RunWorkflowLoopDependencies): void {
  const loopSummary = runWorkflowLoopWithExecutor(options, {
    fail: (message: string): never => {
      dependencies.fail(message);
      throw new Error('unreachable');
    },
    readStructuredFile: dependencies.readStructuredFile,
    writeJson: dependencies.writeJson,
    claimNextTaskPayload: (statePath: string, taskGraphPath: string, claimOptions: CliOptions): TaskClaimPayload =>
      claimNextTaskPayload(statePath, taskGraphPath, claimOptions, {
        readStructuredFile: dependencies.readStructuredFile,
        loadOptionalStructuredFile,
        writeJson: dependencies.writeJson
      }),
    executeTaskRun: (statePath: string, taskGraphPath: string, claimPayload: TaskClaimPayload, runOptions: CliOptions) =>
      executeTaskRun(statePath, taskGraphPath, claimPayload, runOptions, {
        validateAdapterRuntimePayload: dependencies.validateAdapterRuntimePayload,
        sanitizeStageName: dependencies.sanitizeStageName,
        getRouteNameFromTaskId: dependencies.getRouteNameFromTaskId,
        parseCsvOption: dependencies.parseCsvOption
      }),
    validateAdapterRuntimePayload: dependencies.validateAdapterRuntimePayload,
    ensureAdapterPreflight: dependencies.ensureAdapterPreflight
  });

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  if (outputPath) {
    dependencies.writeJson(outputPath, loopSummary);
    console.log(`Wrote workflow loop summary to ${outputPath}`);
    return;
  }

  dependencies.printJson(loopSummary);
}