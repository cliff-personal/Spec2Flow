import { formatTimestamp } from '../lib/control-plane-formatters';
import type { PlatformObservability, RunListItem } from '../lib/control-plane-api';
import { summarizeReviewDecision } from '../lib/review-decision-summary';
import { StatusPill } from './status-pill';

export type RunAttentionItem = {
  runId: string;
  workflowName: string;
  projectLabel: string;
  currentStage: string | null;
  status: string;
  attentionCount: number;
  headline: string;
  detail: string;
  nextAction: string;
  updatedAt: string | null;
  tone: 'info' | 'warning' | 'error' | 'success';
  priority: number;
};

function toTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toneColor(tone: RunAttentionItem['tone']): string {
  if (tone === 'success') {
    return 'rgba(74,222,128,0.92)';
  }

  if (tone === 'error') {
    return 'rgba(255,120,120,0.92)';
  }

  if (tone === 'warning') {
    return 'rgba(255,196,98,0.92)';
  }

  return 'rgba(0,240,255,0.86)';
}

function toneSurface(tone: RunAttentionItem['tone']): string {
  if (tone === 'success') {
    return 'rgba(74,222,128,0.08)';
  }

  if (tone === 'error') {
    return 'rgba(255,120,120,0.08)';
  }

  if (tone === 'warning') {
    return 'rgba(255,196,98,0.08)';
  }

  return 'rgba(0,240,255,0.08)';
}

function formatStageLabel(stage: string | null | undefined): string {
  if (!stage) {
    return 'requested stage';
  }

  return stage
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function baseRunPriority(run: RunListItem): number {
  if (run.status === 'blocked') {
    return 400;
  }

  if (run.status === 'running') {
    return 300;
  }

  if (run.status === 'pending') {
    return 200;
  }

  if (run.status === 'failed') {
    return 150;
  }

  if (run.status === 'completed') {
    return 40;
  }

  return 0;
}

export function selectAttentionCandidateRuns(runs: RunListItem[], maxItems = 6): RunListItem[] {
  return [...runs]
    .sort((left, right) => {
      const priorityDelta = baseRunPriority(right) - baseRunPriority(left);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt);
    })
    .slice(0, maxItems);
}

function deriveRunAttentionTone(run: RunListItem, observability?: PlatformObservability): RunAttentionItem['tone'] {
  const reviewDecision = summarizeReviewDecision(observability?.publicationSummaries[0], observability);

  if (run.status === 'blocked') {
    return 'error';
  }

  if (reviewDecision.status === 'follow-up-required' || reviewDecision.status === 'awaiting-decision') {
    return 'warning';
  }

  if (reviewDecision.status === 'accepted') {
    return 'success';
  }

  if (observability?.approvals.some((approval) => approval.status === 'requested')) {
    return 'warning';
  }

  if (observability?.attentionRequired.length) {
    return 'warning';
  }

  if (run.status === 'completed') {
    return 'success';
  }

  return 'info';
}

function deriveRunAttentionHeadline(run: RunListItem, observability?: PlatformObservability): string {
  const firstAttention = observability?.attentionRequired[0];
  if (firstAttention) {
    return firstAttention.title;
  }

  const reviewDecision = summarizeReviewDecision(observability?.publicationSummaries[0], observability);
  if (reviewDecision.status !== 'not-required') {
    return reviewDecision.headline;
  }

  if (run.status === 'blocked') {
    return 'Run blocked and needs intervention';
  }

  if (run.status === 'completed') {
    return 'Review packet ready';
  }

  return 'Autonomous loop is active';
}

function deriveRunAttentionDetail(run: RunListItem, observability?: PlatformObservability): string {
  const firstAttention = observability?.attentionRequired[0];
  if (firstAttention) {
    return firstAttention.description;
  }

  const reviewDecision = summarizeReviewDecision(observability?.publicationSummaries[0], observability);
  if (reviewDecision.status !== 'not-required') {
    return reviewDecision.detail;
  }

  if (run.status === 'completed') {
    return 'All visible stages are closed; operator review can focus on evidence and final acceptance.';
  }

  return `Current stage: ${run.currentStage ?? 'pending selection'}. System is still progressing inside the six-stage loop.`;
}

function deriveRunNextAction(run: RunListItem, observability?: PlatformObservability): string {
  const firstAttention = observability?.attentionRequired[0];
  if (firstAttention?.type === 'evaluator-reroute-requested') {
    return `从 ${formatStageLabel(firstAttention.repairTargetStage)} 继续流程`;
  }

  if (observability?.approvals.some((approval) => approval.status === 'requested')) {
    return 'Await human approval';
  }

  const reviewDecision = summarizeReviewDecision(observability?.publicationSummaries[0], observability);
  if (reviewDecision.nextAction) {
    return reviewDecision.nextAction;
  }

  if (observability?.repairSummaries.some((summary) => summary.status === 'blocked' || summary.status === 'failed')) {
    return 'Inspect blocked repair';
  }

  if (observability?.repairSummaries.some((summary) => summary.status !== 'succeeded')) {
    return 'Continue repair loop';
  }

  if (observability?.publicationSummaries.some((summary) => summary.status !== 'published')) {
    return 'Advance publication';
  }

  if (run.status === 'completed') {
    return 'Open review packet';
  }

  if (run.status === 'blocked') {
    return 'Open run and resolve blocker';
  }

  return 'Monitor active loop';
}

export function deriveRunAttentionItems(
  runs: RunListItem[],
  observabilityByRunId: Record<string, PlatformObservability | undefined>
): RunAttentionItem[] {
  return runs
    .map((run) => {
      const observability = observabilityByRunId[run.runId];
      const reviewDecision = summarizeReviewDecision(observability?.publicationSummaries[0], observability);
      const attentionCount = observability?.attentionRequired.length ?? 0;
      const tone = deriveRunAttentionTone(run, observability);
      let tonePriority = 0;
      if (tone === 'error') {
        tonePriority = 50;
      } else if (tone === 'warning') {
        tonePriority = 20;
      }

      let reviewDecisionPriority = 0;
      if (reviewDecision.status === 'follow-up-required') {
        reviewDecisionPriority = 35;
      } else if (reviewDecision.status === 'awaiting-decision') {
        reviewDecisionPriority = 25;
      } else if (reviewDecision.status === 'accepted') {
        reviewDecisionPriority = 10;
      }

      const priority = baseRunPriority(run) + attentionCount * 25 + tonePriority + reviewDecisionPriority;

      return {
        runId: run.runId,
        workflowName: run.workflowName,
        projectLabel: run.projectName ?? run.repositoryName,
        currentStage: run.currentStage,
        status: run.status,
        attentionCount,
        headline: deriveRunAttentionHeadline(run, observability),
        detail: deriveRunAttentionDetail(run, observability),
        nextAction: deriveRunNextAction(run, observability),
        updatedAt: run.updatedAt,
        tone,
        priority,
      };
    })
    .sort((left, right) => right.priority - left.priority || toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt));
}

export function RunAttentionPanel(
  props: Readonly<{
    items: RunAttentionItem[];
    onOpenRun: (runId: string) => void;
  }>
): JSX.Element {
  return (
    <article className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Attention Deck</p>
          <h3>Operator-priority runs</h3>
        </div>
        <span className="panel__hint">Prioritized from queue + observability</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {props.items.map((item) => (
          <button
            key={item.runId}
            type="button"
            onClick={() => props.onOpenRun(item.runId)}
            className="rounded-3xl p-4 text-left transition-transform duration-200 hover:-translate-y-0.5"
            style={{
              background: toneSurface(item.tone),
              border: `1px solid ${toneColor(item.tone)}22`,
              boxShadow: `0 0 0 1px ${toneColor(item.tone)}12`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.28)' }}>
                  {item.projectLabel}
                </p>
                <p className="text-[15px] font-medium mt-2" style={{ color: 'rgba(255,255,255,0.86)' }}>
                  {item.workflowName}
                </p>
              </div>
              <StatusPill value={item.status} />
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>
              <span>{item.currentStage ?? 'stage pending'}</span>
              <span>{item.attentionCount} attention</span>
            </div>

            <p className="mt-4 text-[13px] font-medium" style={{ color: toneColor(item.tone) }}>
              {item.headline}
            </p>
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {item.detail}
            </p>

            <div className="mt-4 rounded-2xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>
                Next Action
              </p>
              <p className="mt-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.72)' }}>
                {item.nextAction}
              </p>
            </div>

            <p className="mt-4 text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.24)' }}>
              Updated {formatTimestamp(item.updatedAt)}
            </p>
          </button>
        ))}
      </div>
    </article>
  );
}