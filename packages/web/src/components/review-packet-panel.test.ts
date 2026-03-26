import { describe, expect, it } from 'vitest';
import { deriveReviewPacketSummary } from './review-packet-panel';
import type { PlatformObservability, PlatformTaskRecord, RunDetail, RunListItem } from '../lib/control-plane-api';

function makeRunDetail(): RunDetail {
  return {
    runState: {
      run: {
        runId: 'run-1',
        repositoryId: 'repo-1',
        workflowName: 'Implement withdrawal review flow',
        status: 'completed',
        currentStage: null,
        riskLevel: 'medium',
      },
      project: {
        projectId: 'project-1',
        repositoryId: 'repo-1',
        name: 'Synapse',
        repositoryRootPath: '/repo',
        workspaceRootPath: '/repo',
        workspacePolicy: {
          allowedReadGlobs: [],
          allowedWriteGlobs: [],
          forbiddenWriteGlobs: [],
        },
      },
      workspace: {
        runId: 'run-1',
        projectId: 'project-1',
        repositoryId: 'repo-1',
        worktreeMode: 'managed',
        provisioningStatus: 'provisioned',
        branchName: 'spec2flow/feature-run-1',
        workspaceRootPath: '/repo',
        worktreePath: '/repo/.worktrees/run-1',
        workspacePolicy: {
          allowedReadGlobs: [],
          allowedWriteGlobs: [],
          forbiddenWriteGlobs: [],
        },
      },
      tasks: [],
      recentEvents: [],
      artifacts: [
        {
          artifactId: 'artifact-1',
          runId: 'run-1',
          kind: 'requirements-summary',
          path: 'spec2flow/outputs/requirements-summary.json',
        },
      ],
    },
    platformObservability: makeObservability(),
  };
}

function makeObservability(overrides: Partial<PlatformObservability> = {}): PlatformObservability {
  return {
    taxonomyVersion: '1',
    metrics: {
      tasks: {
        total: 2,
        pending: 0,
        ready: 0,
        leased: 0,
        inProgress: 0,
        blocked: 0,
        completed: 2,
        failed: 0,
        skipped: 0,
        retryableFailed: 0,
        cancelled: 0,
      },
      repairs: {
        total: 1,
        requested: 0,
        succeeded: 1,
        failed: 0,
        blocked: 0,
      },
      publications: {
        total: 1,
        published: 1,
        approvalRequired: 0,
        blocked: 0,
      },
      events: {
        recentCount: 3,
      },
    },
    attentionRequired: [],
    timeline: [],
    taskSummaries: [],
    repairSummaries: [
      {
        repairAttemptId: 'repair-1',
        taskId: 'task-1',
        triggerTaskId: 'task-origin',
        sourceStage: 'automated-execution',
        failureClass: 'test-failure',
        attemptNumber: 1,
        status: 'succeeded',
        recentEvents: [],
      },
    ],
    publicationSummaries: [
      {
        publicationId: 'pub-1',
        taskId: 'task-2',
        status: 'published',
        publishMode: 'pull-request',
        branchName: 'spec2flow/feature-run-1',
        commitSha: 'abc1234',
        approvalRequired: false,
        reviewDecision: 'not-required',
        recentEvents: [],
      },
    ],
    approvals: [],
    ...overrides,
  };
}

function makeTasks(): PlatformTaskRecord[] {
  return [
    {
      runId: 'run-1',
      taskId: 'task-1',
      stage: 'code-implementation',
      title: 'Implement feature',
      goal: 'Ship feature',
      executorType: 'agent',
      status: 'completed',
      targetFiles: ['src/withdrawal.ts', 'src/withdrawal.test.ts'],
      verifyCommands: ['npm run test:unit'],
    },
  ];
}

function makeRunListItem(overrides: Partial<RunListItem> = {}): RunListItem {
  return {
    runId: 'run-1',
    repositoryId: 'repo-1',
    repositoryName: 'Spec2Flow',
    repositoryRootPath: '/repo',
    workflowName: 'Implement withdrawal review flow',
    requirement: 'Add approval review path for withdrawals',
    status: 'completed',
    paused: false,
    currentStage: null,
    riskLevel: 'medium',
    createdAt: '2026-03-26T10:00:00.000Z',
    updatedAt: '2026-03-26T10:05:00.000Z',
    startedAt: '2026-03-26T10:01:00.000Z',
    completedAt: '2026-03-26T10:05:00.000Z',
    ...overrides,
  };
}

describe('deriveReviewPacketSummary', () => {
  it('builds a handoff summary from run, tasks, and observability', () => {
    const summary = deriveReviewPacketSummary(
      makeRunDetail(),
      makeObservability(),
      makeTasks(),
      makeRunListItem()
    );

    expect(summary.requirementTitle).toBe('Add approval review path for withdrawals');
    expect(summary.implementedFiles).toEqual(['src/withdrawal.ts']);
    expect(summary.testFiles).toEqual(['src/withdrawal.test.ts']);
    expect(summary.verifyCommands).toEqual(['npm run test:unit']);
    expect(summary.repairAttempts).toBe(1);
    expect(summary.resolvedDefects).toBe(1);
    expect(summary.publicationStatus).toBe('published');
    expect(summary.reviewDecision).toBe('not-required');
    expect(summary.reviewDecisionLabel).toBe('not required');
    expect(summary.finalCommit).toBe('abc1234');
    expect(summary.readinessStatus).toBe('review-ready');
    expect(summary.branchHref).toBe('/runs/run-1');
    expect(summary.branchCtaLabel).toBe('Open Run Detail');
    expect(summary.evidenceHref).toContain('/api/artifacts/artifact-1/content');
    expect(summary.evidenceArtifacts[0]?.contentHref).toContain('/api/artifacts/artifact-1/content');
  });

  it('falls back to workflow name when requirement text is unavailable', () => {
    const summary = deriveReviewPacketSummary(
      makeRunDetail(),
      makeObservability(),
      makeTasks()
    );

    expect(summary.requirementTitle).toBe('Implement withdrawal review flow');
  });

  it('prefers a publication PR URL when available for branch navigation', () => {
    const summary = deriveReviewPacketSummary(
      makeRunDetail(),
      makeObservability({
        publicationSummaries: [
          {
            publicationId: 'pub-1',
            taskId: 'task-2',
            status: 'published',
            publishMode: 'pull-request',
            branchName: 'spec2flow/feature-run-1',
            commitSha: 'abc1234',
            prUrl: 'https://github.com/cliff-personal/Spec2Flow/pull/42',
            approvalRequired: false,
            reviewDecision: 'not-required',
            recentEvents: [],
          },
        ],
      }),
      makeTasks(),
      makeRunListItem()
    );

    expect(summary.branchHref).toBe('https://github.com/cliff-personal/Spec2Flow/pull/42');
    expect(summary.branchCtaLabel).toBe('Open Branch / PR');
  });

  it('counts unresolved defects from repairs and attention signals', () => {
    const summary = deriveReviewPacketSummary(
      makeRunDetail(),
      makeObservability({
        attentionRequired: [{ type: 'gate', title: 'Approval blocked', description: 'Approval gate is blocked.' }],
        repairSummaries: [
          {
            repairAttemptId: 'repair-2',
            taskId: 'task-1',
            triggerTaskId: 'task-origin',
            sourceStage: 'automated-execution',
            failureClass: 'e2e-failure',
            attemptNumber: 2,
            status: 'blocked',
            recentEvents: [],
          },
        ],
      }),
      makeTasks(),
      makeRunListItem()
    );

    expect(summary.openDefects).toBe(2);
    expect(summary.nextAction).not.toBe('Open review packet');
  });

  it('surfaces final review acceptance details when the handoff is explicitly accepted', () => {
    const summary = deriveReviewPacketSummary(
      makeRunDetail(),
      makeObservability({
        publicationSummaries: [
          {
            publicationId: 'pub-1',
            taskId: 'task-2',
            status: 'published',
            publishMode: 'pull-request',
            branchName: 'spec2flow/feature-run-1',
            commitSha: 'abc1234',
            approvalRequired: true,
            reviewDecision: 'accepted',
            reviewDecisionBy: 'operator-1',
            reviewDecisionNote: 'LGTM',
            recentEvents: [],
          },
        ],
      }),
      makeTasks(),
      makeRunListItem()
    );

    expect(summary.reviewDecision).toBe('accepted');
    expect(summary.reviewDecisionLabel).toBe('accepted');
    expect(summary.reviewDecisionDetail).toContain('operator-1');
    expect(summary.reviewDecisionDetail).toContain('LGTM');
  });
});