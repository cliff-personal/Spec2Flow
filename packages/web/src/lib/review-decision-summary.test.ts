import { describe, expect, it } from 'vitest';
import type { PlatformObservability } from './control-plane-api';
import { summarizeReviewDecision } from './review-decision-summary';

function makeObservability(overrides: Partial<PlatformObservability> = {}): PlatformObservability {
  return {
    taxonomyVersion: '1',
    metrics: {
      tasks: {
        total: 0,
        pending: 0,
        ready: 0,
        leased: 0,
        inProgress: 0,
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

describe('summarizeReviewDecision', () => {
  it('formats accepted decisions with actor and note context', () => {
    const observability = makeObservability({
      publicationSummaries: [
        {
          publicationId: 'pub-1',
          taskId: 'task-1',
          status: 'published',
          publishMode: 'pull-request',
          approvalRequired: true,
          reviewDecision: 'accepted',
          reviewDecisionBy: 'operator-1',
          reviewDecisionNote: 'LGTM',
          recentEvents: [],
        },
      ],
    });

    const summary = summarizeReviewDecision(observability.publicationSummaries[0], observability);

    expect(summary).toMatchObject({
      status: 'accepted',
      headline: 'Final review accepted',
      tone: 'success',
      nextAction: 'Open accepted review packet',
    });
    expect(summary.detail).toContain('operator-1');
    expect(summary.detail).toContain('LGTM');
  });

  it('treats pending approval gates as awaiting decision even before an explicit review decision is stored', () => {
    const observability = makeObservability({
      approvals: [
        {
          taskId: 'task-1',
          publicationId: 'pub-1',
          createdAt: '2026-03-26T10:00:00.000Z',
          status: 'requested',
          reason: 'Awaiting final operator sign-off',
        },
      ],
    });

    const summary = summarizeReviewDecision(undefined, observability);

    expect(summary).toMatchObject({
      status: 'awaiting-decision',
      headline: 'Final review waiting on decision',
      tone: 'warning',
      nextAction: 'Open review packet',
    });
  });
});