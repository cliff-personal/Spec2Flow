import { describe, expect, it } from 'vitest';
import type { PlatformObservability, PlatformTaskRecord, RunDetail } from './control-plane-api';
import { deriveRunOperatorActions } from './run-operator-actions';

function makeRunDetail(status: RunDetail['runState']['run']['status'] = 'completed'): RunDetail {
  return {
    runState: {
      run: {
        runId: 'run-1',
        repositoryId: 'repo-1',
        workflowName: 'Autonomous delivery run',
        status,
        currentStage: status === 'completed' ? null : 'collaboration',
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
    title: 'Publish result',
    goal: 'Close the loop',
    executorType: 'agent',
    status: 'completed',
    ...overrides,
  };
}

describe('deriveRunOperatorActions', () => {
  it('prioritizes pending approval with run-level publication actions', () => {
    const actions = deriveRunOperatorActions(
      makeRunDetail('running'),
      makeObservability({
        approvals: [
          {
            taskId: 'task-9',
            publicationId: 'pub-1',
            createdAt: '2026-03-26T10:00:00.000Z',
            status: 'requested',
            reason: 'Need final sign-off',
          },
        ],
      }),
      [makeTask({ taskId: 'task-9', status: 'blocked' })],
    );

    expect(actions).toHaveLength(3);
    expect(actions[0]).toMatchObject({ kind: 'run', runAction: 'approve-publication' });
    expect(actions[1]).toMatchObject({ kind: 'run', runAction: 'force-publish' });
    expect(actions[2]).toMatchObject({ kind: 'task', taskAction: 'reject', taskId: 'task-9' });
    expect(actions[0]).toMatchObject({
      notePrompt: expect.objectContaining({
        title: 'Record publication approval',
      }),
    });
    expect(actions[1]).toMatchObject({
      notePrompt: expect.objectContaining({
        confirmLabel: 'Force Publish',
        required: true,
      }),
    });
  });

  it('uses review decision language inside the review packet surface', () => {
    const actions = deriveRunOperatorActions(
      makeRunDetail('running'),
      makeObservability({
        approvals: [
          {
            taskId: 'task-9',
            publicationId: 'pub-1',
            createdAt: '2026-03-26T10:00:00.000Z',
            status: 'requested',
            reason: 'Need final sign-off',
          },
        ],
      }),
      [makeTask({ taskId: 'task-9', status: 'blocked' })],
      { surface: 'review-packet' },
    );

    expect(actions).toEqual([
      expect.objectContaining({ label: 'Accept Result', runAction: 'approve-publication' }),
      expect.objectContaining({ label: 'Force Publish', runAction: 'force-publish' }),
      expect.objectContaining({ label: 'Needs Follow-up', taskAction: 'reject' }),
    ]);
    expect(actions[0]).toMatchObject({
      notePrompt: expect.objectContaining({
        confirmLabel: 'Record Acceptance',
        required: false,
      }),
    });
    expect(actions[2]).toMatchObject({
      notePrompt: expect.objectContaining({
        confirmLabel: 'Record Follow-up',
        required: true,
      }),
    });
    expect(actions[2]?.notePrompt?.initialValue).toContain('Decision: needs-follow-up');
    expect(actions[1]).toMatchObject({
      notePrompt: expect.objectContaining({
        title: 'Record force-publish rationale',
        required: true,
      }),
    });
  });

  it('surfaces reroute override actions when the evaluator requests a repair target', () => {
    const actions = deriveRunOperatorActions(
      makeRunDetail('blocked'),
      makeObservability(),
      [makeTask({
        taskId: 'task-eval',
        stage: 'evaluation',
        status: 'blocked',
        evaluationDecision: 'needs-repair',
        requestedRepairTargetStage: 'code-implementation',
        updatedAt: '2026-03-26T10:05:00.000Z',
      })],
    );

    expect(actions).toEqual([
      expect.objectContaining({ kind: 'run', runAction: 'resume-from-target-stage' }),
      expect.objectContaining({ kind: 'run', runAction: 'reroute-to-requirements-analysis' }),
      expect.objectContaining({ kind: 'run', runAction: 'reroute-to-test-design' }),
      expect.objectContaining({ kind: 'run', runAction: 'reroute-to-automated-execution' }),
      expect.objectContaining({ kind: 'run', runAction: 'cancel-route' }),
    ]);
    expect(actions[1]).toMatchObject({
      notePrompt: expect.objectContaining({
        confirmLabel: 'Apply Reroute',
        required: true,
      }),
    });
    expect(actions[4]).toMatchObject({
      notePrompt: expect.objectContaining({
        confirmLabel: 'Cancel Route',
        required: true,
      }),
    });
  });

  it('offers retry when a repair path is blocked', () => {
    const actions = deriveRunOperatorActions(
      makeRunDetail('blocked'),
      makeObservability({
        repairSummaries: [
          {
            repairAttemptId: 'repair-1',
            taskId: 'task-2',
            triggerTaskId: 'task-1',
            sourceStage: 'automated-execution',
            failureClass: 'test-failure',
            attemptNumber: 2,
            status: 'blocked',
            recentEvents: [],
          },
        ],
      }),
      [makeTask({ taskId: 'task-2', status: 'blocked' })],
    );

    expect(actions).toEqual([
      expect.objectContaining({ kind: 'task', taskAction: 'retry', taskId: 'task-2' }),
    ]);
  });

  it('deep-links to evidence when artifacts are missing', () => {
    const actions = deriveRunOperatorActions(
      makeRunDetail('completed'),
      makeObservability({
        taskSummaries: [
          {
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
          },
        ],
      }),
      [makeTask()],
    );

    expect(actions).toEqual([
      expect.objectContaining({ kind: 'link', href: '#evidence', label: 'Inspect Evidence Gaps' }),
    ]);
  });

  it('opens the review packet when the run is healthy and complete', () => {
    const actions = deriveRunOperatorActions(makeRunDetail('completed'), makeObservability(), [makeTask()]);

    expect(actions).toEqual([
      expect.objectContaining({ kind: 'link', href: '/runs/run-1/review', label: 'Open Review Packet' }),
    ]);
  });

  it('keeps review packet follow-up actions on the same surface once already inside review', () => {
    const actions = deriveRunOperatorActions(
      makeRunDetail('completed'),
      makeObservability(),
      [makeTask()],
      { surface: 'review-packet' },
    );

    expect(actions).toEqual([
      expect.objectContaining({ kind: 'link', href: '#evidence', label: 'Open Delivery Evidence' }),
    ]);
  });
});