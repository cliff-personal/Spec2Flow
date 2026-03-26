import { describe, expect, it } from 'vitest';
import { deriveRunAttentionItems, selectAttentionCandidateRuns } from './run-attention-panel';
import type { PlatformObservability, RunListItem } from '../lib/control-plane-api';

function makeRun(overrides: Partial<RunListItem> = {}): RunListItem {
  return {
    runId: 'run-1',
    repositoryId: 'repo-1',
    repositoryName: 'Spec2Flow',
    repositoryRootPath: '/repo',
    workflowName: 'Autonomous change',
    status: 'running',
    paused: false,
    currentStage: 'defect-feedback',
    riskLevel: 'medium',
    createdAt: '2026-03-26T10:00:00.000Z',
    updatedAt: '2026-03-26T10:05:00.000Z',
    startedAt: '2026-03-26T10:01:00.000Z',
    completedAt: null,
    ...overrides,
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
        inProgress: 1,
        blocked: 0,
        completed: 0,
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

describe('selectAttentionCandidateRuns', () => {
  it('prioritizes blocked and running runs ahead of completed ones', () => {
    const runs = selectAttentionCandidateRuns([
      makeRun({ runId: 'completed', status: 'completed', updatedAt: '2026-03-26T10:01:00.000Z' }),
      makeRun({ runId: 'running', status: 'running', updatedAt: '2026-03-26T10:02:00.000Z' }),
      makeRun({ runId: 'blocked', status: 'blocked', updatedAt: '2026-03-26T10:03:00.000Z' }),
    ]);

    expect(runs.map((run) => run.runId)).toEqual(['blocked', 'running', 'completed']);
  });
});

describe('deriveRunAttentionItems', () => {
  it('surfaces approval requests as the next action', () => {
    const run = makeRun({ runId: 'approval-run', status: 'blocked' });
    const items = deriveRunAttentionItems([run], {
      'approval-run': makeObservability({
        attentionRequired: [{
          kind: 'publication',
          type: 'approval-requested',
          severity: 'info',
          title: 'Release gate waiting',
          description: 'Need human approval before publication.'
        }],
        approvals: [{ taskId: 'task-1', publicationId: 'pub-1', createdAt: '2026-03-26T10:06:00.000Z', status: 'requested', reason: 'PR needs sign-off' }],
      }),
    });

    expect(items[0]).toMatchObject({
      tone: 'error',
      headline: 'Release gate waiting',
      nextAction: 'Await human approval',
      attentionCount: 1,
    });
  });

  it('shows completed runs as review-ready when no attention signals exist', () => {
    const run = makeRun({ runId: 'done-run', status: 'completed', currentStage: null, completedAt: '2026-03-26T10:09:00.000Z' });
    const items = deriveRunAttentionItems([run], {
      'done-run': makeObservability(),
    });

    expect(items[0]).toMatchObject({
      tone: 'success',
      headline: 'Review packet ready',
      nextAction: 'Open review packet',
    });
  });

  it('surfaces accepted review decisions in the attention deck', () => {
    const run = makeRun({ runId: 'accepted-run', status: 'completed', currentStage: null, completedAt: '2026-03-26T10:09:00.000Z' });
    const items = deriveRunAttentionItems([run], {
      'accepted-run': makeObservability({
        publicationSummaries: [
          {
            publicationId: 'pub-1',
            taskId: 'task-1',
            status: 'published',
            publishMode: 'pull-request',
            approvalRequired: true,
            reviewDecision: 'accepted',
            reviewDecisionBy: 'operator-1',
            reviewDecisionNote: 'LGTM after evidence review',
            recentEvents: [],
          },
        ],
      }),
    });

    expect(items[0]).toMatchObject({
      tone: 'success',
      headline: 'Final review accepted',
      nextAction: 'Open accepted review packet',
    });
    expect(items[0]?.detail).toContain('operator-1');
    expect(items[0]?.detail).toContain('LGTM after evidence review');
  });

  it('promotes follow-up decisions ahead of passive completed runs', () => {
    const followUpRun = makeRun({ runId: 'follow-up-run', status: 'completed', currentStage: null, completedAt: '2026-03-26T10:10:00.000Z' });
    const passiveRun = makeRun({ runId: 'passive-run', status: 'completed', currentStage: null, completedAt: '2026-03-26T10:11:00.000Z' });
    const items = deriveRunAttentionItems([passiveRun, followUpRun], {
      'passive-run': makeObservability(),
      'follow-up-run': makeObservability({
        publicationSummaries: [
          {
            publicationId: 'pub-2',
            taskId: 'task-2',
            status: 'published',
            publishMode: 'pull-request',
            approvalRequired: true,
            reviewDecision: 'follow-up-required',
            reviewDecisionNote: 'Need another delivery pass for flaky tests.',
            recentEvents: [],
          },
        ],
      }),
    });

    expect(items.map((item) => item.runId)).toEqual(['follow-up-run', 'passive-run']);
    expect(items[0]).toMatchObject({
      tone: 'warning',
      headline: 'Final review requested follow-up',
      nextAction: 'Open review packet and start follow-up',
    });
  });

  it('prefers blocked repair loops over generic monitoring language', () => {
    const run = makeRun({ runId: 'repair-run', status: 'running' });
    const items = deriveRunAttentionItems([run], {
      'repair-run': makeObservability({
        repairSummaries: [{
          repairAttemptId: 'repair-1',
          taskId: 'task-1',
          triggerTaskId: 'task-origin',
          sourceStage: 'automated-execution',
          failureClass: 'test-failure',
          attemptNumber: 2,
          status: 'blocked',
          recentEvents: [],
        }],
      }),
    });

    expect(items[0].nextAction).toBe('Inspect blocked repair');
  });

  it('surfaces evaluator reroute targets directly in the attention deck', () => {
    const run = makeRun({ runId: 'reroute-run', status: 'running', currentStage: 'evaluation' });
    const items = deriveRunAttentionItems([run], {
      'reroute-run': makeObservability({
        attentionRequired: [{
          kind: 'task',
          type: 'evaluator-reroute-requested',
          severity: 'warning',
          taskId: 'frontend-smoke--evaluation',
          repairTargetStage: 'automated-execution',
          title: 'Evaluator requested reroute to Automated Execution',
          description: 'frontend-smoke--evaluation asked the controller to flow back to Automated Execution.',
        }],
      }),
    });

    expect(items[0]).toMatchObject({
      headline: 'Evaluator requested reroute to Automated Execution',
      nextAction: 'Resume loop from Automated Execution',
      tone: 'warning',
    });
  });
});