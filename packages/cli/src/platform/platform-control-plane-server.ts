import fs from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type {
  PlatformControlPlaneProjectListDocument,
  PlatformControlPlaneProjectListItem,
  PlatformControlPlaneProjectRegistrationDocument,
  PlatformControlPlaneProjectRegistrationRequest,
  PlatformControlPlaneProjectRegistrationResult,
  PlatformControlPlaneTaskArtifactCatalog,
  PlatformControlPlaneRunActionDocument,
  PlatformControlPlaneRunActionResult,
  PlatformControlPlaneTaskActionDocument,
  PlatformControlPlaneTaskActionResult,
  PlatformControlPlaneErrorDocument,
  PlatformControlPlaneRunDetail,
  PlatformControlPlaneRunListDocument,
  PlatformControlPlaneRunListItem,
  PlatformControlPlaneRunSubmissionDocument,
  PlatformControlPlaneRunSubmissionRequest,
  PlatformControlPlaneRunSubmissionResult,
  PlatformControlPlaneTaskList,
  PlatformObservabilityReadModel,
  PlatformRunStatus
} from '../types/index.js';
import { PlatformControlPlaneActionError } from './platform-control-plane-action-service.js';
import { PlatformControlPlaneRunSubmissionError } from './platform-control-plane-run-submission-service.js';
import { PlatformProjectRegistrationError } from './platform-project-service.js';

export interface StartPlatformControlPlaneServerOptions {
  host?: string;
  port: number;
  eventLimit: number;
  listPlatformRuns: (options: {
    limit: number;
    repositoryId?: string;
    status?: PlatformRunStatus;
  }) => Promise<PlatformControlPlaneRunListItem[]>;
  listPlatformProjects: (options: {
    limit: number;
    repositoryId?: string;
  }) => Promise<PlatformControlPlaneProjectListItem[]>;
  getPlatformControlPlaneRunDetail: (options: {
    runId: string;
    eventLimit: number;
  }) => Promise<PlatformControlPlaneRunDetail | null>;
  getPlatformControlPlaneRunTasks: (options: {
    runId: string;
    eventLimit: number;
  }) => Promise<PlatformControlPlaneTaskList['tasks'] | null>;
  getPlatformControlPlaneRunObservability: (options: {
    runId: string;
    eventLimit: number;
  }) => Promise<PlatformObservabilityReadModel | null>;
  getPlatformControlPlaneTaskArtifactCatalog: (options: {
    runId: string;
    taskId: string;
    eventLimit: number;
  }) => Promise<PlatformControlPlaneTaskArtifactCatalog | null>;
  getPlatformControlPlaneLocalArtifactContent: (options: {
    objectKey: string;
  }) => Promise<{
    objectKey: string;
    artifactId: string;
    runId: string;
    taskId: string;
    localPath: string;
    contentType: string;
  } | null>;
  registerPlatformProject: (
    options: PlatformControlPlaneProjectRegistrationRequest
  ) => Promise<PlatformControlPlaneProjectRegistrationResult>;
  submitPlatformRun: (options: PlatformControlPlaneRunSubmissionRequest) => Promise<PlatformControlPlaneRunSubmissionResult>;
  retryPlatformTask: (options: {
    runId: string;
    taskId: string;
    actor?: string;
    note?: string;
  }) => Promise<PlatformControlPlaneTaskActionResult | null>;
  approvePlatformTask: (options: {
    runId: string;
    taskId: string;
    actor?: string;
    note?: string;
  }) => Promise<PlatformControlPlaneTaskActionResult | null>;
  rejectPlatformTask: (options: {
    runId: string;
    taskId: string;
    actor?: string;
    note?: string;
  }) => Promise<PlatformControlPlaneTaskActionResult | null>;
  pausePlatformRun: (options: {
    runId: string;
    actor?: string;
    note?: string;
  }) => Promise<PlatformControlPlaneRunActionResult | null>;
  resumePlatformRun: (options: {
    runId: string;
    actor?: string;
    note?: string;
  }) => Promise<PlatformControlPlaneRunActionResult | null>;
}

export interface StartedPlatformControlPlaneServer {
  host: string;
  port: number;
  close: () => Promise<void>;
}

const RUN_DETAIL_ROUTE = /^\/api\/runs\/([^/]+)$/u;
const PROJECT_LIST_ROUTE = '/api/projects';
const RUN_TASKS_ROUTE = /^\/api\/runs\/([^/]+)\/tasks$/u;
const RUN_TASK_ARTIFACT_CATALOG_ROUTE = /^\/api\/runs\/([^/]+)\/tasks\/([^/]+)\/artifact-catalog$/u;
const RUN_OBSERVABILITY_ROUTE = /^\/api\/runs\/([^/]+)\/observability$/u;
const RUN_ACTION_ROUTE = /^\/api\/runs\/([^/]+)\/actions\/(pause|resume)$/u;
const TASK_ACTION_ROUTE = /^\/api\/tasks\/([^/]+)\/actions\/(retry|approve|reject)$/u;
const LOCAL_ARTIFACT_ROUTE_PREFIX = '/artifacts/';

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): void {
  const payload: PlatformControlPlaneErrorDocument = {
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  };

  writeJson(response, statusCode, payload);
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function normalizeRunStatus(value: string | null): PlatformRunStatus | null {
  switch (value) {
    case 'pending':
    case 'running':
    case 'blocked':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return value;
    default:
      return null;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (rawBody.length === 0) {
    return null;
  }

  return JSON.parse(rawBody) as unknown;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseTaskActionBody(body: unknown): {
  runId: string;
  actor?: string;
  note?: string;
} {
  const record = asObjectRecord(body);
  const runId = typeof record?.runId === 'string' && record.runId.trim().length > 0
    ? record.runId.trim()
    : null;

  if (!runId) {
    throw new PlatformControlPlaneActionError(
      'invalid-request',
      'Task action request body must include a non-empty runId',
      400
    );
  }

  const actor = typeof record?.actor === 'string' && record.actor.trim().length > 0
    ? record.actor.trim()
    : null;
  const note = typeof record?.note === 'string' && record.note.trim().length > 0
    ? record.note.trim()
    : null;

  return {
    runId,
    ...(actor ? { actor } : {}),
    ...(note ? { note } : {})
  };
}

function parseRunActionBody(body: unknown): {
  actor?: string;
  note?: string;
} {
  const record = asObjectRecord(body);
  const actor = typeof record?.actor === 'string' && record.actor.trim().length > 0
    ? record.actor.trim()
    : null;
  const note = typeof record?.note === 'string' && record.note.trim().length > 0
    ? record.note.trim()
    : null;

  return {
    ...(actor ? { actor } : {}),
    ...(note ? { note } : {})
  };
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function parseChangedFiles(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new PlatformControlPlaneRunSubmissionError(
      'invalid-request',
      'Run submission changedFiles must be an array of strings',
      400
    );
  }

  return value;
}

function parseOptionalStringArray(
  value: unknown,
  createError: (message: string) => Error = (message) => new PlatformControlPlaneRunSubmissionError(
    'invalid-request',
    message,
    400
  )
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw createError('Workspace policy arrays must contain only strings');
  }

  return value;
}

function parseRunSubmissionBody(body: unknown): PlatformControlPlaneRunSubmissionRequest {
  const record = asObjectRecord(body);
  const repositoryRootPath = parseOptionalString(record?.repositoryRootPath);

  if (!repositoryRootPath) {
    throw new PlatformControlPlaneRunSubmissionError(
      'invalid-request',
      'Run submission request body must include a non-empty repositoryRootPath',
      400
    );
  }

  const projectPath = parseOptionalString(record?.projectPath);
  const projectId = parseOptionalString(record?.projectId);
  const projectName = parseOptionalString(record?.projectName);
  const topologyPath = parseOptionalString(record?.topologyPath);
  const riskPath = parseOptionalString(record?.riskPath);
  const workspaceRootPath = parseOptionalString(record?.workspaceRootPath);
  const branchPrefix = parseOptionalString(record?.branchPrefix);
  const worktreeRootPath = parseOptionalString(record?.worktreeRootPath);
  const worktreeMode = record?.worktreeMode === 'none' || record?.worktreeMode === 'managed'
    ? record.worktreeMode
    : undefined;
  const requirement = parseOptionalString(record?.requirement);
  const requirementPath = parseOptionalString(record?.requirementPath);
  const changedFiles = parseChangedFiles(record?.changedFiles);
  const repositoryId = parseOptionalString(record?.repositoryId);
  const repositoryName = parseOptionalString(record?.repositoryName);
  const defaultBranch = parseOptionalString(record?.defaultBranch);
  const runId = parseOptionalString(record?.runId);
  const workspacePolicyRecord = asObjectRecord(record?.workspacePolicy);
  const allowedReadGlobs = workspacePolicyRecord ? parseOptionalStringArray(workspacePolicyRecord.allowedReadGlobs) : undefined;
  const allowedWriteGlobs = workspacePolicyRecord ? parseOptionalStringArray(workspacePolicyRecord.allowedWriteGlobs) : undefined;
  const forbiddenWriteGlobs = workspacePolicyRecord ? parseOptionalStringArray(workspacePolicyRecord.forbiddenWriteGlobs) : undefined;
  const workspacePolicy = workspacePolicyRecord
    ? {
        ...(allowedReadGlobs ? { allowedReadGlobs } : {}),
        ...(allowedWriteGlobs ? { allowedWriteGlobs } : {}),
        ...(forbiddenWriteGlobs ? { forbiddenWriteGlobs } : {})
      }
    : undefined;

  return {
    repositoryRootPath,
    ...(projectId ? { projectId } : {}),
    ...(projectName ? { projectName } : {}),
    ...(projectPath ? { projectPath } : {}),
    ...(topologyPath ? { topologyPath } : {}),
    ...(riskPath ? { riskPath } : {}),
    ...(workspaceRootPath ? { workspaceRootPath } : {}),
    ...(branchPrefix ? { branchPrefix } : {}),
    ...(worktreeRootPath ? { worktreeRootPath } : {}),
    ...(worktreeMode ? { worktreeMode } : {}),
    ...(workspacePolicy ? { workspacePolicy } : {}),
    ...(requirement ? { requirement } : {}),
    ...(requirementPath ? { requirementPath } : {}),
    ...(changedFiles ? { changedFiles } : {}),
    ...(repositoryId ? { repositoryId } : {}),
    ...(repositoryName ? { repositoryName } : {}),
    ...(defaultBranch ? { defaultBranch } : {}),
    ...(runId ? { runId } : {})
  };
}

function parseProjectRegistrationBody(body: unknown): PlatformControlPlaneProjectRegistrationRequest {
  const record = asObjectRecord(body);
  const repositoryRootPath = parseOptionalString(record?.repositoryRootPath);

  if (!repositoryRootPath) {
    throw new PlatformProjectRegistrationError(
      'invalid-request',
      'Project registration request body must include a non-empty repositoryRootPath',
      400
    );
  }

  const projectId = parseOptionalString(record?.projectId);
  const projectName = parseOptionalString(record?.projectName);
  const workspaceRootPath = parseOptionalString(record?.workspaceRootPath);
  const projectPath = parseOptionalString(record?.projectPath);
  const topologyPath = parseOptionalString(record?.topologyPath);
  const riskPath = parseOptionalString(record?.riskPath);
  const repositoryId = parseOptionalString(record?.repositoryId);
  const repositoryName = parseOptionalString(record?.repositoryName);
  const defaultBranch = parseOptionalString(record?.defaultBranch);
  const branchPrefix = parseOptionalString(record?.branchPrefix);
  const workspacePolicyRecord = asObjectRecord(record?.workspacePolicy);
  const allowedReadGlobs = workspacePolicyRecord
    ? parseOptionalStringArray(
        workspacePolicyRecord.allowedReadGlobs,
        (message) => new PlatformProjectRegistrationError('invalid-request', message, 400)
      )
    : undefined;
  const allowedWriteGlobs = workspacePolicyRecord
    ? parseOptionalStringArray(
        workspacePolicyRecord.allowedWriteGlobs,
        (message) => new PlatformProjectRegistrationError('invalid-request', message, 400)
      )
    : undefined;
  const forbiddenWriteGlobs = workspacePolicyRecord
    ? parseOptionalStringArray(
        workspacePolicyRecord.forbiddenWriteGlobs,
        (message) => new PlatformProjectRegistrationError('invalid-request', message, 400)
      )
    : undefined;
  const workspacePolicy = workspacePolicyRecord
    ? {
        ...(allowedReadGlobs ? { allowedReadGlobs } : {}),
        ...(allowedWriteGlobs ? { allowedWriteGlobs } : {}),
        ...(forbiddenWriteGlobs ? { forbiddenWriteGlobs } : {})
      }
    : undefined;

  return {
    repositoryRootPath,
    ...(projectId ? { projectId } : {}),
    ...(projectName ? { projectName } : {}),
    ...(workspaceRootPath ? { workspaceRootPath } : {}),
    ...(projectPath ? { projectPath } : {}),
    ...(topologyPath ? { topologyPath } : {}),
    ...(riskPath ? { riskPath } : {}),
    ...(repositoryId ? { repositoryId } : {}),
    ...(repositoryName ? { repositoryName } : {}),
    ...(defaultBranch ? { defaultBranch } : {}),
    ...(branchPrefix ? { branchPrefix } : {}),
    ...(workspacePolicy ? { workspacePolicy } : {})
  };
}

async function handleRunListRequest(
  response: ServerResponse,
  url: URL,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  if (url.pathname !== '/api/runs') {
    return false;
  }

  const runListRequest: {
    limit: number;
    repositoryId?: string;
    status?: PlatformRunStatus;
  } = {
    limit: parsePositiveInteger(url.searchParams.get('limit'), 25)
  };
  const repositoryId = url.searchParams.get('repositoryId');
  const status = normalizeRunStatus(url.searchParams.get('status'));

  if (repositoryId) {
    runListRequest.repositoryId = repositoryId;
  }

  if (status) {
    runListRequest.status = status;
  }

  const runs: PlatformControlPlaneRunListDocument = {
    runs: await options.listPlatformRuns(runListRequest)
  };
  writeJson(response, 200, runs);
  return true;
}

async function handleProjectListRequest(
  response: ServerResponse,
  url: URL,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  if (url.pathname !== PROJECT_LIST_ROUTE) {
    return false;
  }

  const repositoryId = url.searchParams.get('repositoryId');
  const projects: PlatformControlPlaneProjectListDocument = {
    projects: await options.listPlatformProjects({
      limit: parsePositiveInteger(url.searchParams.get('limit'), 50),
      ...(repositoryId ? { repositoryId } : {})
    })
  };
  writeJson(response, 200, projects);
  return true;
}

async function handleRunSubmissionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  if (pathname !== '/api/runs') {
    return false;
  }

  const runSubmissionRequest = parseRunSubmissionBody(await readJsonBody(request));
  const runSubmission: PlatformControlPlaneRunSubmissionDocument = {
    runSubmission: await options.submitPlatformRun(runSubmissionRequest)
  };
  writeJson(response, 201, runSubmission);
  return true;
}

async function handleProjectRegistrationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  if (pathname !== PROJECT_LIST_ROUTE) {
    return false;
  }

  const projectRegistrationRequest = parseProjectRegistrationBody(await readJsonBody(request));
  const projectRegistration: PlatformControlPlaneProjectRegistrationDocument = {
    projectRegistration: await options.registerPlatformProject(projectRegistrationRequest)
  };
  writeJson(response, 201, projectRegistration);
  return true;
}

async function handleRunDetailRequest(
  response: ServerResponse,
  pathname: string,
  eventLimit: number,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  const match = RUN_DETAIL_ROUTE.exec(pathname);
  if (!match) {
    return false;
  }

  const runIdParam = match[1];
  if (!runIdParam) {
    return false;
  }

  const runId = decodeURIComponent(runIdParam);
  const run = await options.getPlatformControlPlaneRunDetail({ runId, eventLimit });
  if (!run) {
    writeError(response, 404, 'run-not-found', `Unknown run: ${runId}`);
    return true;
  }

  writeJson(response, 200, { run });
  return true;
}

async function handleRunTasksRequest(
  response: ServerResponse,
  pathname: string,
  eventLimit: number,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  const match = RUN_TASKS_ROUTE.exec(pathname);
  if (!match) {
    return false;
  }

  const runIdParam = match[1];
  if (!runIdParam) {
    return false;
  }

  const runId = decodeURIComponent(runIdParam);
  const tasks = await options.getPlatformControlPlaneRunTasks({ runId, eventLimit });
  if (!tasks) {
    writeError(response, 404, 'run-not-found', `Unknown run: ${runId}`);
    return true;
  }

  writeJson(response, 200, { tasks });
  return true;
}

async function handleRunObservabilityRequest(
  response: ServerResponse,
  pathname: string,
  eventLimit: number,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  const match = RUN_OBSERVABILITY_ROUTE.exec(pathname);
  if (!match) {
    return false;
  }

  const runIdParam = match[1];
  if (!runIdParam) {
    return false;
  }

  const runId = decodeURIComponent(runIdParam);
  const platformObservability = await options.getPlatformControlPlaneRunObservability({ runId, eventLimit });
  if (!platformObservability) {
    writeError(response, 404, 'run-not-found', `Unknown run: ${runId}`);
    return true;
  }

  writeJson(response, 200, { platformObservability });
  return true;
}

async function handleRunTaskArtifactCatalogRequest(
  response: ServerResponse,
  pathname: string,
  eventLimit: number,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  const match = RUN_TASK_ARTIFACT_CATALOG_ROUTE.exec(pathname);
  if (!match) {
    return false;
  }

  const runIdParam = match[1];
  const taskIdParam = match[2];
  if (!runIdParam || !taskIdParam) {
    return false;
  }

  const runId = decodeURIComponent(runIdParam);
  const taskId = decodeURIComponent(taskIdParam);
  const artifactCatalog = await options.getPlatformControlPlaneTaskArtifactCatalog({ runId, taskId, eventLimit });
  if (!artifactCatalog) {
    writeError(response, 404, 'artifact-catalog-not-found', `No execution artifact catalog for task ${taskId} in run ${runId}`);
    return true;
  }

  writeJson(response, 200, { artifactCatalog });
  return true;
}

async function handleLocalArtifactRequest(
  response: ServerResponse,
  pathname: string,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  if (!pathname.startsWith(LOCAL_ARTIFACT_ROUTE_PREFIX)) {
    return false;
  }

  const objectKeyParam = pathname.slice(LOCAL_ARTIFACT_ROUTE_PREFIX.length);
  if (objectKeyParam.length === 0) {
    writeError(response, 404, 'artifact-not-found', 'Missing artifact object key');
    return true;
  }

  const objectKey = decodeURIComponent(objectKeyParam);
  const artifact = await options.getPlatformControlPlaneLocalArtifactContent({ objectKey });
  if (!artifact) {
    writeError(response, 404, 'artifact-not-found', `Unknown artifact object key: ${objectKey}`, { objectKey });
    return true;
  }

  const content = await fs.promises.readFile(artifact.localPath);
  response.statusCode = 200;
  response.setHeader('content-type', artifact.contentType);
  response.setHeader('content-length', content.byteLength);
  response.end(content);
  return true;
}

async function handleRunActionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  const match = RUN_ACTION_ROUTE.exec(pathname);
  if (!match) {
    return false;
  }

  const runIdParam = match[1];
  const action = match[2];
  if (!runIdParam || !action) {
    return false;
  }

  const runId = decodeURIComponent(runIdParam);
  const actionRequest = parseRunActionBody(await readJsonBody(request));
  const actionResult = action === 'pause'
    ? await options.pausePlatformRun({ runId, ...actionRequest })
    : await options.resumePlatformRun({ runId, ...actionRequest });

  if (!actionResult) {
    writeError(response, 404, 'run-not-found', `Unknown run: ${runId}`, {
      runId,
      action
    });
    return true;
  }

  const actionDocument: PlatformControlPlaneRunActionDocument = {
    action: actionResult
  };
  writeJson(response, 200, actionDocument);
  return true;
}

async function executeTaskAction(
  action: 'retry' | 'approve' | 'reject',
  taskId: string,
  actionRequest: ReturnType<typeof parseTaskActionBody>,
  options: StartPlatformControlPlaneServerOptions
): Promise<PlatformControlPlaneTaskActionResult | null> {
  const request = {
    runId: actionRequest.runId,
    taskId,
    ...(actionRequest.actor ? { actor: actionRequest.actor } : {}),
    ...(actionRequest.note ? { note: actionRequest.note } : {})
  };

  if (action === 'retry') {
    return options.retryPlatformTask(request);
  }

  if (action === 'approve') {
    return options.approvePlatformTask(request);
  }

  return options.rejectPlatformTask(request);
}

async function handleTaskActionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  const match = TASK_ACTION_ROUTE.exec(pathname);
  if (!match) {
    return false;
  }

  const taskIdParam = match[1];
  const action = match[2];
  if (!taskIdParam || !action) {
    return false;
  }

  const taskId = decodeURIComponent(taskIdParam);
  const actionRequest = parseTaskActionBody(await readJsonBody(request));
  const actionResult = await executeTaskAction(action as 'retry' | 'approve' | 'reject', taskId, actionRequest, options);

  if (!actionResult) {
    writeError(response, 404, 'task-not-found', `Unknown task: ${taskId}`, {
      runId: actionRequest.runId,
      taskId,
      action
    });
    return true;
  }

  const actionDocument: PlatformControlPlaneTaskActionDocument = {
    action: actionResult
  };
  writeJson(response, 200, actionDocument);
  return true;
}

async function handleGetRequest(
  response: ServerResponse,
  url: URL,
  pathname: string,
  eventLimit: number,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  if (pathname === '/healthz') {
    writeJson(response, 200, { status: 'ok' });
    return true;
  }

  if (await handleRunListRequest(response, url, options)) {
    return true;
  }

  if (await handleProjectListRequest(response, url, options)) {
    return true;
  }

  if (await handleLocalArtifactRequest(response, pathname, options)) {
    return true;
  }

  if (await handleRunDetailRequest(response, pathname, eventLimit, options)) {
    return true;
  }

  if (await handleRunTasksRequest(response, pathname, eventLimit, options)) {
    return true;
  }

  if (await handleRunTaskArtifactCatalogRequest(response, pathname, eventLimit, options)) {
    return true;
  }

  return handleRunObservabilityRequest(response, pathname, eventLimit, options);
}

async function handlePostRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: StartPlatformControlPlaneServerOptions
): Promise<boolean> {
  if (await handleRunSubmissionRequest(request, response, pathname, options)) {
    return true;
  }

  if (await handleProjectRegistrationRequest(request, response, pathname, options)) {
    return true;
  }

  if (await handleRunActionRequest(request, response, pathname, options)) {
    return true;
  }

  return handleTaskActionRequest(request, response, pathname, options);
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: StartPlatformControlPlaneServerOptions
): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  const eventLimit = parsePositiveInteger(url.searchParams.get('eventLimit'), options.eventLimit);

  if (method === 'GET' && await handleGetRequest(response, url, pathname, eventLimit, options)) {
    return;
  }

  if (method === 'POST' && await handlePostRequest(request, response, pathname, options)) {
    return;
  }

  writeError(response, 404, 'not-found', `Unknown route: ${method} ${pathname}`);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function startPlatformControlPlaneServer(
  options: StartPlatformControlPlaneServerOptions
): Promise<StartedPlatformControlPlaneServer> {
  const host = options.host ?? '127.0.0.1';
  const server = createServer((request, response) => {
    void handleRequest(request, response, options).catch((error) => {
      if (
        error instanceof PlatformControlPlaneActionError
        || error instanceof PlatformControlPlaneRunSubmissionError
        || error instanceof PlatformProjectRegistrationError
      ) {
        writeError(response, error.statusCode, error.code, error.message, error.details);
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      writeError(response, 500, 'internal-error', message);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve control-plane server address');
  }

  return {
    host,
    port: address.port,
    close: async () => closeServer(server)
  };
}
