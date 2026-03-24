import { buildPlatformObservabilityReadModel } from './platform-observability-service.js';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import { DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT, getPlatformRunState } from './platform-scheduler-service.js';
import type {
  PlatformControlPlaneRunDetail,
  PlatformControlPlaneRunListItem,
  PlatformObservabilityReadModel,
  PlatformRunStateSnapshot,
  PlatformRunStatus,
  PlatformTaskRecord
} from '../types/index.js';
import type { RiskLevel, TaskStage } from '../types/task-graph.js';

interface PlatformControlPlaneRunRow extends Record<string, unknown> {
  run_id: string;
  repository_id: string;
  repository_name: string;
  repository_root_path: string;
  workflow_name: string;
  status: PlatformRunStatus;
  current_stage: TaskStage | null;
  risk_level: RiskLevel | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
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

function normalizeTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapRunRow(row: PlatformControlPlaneRunRow): PlatformControlPlaneRunListItem {
  return {
    runId: row.run_id,
    repositoryId: row.repository_id,
    repositoryName: row.repository_name,
    repositoryRootPath: row.repository_root_path,
    workflowName: row.workflow_name,
    status: row.status,
    currentStage: row.current_stage,
    riskLevel: row.risk_level,
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
        runs.workflow_name,
        runs.status,
        runs.current_stage,
        runs.risk_level,
        runs.created_at,
        runs.updated_at,
        runs.started_at,
        runs.completed_at
      FROM ${quotedSchema}.runs AS runs
      INNER JOIN ${quotedSchema}.repositories AS repositories
        ON repositories.repository_id = runs.repository_id
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
  return snapshot?.tasks ?? null;
}

export async function getPlatformControlPlaneRunObservability(
  executor: SqlExecutor,
  schema: string,
  options: GetPlatformControlPlaneRunOptions
): Promise<PlatformObservabilityReadModel | null> {
  const snapshot = await loadRunSnapshot(executor, schema, options);
  return snapshot ? buildPlatformObservabilityReadModel(snapshot) : null;
}