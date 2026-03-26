import type {
  PlatformObservability,
  PlatformPublicationObservabilitySummary,
  PlatformReviewDecisionStatus,
} from './control-plane-api';

export type ReviewDecisionSummary = {
  status: PlatformReviewDecisionStatus;
  label: string;
  detail: string;
  headline: string;
  tone: 'info' | 'warning' | 'success';
  nextAction: string | null;
};

function buildAcceptedDetail(summary: PlatformPublicationObservabilitySummary): string {
  const decisionBy = summary.reviewDecisionBy ? ` by ${summary.reviewDecisionBy}` : '';
  const note = summary.reviewDecisionNote ? ` ${summary.reviewDecisionNote}` : '';
  return `The final review decision accepted this delivery${decisionBy}.${note}`.trim();
}

export function summarizeReviewDecision(
  latestPublication: PlatformPublicationObservabilitySummary | undefined,
  observability: PlatformObservability | undefined
): ReviewDecisionSummary {
  if (latestPublication) {
    if (latestPublication.reviewDecision === 'accepted') {
      return {
        status: 'accepted',
        label: 'accepted',
        detail: buildAcceptedDetail(latestPublication),
        headline: 'Final review accepted',
        tone: 'success',
        nextAction: 'Open accepted review packet',
      };
    }

    if (latestPublication.reviewDecision === 'follow-up-required') {
      return {
        status: 'follow-up-required',
        label: 'follow-up required',
        detail: latestPublication.reviewDecisionNote ?? latestPublication.gateReason ?? 'The reviewer requested another delivery pass.',
        headline: 'Final review requested follow-up',
        tone: 'warning',
        nextAction: 'Open review packet and start follow-up',
      };
    }

    if (latestPublication.reviewDecision === 'awaiting-decision') {
      return {
        status: 'awaiting-decision',
        label: 'awaiting decision',
        detail: latestPublication.gateReason ?? 'The handoff is waiting for a final human decision.',
        headline: 'Final review waiting on decision',
        tone: 'warning',
        nextAction: 'Open review packet',
      };
    }
  }

  if (observability?.approvals.some((approval) => approval.status === 'requested')) {
    return {
      status: 'awaiting-decision',
      label: 'awaiting decision',
      detail: 'The review packet is assembled and waiting for the final human decision.',
      headline: 'Final review waiting on decision',
      tone: 'warning',
      nextAction: 'Open review packet',
    };
  }

  return {
    status: 'not-required',
    label: 'not required',
    detail: 'No explicit human approval gate was required for this publication path.',
    headline: 'No final review gate required',
    tone: 'info',
    nextAction: null,
  };
}