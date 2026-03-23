import { executeTaskRun } from '../adapters/adapter-runner.js';
import type { AdapterRun, TaskClaimPayload, TaskResult } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface SimulatedModelRunDocument {
  simulatedRun: AdapterRun;
  receipt: TaskResult;
}

export interface SimulateModelRunDependencies {
  fail: (message: string) => void;
  getRouteNameFromTaskId: (taskId: string | null | undefined) => string;
  parseCsvOption: (value: string | undefined) => string[];
  printJson: (value: SimulatedModelRunDocument) => void;
  readStructuredFile: (filePath: string) => any;
  sanitizeStageName: (stage: string) => string;
  validateAdapterRuntimePayload: (adapterRuntimePayload: any, runtimePath: string) => void;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function runSimulateModelRun(options: CliOptions, dependencies: SimulateModelRunDependencies): void {
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];
  const claimPath = options.claim;

  if (typeof statePath !== 'string' || typeof taskGraphPath !== 'string' || typeof claimPath !== 'string') {
    dependencies.fail('simulate-model-run requires --state, --task-graph, and --claim');
    throw new Error('unreachable');
  }

  const claimPayload = dependencies.readStructuredFile(claimPath) as TaskClaimPayload;
  const result = executeTaskRun(statePath, taskGraphPath, claimPayload, options, {
    validateAdapterRuntimePayload: dependencies.validateAdapterRuntimePayload,
    sanitizeStageName: dependencies.sanitizeStageName,
    getRouteNameFromTaskId: dependencies.getRouteNameFromTaskId,
    parseCsvOption: dependencies.parseCsvOption
  });
  const outputPayload: SimulatedModelRunDocument = {
    simulatedRun: result.adapterRun,
    receipt: result.receipt
  };

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  if (outputPath) {
    dependencies.writeJson(outputPath, outputPayload);
    console.log(`Wrote simulated model run to ${outputPath}`);
    return;
  }

  dependencies.printJson(outputPayload);
}