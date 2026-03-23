import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fail, loadOptionalStructuredFile, readStructuredFile, resolveFromCwd } from '../shared/fs-utils.js';
import { applyTaskResult } from '../runtime/task-result-service.js';
import {
  buildAdapterTemplateContext,
  extractCopilotAssistantContent,
  extractJsonPayload,
  expandTemplateValue,
  normalizeAdapterRunPayload,
  readAdapterOutput
} from './adapter-normalizer.js';
import type {
  AdapterRunDocument,
  AdapterRuntimeDocument,
  ExecutionStateDocument,
  ExecutionStatus,
  ModelAdapterCapability,
  TaskClaimPayload,
  TaskGraphDocument,
  TaskExecutionResult,
  TaskStage
} from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

interface AdapterCapabilityDocument {
  adapter?: ModelAdapterCapability;
}

export interface AdapterRunnerDependencies {
  validateAdapterRuntimePayload: (payload: AdapterRuntimeDocument, runtimePath: string) => void;
  sanitizeStageName: (stage: string) => string;
  getRouteNameFromTaskId: (taskId: string | null | undefined) => string;
  parseCsvOption: (value: string | undefined) => string[];
}

export interface SimulatedAdapterOptions {
  sanitizeStageName: (stage: string) => string;
  getRouteNameFromTaskId: (taskId: string | null | undefined) => string;
  parseCsvOption: (value: string | undefined) => string[];
  adapter?: string;
  summary?: string;
  notes?: string;
  'result-status'?: string;
}

export function buildSimulatedAdapterOutput(
  claimPayload: TaskClaimPayload,
  adapterCapabilityPayload: AdapterCapabilityDocument | null | undefined,
  options: SimulatedAdapterOptions
): AdapterRunDocument {
  const claim = claimPayload.taskClaim;
  if (!claim) {
    fail('task claim is required to build simulated adapter output');
  }
  const stageName = options.sanitizeStageName(claim.stage);
  const routeName = options.getRouteNameFromTaskId(claim.taskId);
  const adapterName = adapterCapabilityPayload?.adapter?.name ?? options.adapter ?? 'simulated-adapter';
  const outputPath = `spec2flow/outputs/execution/${routeName}/${stageName}-output.json`;
  const artifactId = `${claim.taskId}-${stageName}-output`;
  const summary = options.summary ?? `simulated-${claim.stage}-completed`;
  const requestedResultStatus = options['result-status'];
  const resultStatus =
    requestedResultStatus === 'pending' ||
    requestedResultStatus === 'ready' ||
    requestedResultStatus === 'in-progress' ||
    requestedResultStatus === 'blocked' ||
    requestedResultStatus === 'completed' ||
    requestedResultStatus === 'failed' ||
    requestedResultStatus === 'skipped'
      ? requestedResultStatus
      : undefined;

  return {
    adapterRun: {
      adapterName,
      provider: adapterCapabilityPayload?.adapter?.provider ?? 'simulation',
      taskId: claim.taskId,
      runId: claim.runId,
      stage: claim.stage,
      status: resultStatus ?? 'completed',
      summary,
      notes: [
        `simulated-adapter:${adapterName}`,
        `simulated-stage:${claim.stage}`,
        ...options.parseCsvOption(options.notes)
      ],
      artifacts: [
        {
          id: artifactId,
          kind: 'report',
          path: outputPath,
          taskId: claim.taskId
        }
      ],
      errors: []
    }
  };
}

export function runExternalAdapter(
  adapterRuntimePayload: AdapterRuntimeDocument,
  claimPayload: TaskClaimPayload,
  statePath: string,
  taskGraphPath: string,
  options: Record<string, any> = {}
): AdapterRunDocument {
  const adapterRuntime = adapterRuntimePayload.adapterRuntime;
  const templateContext = buildAdapterTemplateContext(claimPayload, statePath, taskGraphPath, {
    ...options,
    adapterRuntimePayload
  });
  const command = expandTemplateValue(adapterRuntime.command, templateContext);
  const args = (adapterRuntime.args ?? []).map((arg) => expandTemplateValue(arg, templateContext));
  const env = {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(adapterRuntime.env ?? {}).map(([key, value]) => [key, expandTemplateValue(value, templateContext)])
    )
  };
  const cwd = adapterRuntime.cwd ? resolveFromCwd(expandTemplateValue(adapterRuntime.cwd, templateContext)) : process.cwd();

  let stdout = '';

  try {
    stdout = execFileSync(command, args, {
      cwd,
      env,
      encoding: 'utf8',
      input: `${JSON.stringify(claimPayload, null, 2)}\n`,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    const commandError = error as { stderr?: { toString(): string }; stdout?: { toString(): string }; message?: string };
    const stderr = commandError.stderr?.toString().trim();
    const stdoutText = commandError.stdout?.toString().trim();
    fail(`adapter command failed: ${stderr || stdoutText || commandError.message}`);
  }

  let adapterOutputPayload: unknown;

  if (adapterRuntime.outputMode === 'stdout') {
    const trimmed = stdout.trim();
    if (!trimmed) {
      fail('adapter command returned empty stdout; expected JSON output');
    }

    try {
      const assistantContent = extractCopilotAssistantContent(trimmed);
      adapterOutputPayload = JSON.parse(extractJsonPayload(assistantContent));
    } catch (error) {
      const parseError = error as { message?: string };
      fail(`adapter stdout is not valid JSON: ${parseError.message ?? 'unknown error'}`);
    }
  } else {
    adapterOutputPayload = readAdapterOutput(adapterRuntime, templateContext);
  }

  return normalizeAdapterRunPayload(adapterOutputPayload, adapterRuntimePayload, claimPayload);
}

export function executeTaskRun(
  statePath: string,
  taskGraphPath: string,
  claimPayload: TaskClaimPayload,
  options: CliOptions,
  dependencies: AdapterRunnerDependencies
): TaskExecutionResult {
  const { validateAdapterRuntimePayload, sanitizeStageName, getRouteNameFromTaskId, parseCsvOption } = dependencies;
  const resolvedOptions = options ?? {};
  const executionStatePayload = readStructuredFile(statePath) as ExecutionStateDocument;
  const taskGraphPayload = readStructuredFile(taskGraphPath) as TaskGraphDocument;
  const adapterCapabilityPayload = loadOptionalStructuredFile<AdapterCapabilityDocument>(
    typeof resolvedOptions['adapter-capability'] === 'string' ? resolvedOptions['adapter-capability'] : undefined
  );
  const adapterRuntimePayload = typeof resolvedOptions['adapter-runtime'] === 'string'
    ? readStructuredFile(resolvedOptions['adapter-runtime']) as AdapterRuntimeDocument
    : null;
  const claim = claimPayload.taskClaim;

  if (!claim) {
    fail('execute-task-run requires a task claim payload');
  }

  const executor = typeof resolvedOptions.executor === 'string' ? resolvedOptions.executor : undefined;
  const workflowStatus: ExecutionStatus | undefined =
    resolvedOptions.status === 'pending' ||
    resolvedOptions.status === 'running' ||
    resolvedOptions.status === 'blocked' ||
    resolvedOptions.status === 'completed' ||
    resolvedOptions.status === 'failed' ||
    resolvedOptions.status === 'cancelled'
      ? resolvedOptions.status
      : undefined;
  const currentStage: TaskStage | undefined =
    resolvedOptions.stage === 'environment-preparation' ||
    resolvedOptions.stage === 'requirements-analysis' ||
    resolvedOptions.stage === 'code-implementation' ||
    resolvedOptions.stage === 'test-design' ||
    resolvedOptions.stage === 'automated-execution' ||
    resolvedOptions.stage === 'defect-feedback' ||
    resolvedOptions.stage === 'collaboration'
      ? resolvedOptions.stage
      : undefined;

  if (adapterRuntimePayload) {
    const adapterRuntimePath = typeof resolvedOptions['adapter-runtime'] === 'string' ? resolvedOptions['adapter-runtime'] : '';
    validateAdapterRuntimePayload(adapterRuntimePayload, adapterRuntimePath);
  }

  const runOutput = adapterRuntimePayload
    ? runExternalAdapter(adapterRuntimePayload, claimPayload, statePath, taskGraphPath, {
        ...resolvedOptions,
        getRouteNameFromTaskId
      })
    : buildSimulatedAdapterOutput(claimPayload, adapterCapabilityPayload, {
        ...resolvedOptions,
        sanitizeStageName,
        getRouteNameFromTaskId,
        parseCsvOption
      });

  const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
    taskId: claim.taskId,
    taskStatus: runOutput.adapterRun.status,
    notes: [`summary:${runOutput.adapterRun.summary}`, ...runOutput.adapterRun.notes],
    artifacts: runOutput.adapterRun.artifacts,
    errors: runOutput.adapterRun.errors,
    ...(executor !== undefined ? { executor } : {}),
    ...(workflowStatus !== undefined ? { workflowStatus } : {}),
    ...(currentStage !== undefined ? { currentStage } : {})
  });

  return {
    adapterRun: runOutput.adapterRun,
    receipt: receipt.taskResult,
    mode: adapterRuntimePayload ? 'external-adapter' : 'simulation'
  };
}