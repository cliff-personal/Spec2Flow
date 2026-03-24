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
  workflowName: string;
  status: PlatformRunStatus;
  currentStage: string | null;
  riskLevel: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
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
  };
  platformObservability: PlatformObservability;
}

export interface RunSubmissionPayload {
  repositoryRootPath: string;
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

export interface RunSubmissionResult {
  platformRun: {
    schema: string;
    repositoryId: string;
    repositoryName: string;
    repositoryRootPath: string;
    runId: string;
    workflowName: string;
    taskCount: number;
    eventCount: number;
    artifactCount: number;
    status: PlatformRunStatus;
    currentStage: string | null;
    riskLevel: string | null;
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

function getBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_CONTROL_PLANE_BASE_URL?.trim();
  return configuredUrl && configuredUrl.length > 0 ? configuredUrl : DEFAULT_BASE_URL;
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const headers = {
    'content-type': 'application/json',
    ...(init?.headers ? init.headers : {})
  };

  const response = await fetch(`${getBaseUrl()}${pathname}`, {
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

export async function submitRun(payload: RunSubmissionPayload): Promise<RunSubmissionResult> {
  const response = await requestJson<{ runSubmission: RunSubmissionResult }>('/api/runs', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return response.runSubmission;
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