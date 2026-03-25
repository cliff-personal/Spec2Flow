export type PlatformRunStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RunListItem {
  runId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryRootPath: string;
  projectId?: string | null;
  projectName?: string | null;
  workspaceRootPath?: string | null;
  workflowName: string;
  status: PlatformRunStatus;
  currentStage: string | null;
  riskLevel: string | null;
  branchName?: string | null;
  baseBranch?: string | null;
  worktreeMode?: 'managed' | 'none' | null;
  worktreePath?: string | null;
  provisioningStatus?: 'provisioned' | 'skipped' | null;
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProjectListItem {
  projectId: string;
  projectName: string;
  repositoryId: string;
  repositoryName: string;
  repositoryRootPath: string;
  workspaceRootPath: string;
  projectPath?: string | null;
  topologyPath?: string | null;
  riskPath?: string | null;
  defaultBranch?: string | null;
  branchPrefix?: string | null;
  workspacePolicy: {
    allowedReadGlobs: string[];
    allowedWriteGlobs: string[];
    forbiddenWriteGlobs: string[];
  };
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PlatformTaskRecord {
  runId: string;
  taskId: string;
  stage: string;
  title: string;
  goal: string;
  executorType: string;
  status: string;
  dependsOn?: string[];
  targetFiles?: string[];
  verifyCommands?: string[];
  inputs?: Record<string, unknown>;
  riskLevel?: string | null;
  roleProfile?: {
    expectedArtifacts: string[];
  };
  attempts?: number;
  retryCount?: number;
  autoRepairCount?: number;
  leasedByWorkerId?: string | null;
  leaseExpiresAt?: string | null;
  artifactsDir?: string | null;
  updatedAt?: string | null;
}

export interface PlatformArtifactRecord {
  artifactId: string;
  runId: string;
  taskId?: string | null;
  kind: string;
  path: string;
  schemaType?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
}

export interface TaskArtifactCatalogArtifact {
  id: string;
  path: string;
  kind: string;
  category: string;
  contentType?: string;
  storage?: {
    mode: 'local' | 'remote-catalog';
    provider?: string;
    objectKey?: string;
    remoteUrl?: string;
  };
  upload?: {
    status: 'pending' | 'uploaded' | 'skipped' | 'failed';
    uploadedAt?: string;
    httpStatus?: number;
    error?: string;
  };
}

export interface TaskArtifactCatalog {
  runId: string;
  taskId: string;
  artifactId: string;
  path: string;
  catalog: {
    generatedAt?: string;
    taskId: string;
    stage: 'automated-execution';
    summary: string;
    store: {
      mode: 'local' | 'remote-catalog';
      provider?: string;
      publicBaseUrl?: string;
      keyPrefix?: string;
      uploadConfigured?: boolean;
      uploadMethod?: 'PUT' | 'POST';
    };
    artifacts: TaskArtifactCatalogArtifact[];
  };
}

export interface PlatformObservabilityTimelineEntry {
  eventId: string;
  createdAt: string | null;
  taskId?: string | null;
  type: string;
  category: string;
  action: string;
  title: string;
  severity: 'info' | 'warning' | 'error';
  payload: Record<string, unknown>;
}

export interface PlatformTaskObservabilitySummary {
  taskId: string;
  stage: string;
  status: string;
  attempts: number;
  retryCount: number;
  autoRepairCount: number;
  artifactCount: number;
  expectedArtifactCount: number;
  missingExpectedArtifactCount: number;
  latestEventType?: string | null;
  latestEventAt?: string | null;
  latestEventSeverity?: 'info' | 'warning' | 'error' | null;
  recentEvents: PlatformObservabilityTimelineEntry[];
  leasedByWorkerId?: string | null;
  leaseExpiresAt?: string | null;
}

export interface PlatformObservability {
  taxonomyVersion: string;
  metrics: {
    tasks: {
      total: number;
      pending: number;
      ready: number;
      leased: number;
      inProgress: number;
      blocked: number;
      completed: number;
      failed: number;
      skipped: number;
      retryableFailed: number;
      cancelled: number;
    };
    repairs: {
      total: number;
      requested: number;
      succeeded: number;
      failed: number;
      blocked: number;
    };
    publications: {
      total: number;
      published: number;
      approvalRequired: number;
      blocked: number;
    };
    events: {
      recentCount: number;
    };
  };
  attentionRequired: Array<{
    type: string;
    title: string;
    description: string;
  }>;
  timeline: PlatformObservabilityTimelineEntry[];
  taskSummaries: PlatformTaskObservabilitySummary[];
}

export interface RunDetail {
  runState: {
    run: {
      runId: string;
      repositoryId: string;
      workflowName: string;
      status: PlatformRunStatus;
      currentStage: string | null;
      riskLevel: string | null;
    };
    project: {
      projectId: string;
      repositoryId: string;
      name: string;
      repositoryRootPath: string;
      workspaceRootPath: string;
      projectPath?: string | null;
      topologyPath?: string | null;
      riskPath?: string | null;
      defaultBranch?: string | null;
      branchPrefix?: string | null;
      workspacePolicy: {
        allowedReadGlobs: string[];
        allowedWriteGlobs: string[];
        forbiddenWriteGlobs: string[];
      };
    } | null;
    workspace: {
      runId: string;
      projectId: string;
      repositoryId: string;
      worktreeMode: 'managed' | 'none';
      provisioningStatus: 'provisioned' | 'skipped';
      branchName?: string | null;
      baseBranch?: string | null;
      workspaceRootPath: string;
      worktreePath: string;
      workspacePolicy: {
        allowedReadGlobs: string[];
        allowedWriteGlobs: string[];
        forbiddenWriteGlobs: string[];
      };
    } | null;
    tasks: PlatformTaskRecord[];
    recentEvents: Array<{
      eventId: string;
      runId: string;
      taskId?: string | null;
      eventType: string;
      payload: Record<string, unknown>;
      createdAt?: string | null;
    }>;
    artifacts: PlatformArtifactRecord[];
  };
  platformObservability: PlatformObservability;
}

export interface RunSubmissionPayload {
  repositoryRootPath: string;
  projectId?: string;
  projectName?: string;
  workspaceRootPath?: string;
  requirement?: string;
  requirementPath?: string;
  changedFiles?: string[];
  projectPath?: string;
  topologyPath?: string;
  riskPath?: string;
  repositoryId?: string;
  repositoryName?: string;
  defaultBranch?: string;
  runId?: string;
}

export interface ProjectRegistrationPayload {
  repositoryRootPath: string;
  projectId?: string;
  projectName?: string;
  workspaceRootPath?: string;
  projectPath?: string;
  topologyPath?: string;
  riskPath?: string;
  repositoryId?: string;
  repositoryName?: string;
  defaultBranch?: string;
  branchPrefix?: string;
  workspacePolicy?: {
    allowedReadGlobs?: string[];
    allowedWriteGlobs?: string[];
    forbiddenWriteGlobs?: string[];
  };
}

export interface ProjectRegistrationResult {
  schema: string;
  repository: {
    repositoryId: string;
    repositoryName: string;
    repositoryRootPath: string;
    defaultBranch?: string | null;
  };
  project: ProjectListItem;
}

export interface RunSubmissionResult {
  platformRun: {
    schema: string;
    projectId: string;
    projectName: string;
    repositoryId: string;
    repositoryName: string;
    repositoryRootPath: string;
    workspaceRootPath: string;
    runId: string;
    workflowName: string;
    taskCount: number;
    eventCount: number;
    artifactCount: number;
    status: PlatformRunStatus;
    currentStage: string | null;
    riskLevel: string | null;
    branchName?: string | null;
    baseBranch?: string | null;
    worktreeMode: 'managed' | 'none';
    worktreePath: string;
    provisioningStatus: 'provisioned' | 'skipped';
  };
  taskGraph: {
    graphId: string;
    routeSelectionMode: string | null;
    selectedRoutes: string[];
    changedFiles: string[];
    requirementPath: string | null;
  };
  validatorResult: {
    status: 'passed' | 'passed-with-warnings';
    summary: {
      passed: number;
      warnings: number;
      failed: number;
    };
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';

export function getControlPlaneBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_CONTROL_PLANE_BASE_URL?.trim();
  return configuredUrl && configuredUrl.length > 0 ? configuredUrl : DEFAULT_BASE_URL;
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const headers = {
    'content-type': 'application/json',
    ...(init?.headers ? init.headers : {})
  };

  const response = await fetch(`${getControlPlaneBaseUrl()}${pathname}`, {
    headers,
    ...init
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = await response.json() as ApiError;
      message = payload.error.message;
    } catch {
      message = response.statusText || message;
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export async function listRuns(): Promise<RunListItem[]> {
  const payload = await requestJson<{ runs: RunListItem[] }>('/api/runs');
  return payload.runs;
}

export async function listProjects(): Promise<ProjectListItem[]> {
  const payload = await requestJson<{ projects: ProjectListItem[] }>('/api/projects');
  return payload.projects;
}

export async function getRunDetail(runId: string): Promise<RunDetail> {
  const payload = await requestJson<{ run: RunDetail }>(`/api/runs/${encodeURIComponent(runId)}`);
  return payload.run;
}

export async function getRunTasks(runId: string): Promise<PlatformTaskRecord[]> {
  const payload = await requestJson<{ tasks: PlatformTaskRecord[] }>(`/api/runs/${encodeURIComponent(runId)}/tasks`);
  return payload.tasks;
}

export async function getRunObservability(runId: string): Promise<PlatformObservability> {
  const payload = await requestJson<{ platformObservability: PlatformObservability }>(
    `/api/runs/${encodeURIComponent(runId)}/observability`
  );
  return payload.platformObservability;
}

export async function getTaskArtifactCatalog(runId: string, taskId: string): Promise<TaskArtifactCatalog> {
  const payload = await requestJson<{ artifactCatalog: TaskArtifactCatalog }>(
    `/api/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/artifact-catalog`
  );
  return payload.artifactCatalog;
}

export async function submitRun(payload: RunSubmissionPayload): Promise<RunSubmissionResult> {
  const response = await requestJson<{ runSubmission: RunSubmissionResult }>('/api/runs', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return response.runSubmission;
}

export async function registerProject(payload: ProjectRegistrationPayload): Promise<ProjectRegistrationResult> {
  const response = await requestJson<{ projectRegistration: ProjectRegistrationResult }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return response.projectRegistration;
}

export async function postTaskAction(
  taskId: string,
  action: 'retry' | 'approve' | 'reject',
  runId: string,
  note?: string
): Promise<void> {
  await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/actions/${action}`, {
    method: 'POST',
    body: JSON.stringify({
      runId,
      ...(note ? { note } : {})
    })
  });
}
