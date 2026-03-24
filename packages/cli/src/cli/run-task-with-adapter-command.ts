import { executeTaskRun } from '../adapters/adapter-runner.js';
import { resolveAdapterRuntimeForStage } from '../adapters/adapter-runtime-resolver.js';
import type { AdapterRun, AdapterRuntimeDocument, TaskClaimPayload, TaskResult } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface AdapterTaskRunDocument {
  adapterRun: AdapterRun;
  receipt: TaskResult;
}

export interface RunTaskWithAdapterDependencies {
  ensureAdapterPreflight: (options: CliOptions, adapterRuntimePayload: AdapterRuntimeDocument) => void;
  fail: (message: string) => void;
  getRouteNameFromTaskId: (taskId: string | null | undefined) => string;
  parseCsvOption: (value: string | undefined) => string[];
  printJson: (value: AdapterTaskRunDocument) => void;
  readStructuredFile: (filePath: string) => any;
  sanitizeStageName: (stage: string) => string;
  validateAdapterRuntimePayload: (adapterRuntimePayload: AdapterRuntimeDocument, runtimePath: string) => void;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function runTaskWithAdapter(options: CliOptions, dependencies: RunTaskWithAdapterDependencies): void {
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];
  const claimPath = options.claim;
  const adapterRuntimePath = options['adapter-runtime'];

  if (
    typeof statePath !== 'string' ||
    typeof taskGraphPath !== 'string' ||
    typeof claimPath !== 'string' ||
    typeof adapterRuntimePath !== 'string'
  ) {
    dependencies.fail('run-task-with-adapter requires --state, --task-graph, --claim, and --adapter-runtime');
    throw new Error('unreachable');
  }

  const claimPayload = dependencies.readStructuredFile(claimPath) as TaskClaimPayload;
  const claim = claimPayload.taskClaim;
  if (!claim) {
    dependencies.fail('run-task-with-adapter requires a non-null task claim');
    throw new Error('unreachable');
  }

  const rootAdapterRuntimePayload = dependencies.readStructuredFile(adapterRuntimePath) as AdapterRuntimeDocument;
  dependencies.validateAdapterRuntimePayload(rootAdapterRuntimePayload, adapterRuntimePath);
  const resolvedRuntime = resolveAdapterRuntimeForStage(adapterRuntimePath, rootAdapterRuntimePayload, claim.stage, {
    readStructuredFile: dependencies.readStructuredFile,
    validateAdapterRuntimePayload: dependencies.validateAdapterRuntimePayload
  });
  dependencies.ensureAdapterPreflight(options, resolvedRuntime.runtimePayload);

  const result = executeTaskRun(statePath, taskGraphPath, claimPayload, options, {
    validateAdapterRuntimePayload: dependencies.validateAdapterRuntimePayload,
    sanitizeStageName: dependencies.sanitizeStageName,
    getRouteNameFromTaskId: dependencies.getRouteNameFromTaskId,
    parseCsvOption: dependencies.parseCsvOption
  });
  const outputPayload: AdapterTaskRunDocument = {
    adapterRun: result.adapterRun,
    receipt: result.receipt
  };

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  if (outputPath) {
    dependencies.writeJson(outputPath, outputPayload);
    console.log(`Wrote adapter run result to ${outputPath}`);
    return;
  }

  dependencies.printJson(outputPayload);
}