import path from 'node:path';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import { upsertPlatformProject, upsertPlatformRepository } from './platform-repository.js';
import type {
  PlatformControlPlaneProjectListItem,
  PlatformControlPlaneProjectRegistrationRequest,
  PlatformControlPlaneProjectRegistrationResult,
  PlatformProjectRecord,
  PlatformRepositoryRecord,
  PlatformWorkspacePolicy
} from '../types/index.js';

export interface ListPlatformProjectsOptions {
  limit?: number;
  repositoryId?: string;
}

interface PlatformProjectRow extends Record<string, unknown> {
  project_id: string;
  project_name: string;
  repository_id: string;
  repository_name: string;
  repository_root_path: string;
  workspace_root_path: string;
  project_path: string | null;
  topology_path: string | null;
  risk_path: string | null;
  default_branch: string | null;
  branch_prefix: string | null;
  workspace_policy: PlatformWorkspacePolicy | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

export class PlatformProjectRegistrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PlatformProjectRegistrationError';
  }
}

function normalizeString(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function toStableIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'spec2flow';
}

function normalizeWorkspacePolicy(policy: PlatformControlPlaneProjectRegistrationRequest['workspacePolicy']): PlatformWorkspacePolicy {
  return {
    allowedReadGlobs: policy?.allowedReadGlobs?.length ? [...policy.allowedReadGlobs] : ['**/*'],
    allowedWriteGlobs: policy?.allowedWriteGlobs?.length ? [...policy.allowedWriteGlobs] : ['**/*'],
    forbiddenWriteGlobs: policy?.forbiddenWriteGlobs?.length ? [...policy.forbiddenWriteGlobs] : []
  };
}

function normalizeTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapProjectRow(row: PlatformProjectRow): PlatformControlPlaneProjectListItem {
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    repositoryId: row.repository_id,
    repositoryName: row.repository_name,
    repositoryRootPath: row.repository_root_path,
    workspaceRootPath: row.workspace_root_path,
    projectPath: row.project_path,
    topologyPath: row.topology_path,
    riskPath: row.risk_path,
    defaultBranch: row.default_branch,
    branchPrefix: row.branch_prefix,
    workspacePolicy: row.workspace_policy ?? {
      allowedReadGlobs: ['**/*'],
      allowedWriteGlobs: ['**/*'],
      forbiddenWriteGlobs: []
    },
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at)
  };
}

export async function listPlatformProjects(
  executor: SqlExecutor,
  schema: string,
  options: ListPlatformProjectsOptions = {}
): Promise<PlatformControlPlaneProjectListItem[]> {
  const quotedSchema = quoteSqlIdentifier(schema);
  const whereClauses: string[] = [];
  const values: unknown[] = [];

  if (options.repositoryId) {
    values.push(options.repositoryId);
    whereClauses.push(`projects.repository_id = $${values.length}`);
  }

  values.push(options.limit ?? 50);
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const result = await executor.query<PlatformProjectRow>(
    `
      SELECT
        projects.project_id,
        projects.name AS project_name,
        projects.repository_id,
        repositories.name AS repository_name,
        projects.repository_root_path,
        projects.workspace_root_path,
        projects.project_path,
        projects.topology_path,
        projects.risk_path,
        projects.default_branch,
        projects.branch_prefix,
        projects.workspace_policy,
        projects.created_at,
        projects.updated_at
      FROM ${quotedSchema}.projects AS projects
      INNER JOIN ${quotedSchema}.repositories AS repositories
        ON repositories.repository_id = projects.repository_id
      ${whereSql}
      ORDER BY projects.created_at DESC, projects.project_id DESC
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map(mapProjectRow);
}

export async function registerPlatformProject(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneProjectRegistrationRequest
): Promise<PlatformControlPlaneProjectRegistrationResult> {
  const repositoryRootPath = path.resolve(options.repositoryRootPath);
  const repositoryName = normalizeString(options.repositoryName) ?? path.basename(repositoryRootPath);
  const repositoryId = normalizeString(options.repositoryId) ?? toStableIdentifier(repositoryName);
  const projectName = normalizeString(options.projectName) ?? repositoryName;
  const projectId = normalizeString(options.projectId) ?? toStableIdentifier(projectName);
  const workspaceRootPath = path.resolve(normalizeString(options.workspaceRootPath) ?? repositoryRootPath);
  const repository: PlatformRepositoryRecord = {
    repositoryId,
    name: repositoryName,
    rootPath: repositoryRootPath,
    defaultBranch: normalizeString(options.defaultBranch) ?? null,
    metadata: {
      source: 'spec2flow-control-plane'
    }
  };
  const project: PlatformProjectRecord = {
    projectId,
    repositoryId,
    name: projectName,
    repositoryRootPath,
    workspaceRootPath,
    projectPath: normalizeString(options.projectPath) ?? null,
    topologyPath: normalizeString(options.topologyPath) ?? null,
    riskPath: normalizeString(options.riskPath) ?? null,
    defaultBranch: normalizeString(options.defaultBranch) ?? null,
    branchPrefix: normalizeString(options.branchPrefix) ?? null,
    workspacePolicy: normalizeWorkspacePolicy(options.workspacePolicy),
    metadata: {
      source: 'spec2flow-control-plane'
    }
  };

  await upsertPlatformRepository(executor, schema, repository);
  await upsertPlatformProject(executor, schema, project);

  return {
    schema,
    repository: {
      repositoryId: repository.repositoryId,
      repositoryName: repository.name,
      repositoryRootPath: repository.rootPath,
      defaultBranch: repository.defaultBranch ?? null
    },
    project
  };
}
