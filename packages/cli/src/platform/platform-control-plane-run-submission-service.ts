import fs from 'node:fs';
import path from 'node:path';
import { buildValidatorResult } from '../onboarding/validator-service.js';
import { buildTaskGraph } from '../planning/task-graph-service.js';
import { createPlatformRunInitializationPlan, persistPlatformRunPlan } from './platform-repository.js';
import type {
  PlatformControlPlaneRunSubmissionRequest,
  PlatformControlPlaneRunSubmissionResult
} from '../types/index.js';
import { type SqlExecutor } from './platform-database.js';
import { readStructuredFileFrom } from '../shared/fs-utils.js';

const DEFAULT_PROJECT_PATH = '.spec2flow/project.yaml';
const DEFAULT_TOPOLOGY_PATH = '.spec2flow/topology.yaml';
const DEFAULT_RISK_PATH = '.spec2flow/policies/risk.yaml';

const defaultRunSubmissionDependencies: SubmitPlatformControlPlaneRunDependencies = {
  buildTaskGraph,
  buildValidatorResult,
  createPlatformRunInitializationPlan,
  persistPlatformRunPlan,
  readRequirementFile: defaultReadRequirementFile,
  readStructuredFileFrom
};

export interface SubmitPlatformControlPlaneRunDependencies {
  buildTaskGraph: typeof buildTaskGraph;
  buildValidatorResult: typeof buildValidatorResult;
  createPlatformRunInitializationPlan: typeof createPlatformRunInitializationPlan;
  persistPlatformRunPlan: typeof persistPlatformRunPlan;
  readRequirementFile: (repositoryRoot: string, filePath: string) => string;
  readStructuredFileFrom: typeof readStructuredFileFrom;
}

export interface SubmitPlatformControlPlaneRunOptions extends PlatformControlPlaneRunSubmissionRequest {
  schema: string;
}

export class PlatformControlPlaneRunSubmissionError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PlatformControlPlaneRunSubmissionError';
    this.code = code;
    this.statusCode = statusCode;
    if (details) {
      this.details = details;
    }
  }
}

function defaultReadRequirementFile(repositoryRoot: string, filePath: string): string {
  return fs.readFileSync(path.resolve(repositoryRoot, filePath), 'utf8');
}

function normalizeString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeChangedFiles(changedFiles: string[] | undefined): string[] {
  if (!changedFiles) {
    return [];
  }

  return changedFiles
    .map((filePath) => filePath.trim().replaceAll('\\', '/').replace(/^\.\//u, ''))
    .filter((filePath, index, values) => filePath.length > 0 && values.indexOf(filePath) === index);
}

function buildRequirementText(
  repositoryRoot: string,
  requirement: string | undefined,
  requirementPath: string | undefined,
  dependencies: SubmitPlatformControlPlaneRunDependencies
): string {
  const inlineRequirement = normalizeString(requirement) ?? '';
  const fileRequirement = requirementPath
    ? dependencies.readRequirementFile(repositoryRoot, requirementPath).trim()
    : '';

  return [inlineRequirement, fileRequirement].filter(Boolean).join('\n\n').trim();
}

function toSubmissionError(
  error: unknown,
  details: Record<string, unknown>
): PlatformControlPlaneRunSubmissionError {
  if (error instanceof PlatformControlPlaneRunSubmissionError) {
    return error;
  }

  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = JSON.stringify(error);
  }

  return new PlatformControlPlaneRunSubmissionError('invalid-request', message, 400, details);
}

export async function submitPlatformControlPlaneRun(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneRunSubmissionRequest,
  dependencies: SubmitPlatformControlPlaneRunDependencies = defaultRunSubmissionDependencies
): Promise<PlatformControlPlaneRunSubmissionResult> {
  const repositoryRoot = path.resolve(options.repositoryRootPath);
  const projectPath = normalizeString(options.projectPath) ?? DEFAULT_PROJECT_PATH;
  const topologyPath = normalizeString(options.topologyPath) ?? DEFAULT_TOPOLOGY_PATH;
  const riskPath = normalizeString(options.riskPath) ?? DEFAULT_RISK_PATH;
  const requirementPath = normalizeString(options.requirementPath);
  const changedFiles = normalizeChangedFiles(options.changedFiles);
  const repositoryId = normalizeString(options.repositoryId);
  const repositoryName = normalizeString(options.repositoryName);
  const defaultBranch = normalizeString(options.defaultBranch);
  const runId = normalizeString(options.runId);

  let projectPayload: Parameters<typeof buildValidatorResult>[0];
  let topologyPayload: Parameters<typeof buildValidatorResult>[1];
  let riskPayload: Parameters<typeof buildValidatorResult>[2];

  try {
    projectPayload = dependencies.readStructuredFileFrom(repositoryRoot, projectPath) as Parameters<typeof buildValidatorResult>[0];
    topologyPayload = dependencies.readStructuredFileFrom(repositoryRoot, topologyPath) as Parameters<typeof buildValidatorResult>[1];
    riskPayload = dependencies.readStructuredFileFrom(repositoryRoot, riskPath) as Parameters<typeof buildValidatorResult>[2];
  } catch (error) {
    throw toSubmissionError(error, {
      repositoryRootPath: repositoryRoot,
      projectPath,
      topologyPath,
      riskPath
    });
  }

  const validatorResult = dependencies.buildValidatorResult(projectPayload, topologyPayload, riskPayload, {
    project: projectPath,
    topology: topologyPath,
    risk: riskPath
  });

  if (validatorResult.validatorResult.status === 'failed') {
    throw new PlatformControlPlaneRunSubmissionError(
      'onboarding-validation-failed',
      'Cannot submit run because onboarding validation failed',
      422,
      {
        summary: validatorResult.validatorResult.summary,
        projectPath,
        topologyPath,
        riskPath
      }
    );
  }

  let requirementText = '';
  try {
    requirementText = buildRequirementText(repositoryRoot, options.requirement, requirementPath, dependencies);
  } catch (error) {
    throw toSubmissionError(error, {
      repositoryRootPath: repositoryRoot,
      requirementPath
    });
  }

  const taskGraph = dependencies.buildTaskGraph(projectPayload, topologyPayload, riskPayload, {
    project: projectPath,
    topology: topologyPath,
    risk: riskPath,
    requirement: requirementPath ?? null
  }, {
    changedFiles,
    requirementText
  });

  const planOptions = {
    repositoryRoot,
    ...(repositoryId ? { repositoryId } : {}),
    ...(repositoryName ? { repositoryName } : {}),
    ...(defaultBranch ? { defaultBranch } : {}),
    ...(runId ? { runId } : {})
  };
  const plan = dependencies.createPlatformRunInitializationPlan(taskGraph, planOptions);

  await dependencies.persistPlatformRunPlan(executor, schema, plan);

  return {
    platformRun: {
      schema,
      repositoryId: plan.repository.repositoryId,
      repositoryName: plan.repository.name,
      repositoryRootPath: plan.repository.rootPath,
      runId: plan.run.runId,
      workflowName: plan.run.workflowName,
      taskCount: plan.tasks.length,
      eventCount: plan.events.length,
      artifactCount: plan.artifacts.length,
      status: plan.run.status,
      currentStage: plan.run.currentStage,
      riskLevel: plan.run.riskLevel
    },
    taskGraph: {
      graphId: taskGraph.taskGraph.id,
      routeSelectionMode: taskGraph.taskGraph.source?.routeSelectionMode ?? null,
      selectedRoutes: taskGraph.taskGraph.source?.selectedRoutes ?? [],
      changedFiles,
      requirementPath: requirementPath ?? null
    },
    validatorResult: {
      status: validatorResult.validatorResult.status,
      summary: validatorResult.validatorResult.summary
    }
  };
}