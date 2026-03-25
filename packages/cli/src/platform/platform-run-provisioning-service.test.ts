import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { provisionPlatformRunWorkspace } from './platform-run-provisioning-service.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-run-provisioning-'));
}

function initGitRepo(repositoryRootPath: string): void {
  fs.mkdirSync(path.join(repositoryRootPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repositoryRootPath, 'src', 'index.ts'), 'export const ready = true;\n', 'utf8');
  execFileSync('git', ['init'], { cwd: repositoryRootPath, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.email', 'spec2flow@example.com'], { cwd: repositoryRootPath, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Spec2Flow Tests'], { cwd: repositoryRootPath, encoding: 'utf8' });
  execFileSync('git', ['add', 'src/index.ts'], { cwd: repositoryRootPath, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repositoryRootPath, encoding: 'utf8' });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: repositoryRootPath, encoding: 'utf8' });
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('platform-run-provisioning-service', () => {
  it('creates a managed worktree on a run-scoped branch', () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);
    initGitRepo(tempDir);

    const result = provisionPlatformRunWorkspace({
      runId: 'feature-run-1',
      projectId: 'spec2flow-local',
      repositoryId: 'spec2flow',
      repositoryRootPath: tempDir,
      workspaceRootPath: tempDir,
      defaultBranch: 'main',
      branchPrefix: 'spec2flow/',
      workspacePolicy: {
        allowedReadGlobs: ['**/*'],
        allowedWriteGlobs: ['src/**', 'tests/**'],
        forbiddenWriteGlobs: ['.git/**']
      }
    });

    expect(result).toEqual(expect.objectContaining({
      runId: 'feature-run-1',
      branchName: 'spec2flow/feature-run-1',
      baseBranch: 'main',
      worktreeMode: 'managed',
      provisioningStatus: 'provisioned'
    }));
    expect(fs.existsSync(result.worktreePath)).toBe(true);
    expect(fs.existsSync(path.join(result.worktreePath, 'src', 'index.ts'))).toBe(true);
  });

  it('skips worktree provisioning when mode is none', () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);

    const result = provisionPlatformRunWorkspace({
      runId: 'feature-run-2',
      projectId: 'spec2flow-local',
      repositoryId: 'spec2flow',
      repositoryRootPath: tempDir,
      workspaceRootPath: tempDir,
      defaultBranch: 'main',
      worktreeMode: 'none',
      workspacePolicy: {
        allowedReadGlobs: ['**/*'],
        allowedWriteGlobs: ['src/**'],
        forbiddenWriteGlobs: ['.git/**']
      }
    });

    expect(result).toEqual(expect.objectContaining({
      worktreeMode: 'none',
      provisioningStatus: 'skipped',
      worktreePath: tempDir,
      workspaceRootPath: tempDir
    }));
  });
});
