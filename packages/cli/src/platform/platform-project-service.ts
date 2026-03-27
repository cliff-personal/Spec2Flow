import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { quoteSqlIdentifier, type SqlExecutor } from './platform-database.js';
import { resolvePlatformProjectAdapterProfile } from './platform-project-adapter-profile.js';
import { upsertPlatformProject, upsertPlatformRepository } from './platform-repository.js';
import { scaffoldSpec2flowFiles } from '../shared/scaffold-spec2flow.js';
import type {
  PlatformProjectAdapterProfile,
  PlatformControlPlaneProjectAdapterProfileUpdateRequest,
  PlatformControlPlaneProjectAdapterProfileUpdateResult,
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
  adapter_profile?: PlatformProjectAdapterProfile | null;
  workspace_policy: PlatformWorkspacePolicy | null;
  metadata: Record<string, unknown> | null;
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
    adapterProfile: row.adapter_profile ?? null,
    workspacePolicy: row.workspace_policy ?? {
      allowedReadGlobs: ['**/*'],
      allowedWriteGlobs: ['**/*'],
      forbiddenWriteGlobs: []
    },
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at)
  };
}

function mapProjectRowToRecord(row: PlatformProjectRow): PlatformProjectRecord {
  return {
    projectId: row.project_id,
    repositoryId: row.repository_id,
    name: row.project_name,
    repositoryRootPath: row.repository_root_path,
    workspaceRootPath: row.workspace_root_path,
    projectPath: row.project_path,
    topologyPath: row.topology_path,
    riskPath: row.risk_path,
    defaultBranch: row.default_branch,
    branchPrefix: row.branch_prefix,
    adapterProfile: row.adapter_profile ?? null,
    workspacePolicy: row.workspace_policy ?? {
      allowedReadGlobs: ['**/*'],
      allowedWriteGlobs: ['**/*'],
      forbiddenWriteGlobs: []
    },
    metadata: row.metadata ?? {},
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at)
  };
}

async function getPlatformProjectRow(
  executor: SqlExecutor,
  schema: string,
  projectId: string
): Promise<PlatformProjectRow | null> {
  const quotedSchema = quoteSqlIdentifier(schema);
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
        projects.adapter_profile,
        projects.workspace_policy,
        projects.metadata,
        projects.created_at,
        projects.updated_at
      FROM ${quotedSchema}.projects AS projects
      INNER JOIN ${quotedSchema}.repositories AS repositories
        ON repositories.repository_id = projects.repository_id
      WHERE projects.project_id = $1
      LIMIT 1
    `,
    [projectId]
  );

  return result.rows[0] ?? null;
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
        projects.adapter_profile,
        projects.workspace_policy,
        projects.metadata,
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

export async function updatePlatformProjectAdapterProfile(
  executor: SqlExecutor,
  schema: string,
  projectId: string,
  options: PlatformControlPlaneProjectAdapterProfileUpdateRequest
): Promise<PlatformControlPlaneProjectAdapterProfileUpdateResult | null> {
  const existingRow = await getPlatformProjectRow(executor, schema, projectId);
  if (!existingRow) {
    return null;
  }

  const existingProject = mapProjectRowToRecord(existingRow);
  const adapterProfile = options.adapterProfile === null
    ? null
    : resolvePlatformProjectAdapterProfile({
        repositoryRootPath: existingProject.repositoryRootPath,
        workspaceRootPath: existingProject.workspaceRootPath,
        adapterProfile: options.adapterProfile
      });

  const project: PlatformProjectRecord = {
    ...existingProject,
    adapterProfile,
    metadata: existingProject.metadata ?? {
      source: 'spec2flow-control-plane'
    }
  };

  await upsertPlatformProject(executor, schema, project);

  return {
    schema,
    project
  };
}

function assertIsGitRepositoryRoot(repositoryRootPath: string): void {
  if (!fs.existsSync(repositoryRootPath)) {
    throw new PlatformProjectRegistrationError(
      'invalid-repository-path',
      `repositoryRootPath does not exist: "${repositoryRootPath}"`,
      400,
      { repositoryRootPath }
    );
  }

  let gitRoot: string;
  try {
    gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repositoryRootPath,
      encoding: 'utf8'
    }).trim();
  } catch {
    throw new PlatformProjectRegistrationError(
      'invalid-repository-path',
      `repositoryRootPath is not inside a git repository: "${repositoryRootPath}"`,
      400,
      { repositoryRootPath }
    );
  }

  const resolvedGitRoot = path.resolve(gitRoot);
  if (resolvedGitRoot !== repositoryRootPath) {
    throw new PlatformProjectRegistrationError(
      'invalid-repository-path',
      `repositoryRootPath must be the git repository root, not a subdirectory. Provided: "${repositoryRootPath}", actual git root: "${resolvedGitRoot}". Use the repository root path directly.`,
      400,
      { repositoryRootPath, gitRepositoryRoot: resolvedGitRoot }
    );
  }
}

export async function registerPlatformProject(
  executor: SqlExecutor,
  schema: string,
  options: PlatformControlPlaneProjectRegistrationRequest,
  storageRoot?: string,
  runtimeRootPath?: string
): Promise<PlatformControlPlaneProjectRegistrationResult> {
  const repositoryRootPath = path.resolve(options.repositoryRootPath);
  assertIsGitRepositoryRoot(repositoryRootPath);
  const repositoryName = normalizeString(options.repositoryName) ?? path.basename(repositoryRootPath);
  const repositoryId = normalizeString(options.repositoryId) ?? toStableIdentifier(repositoryName);
  const projectName = normalizeString(options.projectName) ?? repositoryName;
  const projectId = normalizeString(options.projectId) ?? toStableIdentifier(projectName);
  const workspaceRootPath = path.resolve(normalizeString(options.workspaceRootPath) ?? repositoryRootPath);
  const resolvedRuntimeRootPath = path.resolve(runtimeRootPath ?? storageRoot ?? repositoryRootPath);

  // Compute config paths: if storageRoot is provided, use server-side storage so
  // the target project directory is never touched by Spec2Flow.
  let resolvedProjectPath: string | null = normalizeString(options.projectPath) ?? null;
  let resolvedTopologyPath: string | null = normalizeString(options.topologyPath) ?? null;
  let resolvedRiskPath: string | null = normalizeString(options.riskPath) ?? null;

  if (storageRoot) {
    const configDir = path.resolve(storageRoot, '.spec2flow', 'runtime', 'projects', projectId);
    const projectRelPath = path.posix.join('.spec2flow', 'runtime', 'projects', projectId, 'project.yaml');
    const topologyRelPath = path.posix.join('.spec2flow', 'runtime', 'projects', projectId, 'topology.yaml');
    const riskRelPath = path.posix.join('.spec2flow', 'runtime', 'projects', projectId, 'policies', 'risk.yaml');

    // Scaffold into the server-side storageRoot dir (not the target project).
    try {
      scaffoldSpec2flowFiles(
        path.resolve(storageRoot),
        projectName,
        projectRelPath,
        topologyRelPath,
        riskRelPath,
        resolvedRuntimeRootPath
      );
    } catch {
      // Best-effort; don't block registration if filesystem write fails.
    }

    // Store absolute paths so reads bypass repositoryRootPath resolution.
    resolvedProjectPath = path.resolve(configDir, 'project.yaml');
    resolvedTopologyPath = path.resolve(configDir, 'topology.yaml');
    resolvedRiskPath = path.resolve(configDir, 'policies', 'risk.yaml');
  } else {
    try {
      scaffoldSpec2flowFiles(
        repositoryRootPath,
        projectName,
        resolvedProjectPath ?? undefined,
        resolvedTopologyPath ?? undefined,
        resolvedRiskPath ?? undefined,
        resolvedRuntimeRootPath
      );
    } catch {
      // Best-effort; don't block registration if filesystem write fails.
    }
  }

  const repository: PlatformRepositoryRecord = {
    repositoryId,
    name: repositoryName,
    rootPath: repositoryRootPath,
    defaultBranch: normalizeString(options.defaultBranch) ?? null,
    metadata: {
      source: 'spec2flow-control-plane'
    }
  };
  // Auto-populate adapterProfile.runtimePath from the effective runtime root
  // when the caller did not supply one explicitly.
  let defaultRuntimePath: string | null = null;
  if (!options.adapterProfile?.runtimePath) {
    const candidate = path.resolve(resolvedRuntimeRootPath, '.spec2flow', 'runtime', 'model-adapter-runtime.json');
    if (fs.existsSync(candidate)) {
      defaultRuntimePath = candidate;
    }
  }

  const project: PlatformProjectRecord = {
    projectId,
    repositoryId,
    name: projectName,
    repositoryRootPath,
    workspaceRootPath,
    projectPath: resolvedProjectPath,
    topologyPath: resolvedTopologyPath,
    riskPath: resolvedRiskPath,
    defaultBranch: normalizeString(options.defaultBranch) ?? null,
    branchPrefix: normalizeString(options.branchPrefix) ?? null,
    adapterProfile: resolvePlatformProjectAdapterProfile({
      repositoryRootPath,
      workspaceRootPath,
      ...(options.adapterProfile
        ? { adapterProfile: options.adapterProfile }
        : defaultRuntimePath
        ? { adapterProfile: { runtimePath: defaultRuntimePath } }
        : {})
    }),
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
