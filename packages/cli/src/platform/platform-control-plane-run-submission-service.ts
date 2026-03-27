import fs from 'node:fs';
import path from 'node:path';
import { buildValidatorResult } from '../onboarding/validator-service.js';
import { buildTaskGraph } from '../planning/task-graph-service.js';
import {
  attachPlatformProjectContext,
  createPlatformRunInitializationPlan,
  persistPlatformRunPlan
} from './platform-repository.js';
import { resolvePlatformProjectAdapterProfile } from './platform-project-adapter-profile.js';
import { provisionPlatformRunWorkspace } from './platform-run-provisioning-service.js';
import { scaffoldSpec2flowFiles } from '../shared/scaffold-spec2flow.js';
import type {
  PlatformProjectRecord,
  PlatformControlPlaneRunSubmissionRequest,
  PlatformControlPlaneRunSubmissionResult,
  PlatformWorkspacePolicy
} from '../types/index.js';
import { type SqlExecutor } from './platform-database.js';
import { readStructuredFileFrom, writeJson } from '../shared/fs-utils.js';

const DEFAULT_PROJECT_PATH = '.spec2flow/project.yaml';
const DEFAULT_TOPOLOGY_PATH = '.spec2flow/topology.yaml';
const DEFAULT_RISK_PATH = '.spec2flow/policies/risk.yaml';

const defaultRunSubmissionDependencies: SubmitPlatformControlPlaneRunDependencies = {
  buildTaskGraph,
  buildValidatorResult,
  createPlatformRunInitializationPlan,
  persistPlatformRunPlan,
  provisionPlatformRunWorkspace,
  readRequirementFile: defaultReadRequirementFile,
  readStructuredFileFrom,
  writeJson
};

export interface SubmitPlatformControlPlaneRunDependencies {
  buildTaskGraph: typeof buildTaskGraph;
  buildValidatorResult: typeof buildValidatorResult;
  createPlatformRunInitializationPlan: typeof createPlatformRunInitializationPlan;
  persistPlatformRunPlan: typeof persistPlatformRunPlan;
  provisionPlatformRunWorkspace: typeof provisionPlatformRunWorkspace;
  readRequirementFile: (repositoryRoot: string, filePath: string) => string;
  readStructuredFileFrom: typeof readStructuredFileFrom;
  writeJson: typeof writeJson;
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

function normalizeWorkspacePolicy(
  workspacePolicy: PlatformControlPlaneRunSubmissionRequest['workspacePolicy']
): PlatformWorkspacePolicy {
  const normalizeList = (values: string[] | undefined, fallback: string[]): string[] => {
    const normalized = (values ?? fallback)
      .map((value) => value.trim())
      .filter((value, index, entries) => value.length > 0 && entries.indexOf(value) === index);
    return normalized.length > 0 ? normalized : fallback;
  };

  return {
    allowedReadGlobs: normalizeList(workspacePolicy?.allowedReadGlobs, ['**/*']),
    allowedWriteGlobs: normalizeList(workspacePolicy?.allowedWriteGlobs, ['**/*']),
    forbiddenWriteGlobs: normalizeList(workspacePolicy?.forbiddenWriteGlobs, [])
  };
}

function buildTaskGraphArtifactPath(worktreePath: string, runId: string): string {
  return path.resolve(worktreePath, '.spec2flow', 'runtime', 'platform-runs', runId, 'task-graph.json');
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

function readOnboardingPayloads(
  repositoryRoot: string,
  projectPath: string,
  topologyPath: string,
  riskPath: string,
  dependencies: SubmitPlatformControlPlaneRunDependencies
): {
  projectPayload: Parameters<typeof buildValidatorResult>[0];
  topologyPayload: Parameters<typeof buildValidatorResult>[1];
  riskPayload: Parameters<typeof buildValidatorResult>[2];
} {
  return {
    projectPayload: dependencies.readStructuredFileFrom(repositoryRoot, projectPath) as Parameters<typeof buildValidatorResult>[0],
    topologyPayload: dependencies.readStructuredFileFrom(repositoryRoot, topologyPath) as Parameters<typeof buildValidatorResult>[1],
    riskPayload: dependencies.readStructuredFileFrom(repositoryRoot, riskPath) as Parameters<typeof buildValidatorResult>[2]
  };
}

function readRequirementTextOrThrow(
  repositoryRoot: string,
  requirement: string | undefined,
  requirementPath: string | undefined,
  dependencies: SubmitPlatformControlPlaneRunDependencies
): string {
  try {
    return buildRequirementText(repositoryRoot, requirement, requirementPath, dependencies);
  } catch (error) {
    throw toSubmissionError(error, {
      repositoryRootPath: repositoryRoot,
      requirementPath
    });
  }
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
  dependencies: SubmitPlatformControlPlaneRunDependencies = defaultRunSubmissionDependencies,
  storageRoot?: string
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
  const projectId = normalizeString(options.projectId) ?? repositoryId ?? path.basename(repositoryRoot).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
  const projectName = normalizeString(options.projectName) ?? repositoryName ?? path.basename(repositoryRoot);
  const workspaceRootPath = path.resolve(normalizeString(options.workspaceRootPath) ?? repositoryRoot);
  const branchPrefix = normalizeString(options.branchPrefix) ?? 'spec2flow/';
  const worktreeRootPath = normalizeString(options.worktreeRootPath)
    ? path.resolve(workspaceRootPath, normalizeString(options.worktreeRootPath) as string)
    : storageRoot
    ? path.resolve(storageRoot, '.spec2flow', 'runtime', 'worktrees')
    : undefined;
  const worktreeMode = options.worktreeMode ?? 'managed';
  const workspacePolicy = normalizeWorkspacePolicy(options.workspacePolicy);

  let projectPayload: Parameters<typeof buildValidatorResult>[0];
  let topologyPayload: Parameters<typeof buildValidatorResult>[1];
  let riskPayload: Parameters<typeof buildValidatorResult>[2];

  // Ensure scaffold files exist — idempotent, only writes missing files.
  // This covers projects registered before auto-scaffolding was added.
  // Skip when paths are absolute (managed by storageRoot) to avoid touching the target repo.
  if (!storageRoot && !path.isAbsolute(projectPath)) {
    try {
      scaffoldSpec2flowFiles(repositoryRoot, projectName, projectPath, topologyPath, riskPath);
    } catch {
      // Scaffolding is best-effort; don't block run submission if filesystem write fails.
    }
  }

  try {
    ({ projectPayload, topologyPayload, riskPayload } = readOnboardingPayloads(
      repositoryRoot,
      projectPath,
      topologyPath,
      riskPath,
      dependencies
    ));
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

  const requirementText = readRequirementTextOrThrow(
    repositoryRoot,
    options.requirement,
    requirementPath,
    dependencies
  );

  const selectedRoutes = Array.isArray(options.routes) && options.routes.length > 0 ? options.routes : undefined;
  const taskGraph = dependencies.buildTaskGraph(projectPayload, topologyPayload, riskPayload, {
    project: projectPath,
    topology: topologyPath,
    risk: riskPath,
    requirement: requirementPath ?? null
  }, {
    changedFiles,
    requirementText,
    ...(selectedRoutes ? { routes: selectedRoutes } : {})
  });

  let plan = dependencies.createPlatformRunInitializationPlan(taskGraph, {
    repositoryRoot,
    ...(repositoryId ? { repositoryId } : {}),
    ...(repositoryName ? { repositoryName } : {}),
    ...(defaultBranch ? { defaultBranch } : {}),
    ...(runId ? { runId } : {})
  });

  const project: PlatformProjectRecord = {
    projectId,
    repositoryId: plan.repository.repositoryId,
    name: projectName,
    repositoryRootPath: repositoryRoot,
    workspaceRootPath,
    projectPath,
    topologyPath,
    riskPath,
    defaultBranch: defaultBranch ?? plan.repository.defaultBranch ?? (projectPayload as any)?.spec2flow?.project?.defaultBranch ?? 'main',
    branchPrefix,
    adapterProfile: resolvePlatformProjectAdapterProfile({
      repositoryRootPath: repositoryRoot,
      workspaceRootPath,
      ...(options.adapterProfile ? { adapterProfile: options.adapterProfile } : {})
    }),
    workspacePolicy,
    metadata: {
      createdBy: 'submit-platform-run'
    }
  };
  let runWorkspace: ReturnType<SubmitPlatformControlPlaneRunDependencies['provisionPlatformRunWorkspace']>;
  let taskGraphArtifactPath: string;
  try {
    runWorkspace = dependencies.provisionPlatformRunWorkspace({
      runId: plan.run.runId,
      projectId: project.projectId,
      repositoryId: plan.repository.repositoryId,
      repositoryRootPath: repositoryRoot,
      workspaceRootPath,
      defaultBranch: project.defaultBranch ?? 'main',
      branchPrefix,
      ...(worktreeRootPath ? { worktreeRootPath } : {}),
      worktreeMode,
      workspacePolicy
    });
    taskGraphArtifactPath = buildTaskGraphArtifactPath(runWorkspace.worktreePath, plan.run.runId);
    dependencies.writeJson(taskGraphArtifactPath, taskGraph);
  } catch (error) {
    throw toSubmissionError(error, {
      repositoryRootPath: repositoryRoot,
      projectId: project.projectId,
      runId: plan.run.runId
    });
  }

  plan = createPlatformRunInitializationPlan(taskGraph, {
    repositoryRoot,
    repositoryId: plan.repository.repositoryId,
    repositoryName: plan.repository.name,
    ...(plan.repository.defaultBranch ? { defaultBranch: plan.repository.defaultBranch } : {}),
    runId: plan.run.runId,
    ...(plan.run.requestText ? { requestText: plan.run.requestText } : {}),
    taskGraphRef: taskGraphArtifactPath
  });
  plan = attachPlatformProjectContext(plan, {
    project,
    runWorkspace
  });

  await dependencies.persistPlatformRunPlan(executor, schema, plan);

  return {
    platformRun: {
      schema,
      projectId: project.projectId,
      projectName: project.name,
      repositoryId: plan.repository.repositoryId,
      repositoryName: plan.repository.name,
      repositoryRootPath: plan.repository.rootPath,
      workspaceRootPath: project.workspaceRootPath,
      runId: plan.run.runId,
      workflowName: plan.run.workflowName,
      taskCount: plan.tasks.length,
      eventCount: plan.events.length,
      artifactCount: plan.artifacts.length,
      status: plan.run.status,
      currentStage: plan.run.currentStage,
      riskLevel: plan.run.riskLevel,
      branchName: runWorkspace.branchName ?? null,
      baseBranch: runWorkspace.baseBranch ?? null,
      worktreeMode: runWorkspace.worktreeMode,
      worktreePath: runWorkspace.worktreePath,
      provisioningStatus: runWorkspace.provisioningStatus
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
