import { describe, expect, it } from 'vitest';
import { deriveEvaluatorRepairRoute, deriveRunReadinessSignal } from './run-detail-panel';
import type { PlatformObservability, PlatformTaskRecord, RunDetail } from '../lib/control-plane-api';

function makeRunDetail(status: RunDetail['runState']['run']['status'] = 'completed'): RunDetail {
  return {
    runState: {
      run: {
        runId: 'run-1',
        repositoryId: 'repo-1',
        workflowName: 'Autonomous feature delivery',
        status,
        currentStage: status === 'completed' ? null : 'defect-feedback',
        riskLevel: 'medium',
      },
      project: {
        projectId: 'project-1',
        repositoryId: 'repo-1',
        name: 'Spec2Flow',
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
        workspaceRootPath: '/repo',
        worktreePath: '/repo/.worktree/run-1',
        workspacePolicy: {
          allowedReadGlobs: [],
          allowedWriteGlobs: [],
          forbiddenWriteGlobs: [],
        },
      },
      tasks: [],
      recentEvents: [],
      artifacts: [],
    },
    platformObservability: makeObservability(),
  };
}

function makeObservability(overrides: Partial<PlatformObservability> = {}): PlatformObservability {
  return {
    taxonomyVersion: '1',
    metrics: {
      tasks: {
        total: 1,
        pending: 0,
        ready: 0,
        leased: 0,
        inProgress: 0,
        blocked: 0,
        completed: 1,
        failed: 0,
        skipped: 0,
        retryableFailed: 0,
        cancelled: 0,
      },
      repairs: {
        total: 0,
        requested: 0,
        succeeded: 0,
        failed: 0,
        blocked: 0,
      },
      publications: {
        total: 0,
        published: 0,
        approvalRequired: 0,
        blocked: 0,
      },
      events: {
        recentCount: 0,
      },
    },
    attentionRequired: [],
    timeline: [],
    taskSummaries: [],
    repairSummaries: [],
    publicationSummaries: [],
    approvals: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<PlatformTaskRecord> = {}): PlatformTaskRecord {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    stage: 'collaboration',
    title: 'Publish delivery',
    goal: 'Prepare final handoff',
    executorType: 'agent',
    status: 'completed',
    ...overrides,
  };
}

describe('deriveRunReadinessSignal', () => {
  it('marks a completed run with no open signals as review-ready', () => {
    const signal = deriveRunReadinessSignal(makeRunDetail('completed'), makeObservability(), [makeTask()]);

    expect(signal).toMatchObject({
      status: 'review-ready',
      nextAction: 'Open review packet',
    });
    expect(signal.score).toBe(100);
  });

  it('requires attention when approvals are pending', () => {
    const signal = deriveRunReadinessSignal(
      makeRunDetail('running'),
      makeObservability({
        approvals: [{ taskId: 'task-1', publicationId: 'pub-1', createdAt: '2026-03-26T10:00:00.000Z', status: 'requested', reason: 'Need sign-off' }],
      }),
      [makeTask({ status: 'blocked' })]
    );

    expect(signal).toMatchObject({
      status: 'attention-required',
      nextAction: 'Approve or reject publication',
    });
    expect(signal.score).toBeLessThan(100);
  });

  it('marks blocked runs as not handoff-ready', () => {
    const signal = deriveRunReadinessSignal(
      makeRunDetail('blocked'),
      makeObservability(),
      [makeTask({ status: 'blocked' })]
    );

    expect(signal).toMatchObject({
      status: 'blocked',
      nextAction: 'Open blocker and resolve it',
    });
  });

  it('flags missing expected artifacts after completion as attention-required', () => {
    const signal = deriveRunReadinessSignal(
      makeRunDetail('completed'),
      makeObservability({
        taskSummaries: [{
          taskId: 'task-1',
          stage: 'collaboration',
          status: 'completed',
          attempts: 1,
          retryCount: 0,
          autoRepairCount: 0,
          artifactCount: 0,
          expectedArtifactCount: 1,
          missingExpectedArtifactCount: 1,
          recentEvents: [],
        }],
      }),
      [makeTask()]
    );

    expect(signal).toMatchObject({
      status: 'attention-required',
      nextAction: 'Inspect evidence gaps',
    });
  });

  it('derives the latest evaluator repair target for run detail surfaces', () => {
    const route = deriveEvaluatorRepairRoute([
      makeTask({
        taskId: 'route-a--evaluation',
        stage: 'evaluation',
        status: 'blocked',
        updatedAt: '2026-03-26T10:00:00.000Z',
        evaluationDecision: 'needs-repair',
        requestedRepairTargetStage: 'test-design',
        evaluationSummary: 'Expand coverage before rerunning.'
      }),
      makeTask({
        taskId: 'route-b--evaluation',
        stage: 'evaluation',
        status: 'blocked',
        updatedAt: '2026-03-26T11:00:00.000Z',
        evaluationDecision: 'needs-repair',
        requestedRepairTargetStage: 'automated-execution',
        evaluationSummary: 'Rerun execution under a fresh environment.'
      })
    ]);

    expect(route).toEqual({
      taskId: 'route-b--evaluation',
      targetStage: 'automated-execution',
      summary: 'Rerun execution under a fresh environment.'
    });
  });
});