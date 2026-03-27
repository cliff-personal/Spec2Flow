import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { applyCollaborationPublicationPolicy } from './collaboration-publication-service.js';
import type { TaskState } from '../types/execution-state.js';
import type { Task, TaskRoleProfile } from '../types/task-graph.js';

const tempDirs: string[] = [];
const originalPath = process.env.PATH ?? '';

function createRoleProfile(stage: TaskRoleProfile['specialistRole']): TaskRoleProfile {
  return {
    profileId: `${stage}-profile`,
    specialistRole: stage,
    commandPolicy: 'collaboration-only',
    canReadRepository: true,
    canEditFiles: false,
    canRunCommands: false,
    canWriteArtifacts: true,
    canOpenCollaboration: true,
    requiredAdapterSupports: [],
    expectedArtifacts: ['collaboration-handoff']
  };
}

function initGitRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-collaboration-publication-'));
  tempDirs.push(repoRoot);
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 1;\n', 'utf8');
  execFileSync('git', ['init'], { cwd: repoRoot, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.email', 'spec2flow@example.com'], { cwd: repoRoot, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Spec2Flow Tests'], { cwd: repoRoot, encoding: 'utf8' });
  execFileSync('git', ['add', 'src/app.ts'], { cwd: repoRoot, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, encoding: 'utf8' });
  return repoRoot;
}

function enableRemotePullRequestCommands(repoRoot: string): string {
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-collaboration-remote-'));
  tempDirs.push(remoteRoot);
  execFileSync('git', ['init', '--bare'], { cwd: remoteRoot, encoding: 'utf8' });
  execFileSync('git', ['remote', 'add', 'origin', remoteRoot], { cwd: repoRoot, encoding: 'utf8' });
  execFileSync('git', ['push', '--set-upstream', 'origin', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });

  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-gh-bin-'));
  tempDirs.push(binDir);
  const ghLogPath = path.join(binDir, 'gh.log');
  const ghPath = path.join(binDir, 'gh');
  const ghScript = [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$GH_LOG_PATH"',
    'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
    '  printf "%s\\n" "$GH_PR_URL"',
    '  exit 0',
    'fi',
    'if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then',
    '  exit 0',
    'fi',
    'exit 1',
    ''
  ].join('\n');
  fs.writeFileSync(ghPath, ghScript, 'utf8');
  fs.chmodSync(ghPath, 0o755);

  process.env.GH_LOG_PATH = ghLogPath;
  process.env.GH_PR_URL = 'https://github.com/cliff-personal/Spec2Flow/pull/321';
  process.env.PATH = `${binDir}:${originalPath}`;
  return ghLogPath;
}

function writeImplementationSummary(repoRoot: string): string {
  const filePath = path.join(repoRoot, 'spec2flow', 'outputs', 'execution', 'frontend-smoke', 'implementation-summary.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId: 'frontend-smoke--code-implementation',
    stage: 'code-implementation',
    goal: 'Implement change',
    summary: 'Updated the app entrypoint.',
    changedFiles: [
      {
        path: 'src/app.ts',
        changeType: 'modified'
      }
    ]
  }, null, 2)}\n`, 'utf8');
  return filePath;
}

function writeCollaborationHandoff(repoRoot: string, approvalRequired: boolean, handoffType: 'pull-request' | 'review' = 'pull-request'): string {
  const filePath = path.join(repoRoot, 'spec2flow', 'outputs', 'execution', 'frontend-smoke', 'collaboration-handoff.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId: 'frontend-smoke--collaboration',
    stage: 'collaboration',
    summary: 'Prepare the frontend smoke pull request.',
    handoffType,
    readiness: 'ready',
    approvalRequired,
    artifactRefs: ['implementation-summary', 'execution-report'],
    nextActions: ['Open the pull request handoff for review.'],
    reviewPolicy: {
      required: true,
      reviewAgentCount: 1,
      requireHumanApproval: approvalRequired
    }
  }, null, 2)}\n`, 'utf8');
  return filePath;
}

function createCollaborationTask(allowAutoCommit: boolean, requireHumanApproval = false): Task {
  return {
    id: 'frontend-smoke--collaboration',
    stage: 'collaboration',
    title: 'Prepare handoff',
    goal: 'Prepare collaboration publish flow',
    executorType: 'collaboration-agent',
    roleProfile: createRoleProfile('collaboration-agent'),
    status: 'ready',
    reviewPolicy: {
      required: true,
      reviewAgentCount: 1,
      requireHumanApproval,
      allowAutoCommit
    }
  };
}

function createTaskState(status: TaskState['status'] = 'completed'): TaskState {
  return {
    taskId: 'frontend-smoke--collaboration',
    status,
    notes: []
  };
}

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.GH_LOG_PATH;
  delete process.env.GH_PR_URL;
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('collaboration-publication-service', () => {
  it('creates a publish branch, commit, publication record, and PR draft when auto-commit is allowed', () => {
    const repoRoot = initGitRepo();
    const implementationSummaryPath = writeImplementationSummary(repoRoot);
    const collaborationHandoffPath = writeCollaborationHandoff(repoRoot, false);
    fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 2;\n', 'utf8');

    const decision = applyCollaborationPublicationPolicy({
      taskGraphTask: createCollaborationTask(true, false),
      taskState: createTaskState(),
      artifacts: [
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ],
      allArtifacts: [
        {
          id: 'implementation-summary',
          kind: 'report',
          path: implementationSummaryPath,
          taskId: 'frontend-smoke--code-implementation'
        },
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ],
      artifactBaseDir: repoRoot
    });

    expect(decision.status).toBe('published');
    if (decision.status !== 'published') {
      throw new Error('expected published decision');
    }

    const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    expect(currentBranch).toBe(decision.publication.branchName);
    expect(decision.publication.commitSha).toBeTruthy();
    expect(decision.generatedArtifacts.map((artifact) => artifact.id)).toEqual(expect.arrayContaining(['publication-record', 'pr-draft']));

    const publicationRecordPath = path.join(repoRoot, 'spec2flow', 'outputs', 'collaboration', 'frontend-smoke', 'publication-record.json');
    const prDraftPath = path.join(repoRoot, 'spec2flow', 'outputs', 'collaboration', 'frontend-smoke', 'pr-draft.md');
    expect(fs.existsSync(publicationRecordPath)).toBe(true);
    expect(fs.existsSync(prDraftPath)).toBe(true);
  });

  it('blocks publication and writes a manual draft record when auto-commit is disabled', () => {
    const repoRoot = initGitRepo();
    const implementationSummaryPath = writeImplementationSummary(repoRoot);
    const collaborationHandoffPath = writeCollaborationHandoff(repoRoot, false);
    fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 2;\n', 'utf8');

    const decision = applyCollaborationPublicationPolicy({
      taskGraphTask: createCollaborationTask(false, false),
      taskState: createTaskState(),
      artifacts: [
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ],
      allArtifacts: [
        {
          id: 'implementation-summary',
          kind: 'report',
          path: implementationSummaryPath,
          taskId: 'frontend-smoke--code-implementation'
        },
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ],
      artifactBaseDir: repoRoot
    });

    expect(decision.status).toBe('blocked');
    if (decision.status !== 'blocked') {
      throw new Error('expected blocked decision');
    }

    expect(decision.reason).toBe('auto-commit-disabled');
    const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    expect(currentBranch).not.toMatch(/^spec2flow\//);
    expect(decision.generatedArtifacts.map((artifact) => artifact.id)).toEqual(expect.arrayContaining(['publication-record', 'pr-draft']));
  });

  it('force-publishes through the real branch and commit flow when publication is blocked by policy gates', () => {
    const repoRoot = initGitRepo();
    const implementationSummaryPath = writeImplementationSummary(repoRoot);
    const collaborationHandoffPath = writeCollaborationHandoff(repoRoot, true);
    fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 2;\n', 'utf8');

    const decision = applyCollaborationPublicationPolicy({
      taskGraphTask: createCollaborationTask(false, true),
      taskState: createTaskState('blocked'),
      artifacts: [
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ],
      allArtifacts: [
        {
          id: 'implementation-summary',
          kind: 'report',
          path: implementationSummaryPath,
          taskId: 'frontend-smoke--code-implementation'
        },
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ],
      artifactBaseDir: repoRoot,
      forcePublish: true
    });

    expect(decision.status).toBe('published');
    if (decision.status !== 'published') {
      throw new Error('expected forced publication to publish');
    }

    expect(decision.publication.publishMode).toBe('auto-commit');
    expect(decision.publication.autoCommitEnabled).toBe(true);
    expect(decision.publication.approvalRequired).toBe(false);
    expect(decision.publication.branchName).toMatch(/^spec2flow\//);
    expect(decision.publication.commitSha).toBeTruthy();
    expect(decision.generatedArtifacts.map((artifact) => artifact.id)).toEqual(expect.arrayContaining(['publication-record', 'pr-draft']));
  });

  it('approves publication through real PR creation and merge orchestration', () => {
    const repoRoot = initGitRepo();
    const ghLogPath = enableRemotePullRequestCommands(repoRoot);
    const implementationSummaryPath = writeImplementationSummary(repoRoot);
    const collaborationHandoffPath = writeCollaborationHandoff(repoRoot, true);
    fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 2;\n', 'utf8');

    const decision = applyCollaborationPublicationPolicy({
      taskGraphTask: createCollaborationTask(false, true),
      taskState: createTaskState('blocked'),
      artifacts: [
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ],
      allArtifacts: [
        {
          id: 'implementation-summary',
          kind: 'report',
          path: implementationSummaryPath,
          taskId: 'frontend-smoke--code-implementation'
        },
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ],
      artifactBaseDir: repoRoot,
      approvalMode: 'operator-approved',
      remotePublication: {
        createPullRequest: true,
        requestMerge: true,
        mergeMethod: 'squash'
      }
    });

    expect(decision.status).toBe('published');
    if (decision.status !== 'published') {
      throw new Error('expected approved publication to publish');
    }

    expect(decision.publication.publishMode).toBe('approved-handoff');
    expect(decision.publication.prUrl).toBe('https://github.com/cliff-personal/Spec2Flow/pull/321');
    expect(decision.publication.mergeStatus).toBe('requested');

    const ghLog = fs.readFileSync(ghLogPath, 'utf8');
    expect(ghLog).toContain('pr create');
    expect(ghLog).toContain('pr merge --auto --squash https://github.com/cliff-personal/Spec2Flow/pull/321');
  });
});
