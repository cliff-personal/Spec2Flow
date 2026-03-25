import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {
  PlatformRunWorkspaceMode,
  PlatformRunWorkspaceProvisioningStatus,
  PlatformRunWorkspaceRecord,
  PlatformWorkspacePolicy
} from '../types/index.js';

const DEFAULT_BRANCH_PREFIX = 'spec2flow/';

export interface ProvisionPlatformRunWorkspaceOptions {
  runId: string;
  projectId: string;
  repositoryId: string;
  repositoryRootPath: string;
  workspaceRootPath: string;
  defaultBranch: string;
  branchPrefix?: string | null;
  worktreeRootPath?: string | null;
  worktreeMode?: PlatformRunWorkspaceMode;
  workspacePolicy: PlatformWorkspacePolicy;
}

export interface ProvisionPlatformRunWorkspaceDependencies {
  execFileSync: typeof execFileSync;
  existsSync: typeof fs.existsSync;
  mkdirSync: typeof fs.mkdirSync;
}

const defaultDependencies: ProvisionPlatformRunWorkspaceDependencies = {
  execFileSync,
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync
};

function sanitizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'spec2flow';
}

function runGit(
  repositoryRootPath: string,
  args: string[],
  dependencies: ProvisionPlatformRunWorkspaceDependencies
): string {
  return dependencies.execFileSync('git', args, {
    cwd: repositoryRootPath,
    encoding: 'utf8'
  }).trim();
}

function branchExists(
  repositoryRootPath: string,
  branchName: string,
  dependencies: ProvisionPlatformRunWorkspaceDependencies
): boolean {
  try {
    runGit(repositoryRootPath, ['rev-parse', '--verify', '--quiet', branchName], dependencies);
    return true;
  } catch {
    return false;
  }
}

function buildDefaultWorktreeRootPath(repositoryRootPath: string, workspaceRootPath: string): string {
  return path.resolve(workspaceRootPath, '.spec2flow', 'worktrees');
}

function buildBranchName(runId: string, branchPrefix: string | null | undefined): string {
  const normalizedPrefix = (branchPrefix?.trim() || DEFAULT_BRANCH_PREFIX).replace(/\/?$/u, '/');
  return `${normalizedPrefix}${sanitizeToken(runId)}`;
}

export function provisionPlatformRunWorkspace(
  options: ProvisionPlatformRunWorkspaceOptions,
  dependencies: ProvisionPlatformRunWorkspaceDependencies = defaultDependencies
): PlatformRunWorkspaceRecord {
  const repositoryRootPath = path.resolve(options.repositoryRootPath);
  const workspaceRootPath = path.resolve(options.workspaceRootPath);
  const worktreeMode = options.worktreeMode ?? 'managed';
  const branchName = buildBranchName(options.runId, options.branchPrefix);

  if (worktreeMode === 'none') {
    return {
      runId: options.runId,
      projectId: options.projectId,
      repositoryId: options.repositoryId,
      worktreeMode,
      provisioningStatus: 'skipped',
      branchName,
      baseBranch: options.defaultBranch,
      workspaceRootPath,
      worktreePath: workspaceRootPath,
      workspacePolicy: options.workspacePolicy,
      metadata: {
        provisionedBy: 'platform-run-provisioning-service',
        repositoryRootPath
      }
    };
  }

  const worktreeRootPath = path.resolve(options.worktreeRootPath ?? buildDefaultWorktreeRootPath(repositoryRootPath, workspaceRootPath));
  const worktreePath = path.resolve(worktreeRootPath, sanitizeToken(options.runId));

  if (dependencies.existsSync(worktreePath)) {
    throw new Error(`worktree path already exists: ${worktreePath}`);
  }

  dependencies.mkdirSync(worktreeRootPath, { recursive: true });

  runGit(repositoryRootPath, ['rev-parse', '--show-toplevel'], dependencies);

  if (branchExists(repositoryRootPath, branchName, dependencies)) {
    runGit(repositoryRootPath, ['worktree', 'add', worktreePath, branchName], dependencies);
  } else {
    runGit(repositoryRootPath, ['worktree', 'add', '-b', branchName, worktreePath, options.defaultBranch], dependencies);
  }

  const provisioningStatus: PlatformRunWorkspaceProvisioningStatus = 'provisioned';
  return {
    runId: options.runId,
    projectId: options.projectId,
    repositoryId: options.repositoryId,
    worktreeMode,
    provisioningStatus,
    branchName,
    baseBranch: options.defaultBranch,
    workspaceRootPath,
    worktreePath,
    workspacePolicy: options.workspacePolicy,
    metadata: {
      provisionedBy: 'platform-run-provisioning-service',
      worktreeRootPath
    }
  };
}
