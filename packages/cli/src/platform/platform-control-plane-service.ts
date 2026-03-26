import fs from 'node:fs';
import path from 'node:path';
import { buildPlatformObservabilityReadModel } from './platform-observability-service.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import { DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT, getPlatformRunState } from './platform-scheduler-service.js';
import { readStructuredFileFrom, resolveFromBaseDir } from '../shared/fs-utils.js';
import { getSchemaValidators } from '../shared/schema-registry.js';
import type {
  PlatformControlPlaneTaskArtifactCatalog,
  PlatformControlPlaneRunDetail,
  PlatformControlPlaneRunListItem,
  PlatformObservabilityReadModel,
  PlatformRunStateSnapshot,
  PlatformRunStatus,
  PlatformTaskRecord
} from '../types/index.js';
import type { RiskLevel, TaskStage } from '../types/task-graph.js';

type TimestampValue = Date | string | null;

interface PlatformControlPlaneRunRow extends Record<string, unknown> {
  run_id: string;
  repository_id: string;
  repository_name: string;
  repository_root_path: string;
  project_id: string | null;
  project_name: string | null;
  workspace_root_path: string | null;
  workflow_name: string;
  request_text: string | null;
  status: PlatformRunStatus;
  metadata: Record<string, unknown> | null;
  current_stage: TaskStage | null;
  reroute_target_stage: TaskStage | null;
  risk_level: RiskLevel | null;
  branch_name: string | null;
  base_branch: string | null;
  worktree_mode: 'managed' | 'none' | null;
  worktree_path: string | null;
  provisioning_status: 'provisioned' | 'skipped' | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
  started_at: TimestampValue;
  completed_at: TimestampValue;
}

interface PlatformControlPlaneArtifactCatalogRow extends Record<string, unknown> {
  run_id: string;
  task_id: string | null;
  artifact_id: string;
  path: string;
  root_path: string;
}

interface PlatformControlPlaneArtifactContentRow extends Record<string, unknown> {
  run_id: string;
  task_id: string | null;
  artifact_id: string;
  path: string;
  root_path: string;
}

export interface ListPlatformRunsOptions {
  limit?: number;
  repositoryId?: string;
  status?: PlatformRunStatus;
}

export interface GetPlatformControlPlaneRunOptions {
  runId: string;
  eventLimit?: number;
}

export interface PlatformControlPlaneLocalArtifactContent {
  objectKey: string;
  artifactId: string;
  runId: string;
  taskId: string;
  localPath: string;
  contentType: string;
}

export interface PlatformControlPlaneArtifactContent {
  artifactId: string;
  runId: string;
  taskId: string | null;
  localPath: string;
  contentType: string;
}

function normalizeTimestamp(value: TimestampValue | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function isRunPaused(metadata: Record<string, unknown> | null | undefined): boolean {
  const controlPlane = metadata?.controlPlane;
  if (!controlPlane || typeof controlPlane !== 'object' || Array.isArray(controlPlane)) {
    return false;
  }

  return (controlPlane as Record<string, unknown>).paused === true;
}

function mapRunRow(row: PlatformControlPlaneRunRow): PlatformControlPlaneRunListItem {
  return {
    runId: row.run_id,
    repositoryId: row.repository_id,
    repositoryName: row.repository_name,
    repositoryRootPath: row.repository_root_path,
    projectId: row.project_id,
    projectName: row.project_name,
    workspaceRootPath: row.workspace_root_path,
    workflowName: row.workflow_name,
    ...(row.request_text ? { requirement: row.request_text } : {}),
    status: row.status,
    paused: isRunPaused(row.metadata),
    currentStage: row.current_stage,
    rerouteTargetStage: row.reroute_target_stage,
    riskLevel: row.risk_level,
    branchName: row.branch_name,
    baseBranch: row.base_branch,
    worktreeMode: row.worktree_mode,
    worktreePath: row.worktree_path,
    provisioningStatus: row.provisioning_status,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    startedAt: normalizeTimestamp(row.started_at),
    completedAt: normalizeTimestamp(row.completed_at)
  };
}

async function loadRunSnapshot(
  executor: SqlExecutor,
  schema: string,
  options: GetPlatformControlPlaneRunOptions
): Promise<PlatformRunStateSnapshot | null> {
  const snapshot = await getPlatformRunState(executor, schema, {
    runId: options.runId,
    eventLimit: options.eventLimit ?? DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT
  });

  return snapshot.run ? snapshot : null;
}

async function loadRepositoryRootPath(
  executor: SqlExecutor,
  schema: string,
  runId: string
): Promise<string | null> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<{ root_path: string }>(
    `
      SELECT repositories.root_path
      FROM ${quotedSchema}.runs AS runs
      INNER JOIN ${quotedSchema}.repositories AS repositories
        ON repositories.repository_id = runs.repository_id
      WHERE runs.run_id = $1
      LIMIT 1
    `,
    [runId]
  );

  return result.rows[0]?.root_path ?? null;
}

export async function listPlatformRuns(
  executor: SqlExecutor,
  schema: string,
  options: ListPlatformRunsOptions = {}
): Promise<PlatformControlPlaneRunListItem[]> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const whereClauses: string[] = [];
  const values: unknown[] = [];

  if (options.repositoryId) {
    values.push(options.repositoryId);
    whereClauses.push(`runs.repository_id = $${values.length}`);
  }

  if (options.status) {
    values.push(options.status);
    whereClauses.push(`runs.status = $${values.length}`);
  }

  const limit = options.limit ?? 25;
  values.push(limit);
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const result = await executor.query<PlatformControlPlaneRunRow>(
    `
      SELECT
        runs.run_id,
        runs.repository_id,
        repositories.name AS repository_name,
        repositories.root_path AS repository_root_path,
        projects.project_id,
        projects.name AS project_name,
        run_workspaces.workspace_root_path,
        runs.workflow_name,
        runs.request_text,
        runs.status,
        runs.metadata,
        runs.current_stage,
        reroute.requested_repair_target_stage AS reroute_target_stage,
        runs.risk_level,
        run_workspaces.branch_name,
        run_workspaces.base_branch,
        run_workspaces.worktree_mode,
        run_workspaces.worktree_path,
        run_workspaces.provisioning_status,
        runs.created_at,
        runs.updated_at,
        runs.started_at,
        runs.completed_at
      FROM ${quotedSchema}.runs AS runs
      INNER JOIN ${quotedSchema}.repositories AS repositories
        ON repositories.repository_id = runs.repository_id
      LEFT JOIN ${quotedSchema}.run_workspaces AS run_workspaces
        ON run_workspaces.run_id = runs.run_id
      LEFT JOIN ${quotedSchema}.projects AS projects
        ON projects.project_id = run_workspaces.project_id
      LEFT JOIN LATERAL (
        SELECT tasks.requested_repair_target_stage
        FROM ${quotedSchema}.tasks AS tasks
        WHERE tasks.run_id = runs.run_id
          AND tasks.evaluation_decision = 'needs-repair'
          AND tasks.requested_repair_target_stage IS NOT NULL
        ORDER BY tasks.updated_at DESC, tasks.task_id DESC
        LIMIT 1
      ) AS reroute
        ON TRUE
      ${whereSql}
      ORDER BY runs.created_at DESC, runs.run_id DESC
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map(mapRunRow);
}

export async function getPlatformControlPlaneRunDetail(
  executor: SqlExecutor,
  schema: string,
  options: GetPlatformControlPlaneRunOptions
): Promise<PlatformControlPlaneRunDetail | null> {
  const snapshot = await loadRunSnapshot(executor, schema, options);
  if (!snapshot) {
    return null;
  }

  return {
    runState: snapshot,
    platformObservability: buildPlatformObservabilityReadModel(snapshot)
  };
}

export async function getPlatformControlPlaneRunTasks(
  executor: SqlExecutor,
  schema: string,
  options: GetPlatformControlPlaneRunOptions
): Promise<PlatformTaskRecord[] | null> {
  const snapshot = await loadRunSnapshot(executor, schema, options);
  if (!snapshot) {
    return null;
  }

  return snapshot.tasks;
}

export async function getPlatformControlPlaneRunObservability(
  executor: SqlExecutor,
  schema: string,
  options: GetPlatformControlPlaneRunOptions
): Promise<PlatformObservabilityReadModel | null> {
  const snapshot = await loadRunSnapshot(executor, schema, options);
  return snapshot ? buildPlatformObservabilityReadModel(snapshot) : null;
}

export async function getPlatformControlPlaneTaskArtifactCatalog(
  executor: SqlExecutor,
  schema: string,
  options: GetPlatformControlPlaneRunOptions & { taskId: string }
): Promise<PlatformControlPlaneTaskArtifactCatalog | null> {
  const snapshot = await loadRunSnapshot(executor, schema, options);
  if (!snapshot) {
    return null;
  }

  const catalogArtifact = snapshot.artifacts.find((artifact) => {
    if (artifact.taskId !== options.taskId) {
      return false;
    }

    const originalArtifactId = typeof artifact.metadata?.originalArtifactId === 'string'
      ? artifact.metadata.originalArtifactId
      : null;
    return originalArtifactId === 'execution-artifact-catalog' || artifact.path.includes('execution-artifact-catalog');
  });

  if (!catalogArtifact) {
    return null;
  }

  const repositoryRootPath = await loadRepositoryRootPath(executor, schema, options.runId);
  if (!repositoryRootPath) {
    return null;
  }

  const catalog = readStructuredFileFrom(repositoryRootPath, catalogArtifact.path) as PlatformControlPlaneTaskArtifactCatalog['catalog'];
  const validators = getSchemaValidators();
  if (!validators.executionArtifactCatalog(catalog)) {
    throw new Error(`Invalid execution artifact catalog at ${catalogArtifact.path}`);
  }

  return {
    runId: options.runId,
    taskId: options.taskId,
    artifactId: catalogArtifact.artifactId,
    path: catalogArtifact.path,
    catalog
  };
}

function inferContentType(filePath: string, declaredContentType: string | undefined): string {
  if (declaredContentType) {
    return declaredContentType;
  }

  if (filePath.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (filePath.endsWith('.png')) {
    return 'image/png';
  }
  if (filePath.endsWith('.zip')) {
    return 'application/zip';
  }
  if (filePath.endsWith('.webm')) {
    return 'video/webm';
  }
  if (filePath.endsWith('.log') || filePath.endsWith('.txt')) {
    return 'text/plain; charset=utf-8';
  }

  return 'application/octet-stream';
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedCandidate = path.resolve(candidatePath);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

export async function getPlatformControlPlaneLocalArtifactContent(
  executor: SqlExecutor,
  schema: string,
  options: { objectKey: string }
): Promise<PlatformControlPlaneLocalArtifactContent | null> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const rows = await executor.query<PlatformControlPlaneArtifactCatalogRow>(
    `
      SELECT
        artifacts.run_id,
        artifacts.task_id,
        artifacts.artifact_id,
        artifacts.path,
        repositories.root_path
      FROM ${quotedSchema}.artifacts AS artifacts
      INNER JOIN ${quotedSchema}.runs AS runs
        ON runs.run_id = artifacts.run_id
      INNER JOIN ${quotedSchema}.repositories AS repositories
        ON repositories.repository_id = runs.repository_id
      WHERE (artifacts.metadata ->> 'originalArtifactId') = 'execution-artifact-catalog'
         OR artifacts.path LIKE '%execution-artifact-catalog%'
      ORDER BY artifacts.created_at DESC, artifacts.artifact_id DESC
    `
  );

  const validators = getSchemaValidators();

  for (const row of rows.rows) {
    let catalog: PlatformControlPlaneTaskArtifactCatalog['catalog'];
    try {
      catalog = readStructuredFileFrom(row.root_path, row.path) as PlatformControlPlaneTaskArtifactCatalog['catalog'];
    } catch {
      continue;
    }

    if (!validators.executionArtifactCatalog(catalog)) {
      continue;
    }

    const artifact = catalog.artifacts.find((entry) =>
      entry.storage?.mode === 'local'
      && entry.storage?.provider === 'local-fs'
      && entry.storage?.objectKey === options.objectKey
    );

    if (!artifact || !row.task_id) {
      continue;
    }

    const resolvedPath = resolveFromBaseDir(row.root_path, artifact.path);
    if (!isPathInsideRoot(row.root_path, resolvedPath) || !fs.existsSync(resolvedPath)) {
      continue;
    }

    return {
      objectKey: options.objectKey,
      artifactId: artifact.id,
      runId: row.run_id,
      taskId: row.task_id,
      localPath: resolvedPath,
      contentType: inferContentType(artifact.path, artifact.contentType)
    };
  }

  return null;
}

export async function getPlatformControlPlaneArtifactContent(
  executor: SqlExecutor,
  schema: string,
  options: { artifactId: string }
): Promise<PlatformControlPlaneArtifactContent | null> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const result = await executor.query<PlatformControlPlaneArtifactContentRow>(
    `
      SELECT
        artifacts.run_id,
        artifacts.task_id,
        artifacts.artifact_id,
        artifacts.path,
        repositories.root_path
      FROM ${quotedSchema}.artifacts AS artifacts
      INNER JOIN ${quotedSchema}.runs AS runs
        ON runs.run_id = artifacts.run_id
      INNER JOIN ${quotedSchema}.repositories AS repositories
        ON repositories.repository_id = runs.repository_id
      WHERE artifacts.artifact_id = $1
      LIMIT 1
    `,
    [options.artifactId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const resolvedPath = resolveFromBaseDir(row.root_path, row.path);
  if (!isPathInsideRoot(row.root_path, resolvedPath) || !fs.existsSync(resolvedPath)) {
    return null;
  }

  return {
    artifactId: row.artifact_id,
    runId: row.run_id,
    taskId: row.task_id,
    localPath: resolvedPath,
    contentType: inferContentType(row.path, undefined)
  };
}
