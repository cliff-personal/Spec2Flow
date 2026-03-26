import type { PlatformObservability, PlatformTaskRecord, RunDetail } from '../lib/control-plane-api';
import { formatStage } from '../lib/control-plane-formatters';
import type { RunActionType } from '../lib/control-plane-ui-types';
import type { RunOperatorAction } from '../lib/run-operator-actions';
import { OperatorActionBar } from './operator-action-bar';
import { StatusPill } from './status-pill';

export type RunReadinessSignal = {
  score: number;
  status: 'review-ready' | 'attention-required' | 'blocked' | 'in-flight';
  headline: string;
  detail: string;
  nextAction: string;
};

export type EvaluatorRepairRouteSignal = {
  taskId: string;
  summary: string | null;
  targetStage: NonNullable<PlatformTaskRecord['requestedRepairTargetStage']>;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function isOpenTaskStatus(status: string): boolean {
  return ['pending', 'ready', 'leased', 'in-progress', 'running', 'blocked'].includes(status);
}

function readinessTone(status: RunReadinessSignal['status']): { color: string; background: string } {
  if (status === 'review-ready') {
    return { color: 'rgba(74,222,128,0.92)', background: 'rgba(74,222,128,0.08)' };
  }

  if (status === 'blocked') {
    return { color: 'rgba(255,120,120,0.92)', background: 'rgba(255,120,120,0.08)' };
  }

  if (status === 'attention-required') {
    return { color: 'rgba(255,196,98,0.92)', background: 'rgba(255,196,98,0.08)' };
  }

  return { color: 'rgba(0,240,255,0.86)', background: 'rgba(0,240,255,0.08)' };
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function deriveEvaluatorRepairRoute(tasks: PlatformTaskRecord[]): EvaluatorRepairRouteSignal | null {
  const candidate = [...tasks]
    .filter((task) => task.stage === 'evaluation' && task.evaluationDecision === 'needs-repair' && task.requestedRepairTargetStage)
    .sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt))[0];

  if (!candidate?.requestedRepairTargetStage) {
    return null;
  }

  return {
    taskId: candidate.taskId,
    summary: candidate.evaluationSummary ?? null,
    targetStage: candidate.requestedRepairTargetStage
  };
}

export function deriveRunReadinessSignal(
  runDetail: RunDetail | undefined,
  observability: PlatformObservability | undefined,
  tasks: PlatformTaskRecord[]
): RunReadinessSignal {
  if (!runDetail) {
    return {
      score: 0,
      status: 'in-flight',
      headline: 'Loading run state',
      detail: 'Run detail is still loading from the control plane.',
      nextAction: 'Wait for snapshot',
    };
  }

  const run = runDetail.runState.run;
  const attentionCount = observability?.attentionRequired.length ?? 0;
  const pendingApprovals = observability?.approvals.filter((approval) => approval.status === 'requested').length ?? 0;
  const hardBlockedApprovals = observability?.approvals.filter(
    (approval) => approval.status === 'blocked' || approval.status === 'rejected'
  ).length ?? 0;
  const blockedRepairs = observability?.repairSummaries.filter(
    (summary) => summary.status === 'blocked' || summary.status === 'failed'
  ).length ?? 0;
  const missingArtifacts = observability?.taskSummaries.reduce(
    (sum, summary) => sum + summary.missingExpectedArtifactCount,
    0
  ) ?? 0;
  const openTasks = tasks.filter((task) => isOpenTaskStatus(task.status)).length;

  let score = 100;
  if (run.status !== 'completed') {
    score -= 20;
  }

  score -= attentionCount * 8;
  score -= pendingApprovals * 18;
  score -= hardBlockedApprovals * 28;
  score -= blockedRepairs * 20;
  score -= missingArtifacts * 10;
  score -= openTasks * 4;

  const normalizedScore = clampScore(score);

  if (hardBlockedApprovals > 0 || run.status === 'blocked') {
    return {
      score: normalizedScore,
      status: 'blocked',
      headline: 'Run is blocked before handoff',
      detail: hardBlockedApprovals > 0
        ? 'Approval or publication gates are explicitly blocking this run.'
        : 'The delivery loop is blocked and cannot reach a review-ready handoff yet.',
      nextAction: pendingApprovals > 0 ? 'Review approval gate' : 'Open blocker and resolve it',
    };
  }

  if (pendingApprovals > 0 || blockedRepairs > 0 || attentionCount > 0 || missingArtifacts > 0) {
    let detail = 'The run still has open signals before it is safe to hand off for review.';
    let nextAction = 'Inspect attention signals';

    if (pendingApprovals > 0) {
      detail = 'The run is waiting for human approval before publication or final handoff.';
      nextAction = 'Approve or reject publication';
    } else if (blockedRepairs > 0) {
      detail = 'Auto-repair has not fully closed the defect loop.';
      nextAction = 'Inspect blocked repair path';
    } else if (missingArtifacts > 0) {
      detail = 'The run finished with missing expected artifacts, so the review packet is incomplete.';
      nextAction = 'Inspect evidence gaps';
    }

    return {
      score: normalizedScore,
      status: 'attention-required',
      headline: 'Run needs operator attention before handoff',
      detail,
      nextAction,
    };
  }

  if (run.status === 'completed') {
    return {
      score: normalizedScore,
      status: 'review-ready',
      headline: 'Run is ready for final review',
      detail: 'Stage progression, evidence, and delivery signals are closed enough to hand off to a human reviewer.',
      nextAction: 'Open review packet',
    };
  }

  return {
    score: normalizedScore,
    status: 'in-flight',
    headline: 'Run is still executing autonomously',
    detail: 'The six-stage loop is still active, so review readiness is not final yet.',
    nextAction: 'Monitor active stage',
  };
}

export function RunDetailPanel(
  props: Readonly<{
    runDetail: RunDetail | undefined;
    observability: PlatformObservability | undefined;
    tasks: PlatformTaskRecord[];
    operatorActions: RunOperatorAction[];
    isActionPending: boolean;
    errorMessage: string | null;
    onTaskAction: (taskId: string, action: 'retry' | 'approve' | 'reject', note?: string) => void;
    onRunAction: (action: RunActionType) => void;
  }>
): JSX.Element {
  const readiness = deriveRunReadinessSignal(props.runDetail, props.observability, props.tasks);
  const evaluatorRepairRoute = deriveEvaluatorRepairRoute(props.tasks);
  const tone = readinessTone(readiness.status);

  return (
    <article className="panel panel--tall">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Run Summary</p>
          <h3>Branch, workspace, and delivery state</h3>
        </div>
        <StatusPill value={props.runDetail?.runState.run.status} />
      </div>

      {props.errorMessage ? <p className="error-text">{props.errorMessage}</p> : null}
      <div className="grid gap-3 md:grid-cols-3 mb-4">
        <div className="rounded-3xl px-4 py-3" style={{ background: tone.background, border: `1px solid ${tone.color}22` }}>
          <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>Autonomy Score</p>
          <p className="text-[24px] font-medium mt-2" style={{ color: tone.color }}>{readiness.score}</p>
          <p className="text-[11px] mt-2" style={{ color: 'rgba(255,255,255,0.46)' }}>0-100 confidence for autonomous handoff readiness</p>
        </div>
        <div className="rounded-3xl px-4 py-3" style={{ background: tone.background, border: `1px solid ${tone.color}22` }}>
          <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>Handoff Readiness</p>
          <p className="text-[18px] font-medium mt-2" style={{ color: tone.color }}>{readiness.status}</p>
          <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.46)' }}>{readiness.headline}</p>
        </div>
        <div className="rounded-3xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>Next Action</p>
          <p className="text-[18px] font-medium mt-2" style={{ color: 'rgba(255,255,255,0.82)' }}>{readiness.nextAction}</p>
          <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.46)' }}>{readiness.detail}</p>
        </div>
      </div>

      {evaluatorRepairRoute ? (
        <div className="rounded-3xl px-4 py-3 mb-4" style={{ background: 'rgba(255,196,98,0.08)', border: '1px solid rgba(255,196,98,0.22)' }}>
          <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>Evaluator Repair Route</p>
          <p className="text-[18px] font-medium mt-2" style={{ color: 'rgba(255,196,98,0.92)' }}>
            needs-repair {'->'} {formatStage(evaluatorRepairRoute.targetStage)}
          </p>
          <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.46)' }}>
            {evaluatorRepairRoute.summary ?? `Task ${evaluatorRepairRoute.taskId} asked the controller to route repair back to ${formatStage(evaluatorRepairRoute.targetStage)}.`}
          </p>
        </div>
      ) : null}

      {props.runDetail ? (
        <dl className="detail-list">
          <div>
            <dt>Run ID</dt>
            <dd>{props.runDetail.runState.run.runId}</dd>
          </div>
          <div>
            <dt>Workflow</dt>
            <dd>{props.runDetail.runState.run.workflowName}</dd>
          </div>
          <div>
            <dt>Current Stage</dt>
            <dd>{formatStage(props.runDetail.runState.run.currentStage)}</dd>
          </div>
          <div>
            <dt>Risk</dt>
            <dd>{props.runDetail.runState.run.riskLevel ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{props.runDetail.runState.project?.name ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Workspace Root</dt>
            <dd>{props.runDetail.runState.workspace?.workspaceRootPath ?? props.runDetail.runState.project?.workspaceRootPath ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Branch</dt>
            <dd>{props.runDetail.runState.workspace?.branchName ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Worktree</dt>
            <dd>{props.runDetail.runState.workspace?.worktreePath ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Provisioning</dt>
            <dd>{props.runDetail.runState.workspace?.provisioningStatus ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Evaluator Route</dt>
            <dd>{evaluatorRepairRoute ? `needs-repair -> ${formatStage(evaluatorRepairRoute.targetStage)}` : 'n/a'}</dd>
          </div>
          <div>
            <dt>Write Scope</dt>
            <dd>{props.runDetail.runState.workspace?.workspacePolicy.allowedWriteGlobs.length ?? 0} globs</dd>
          </div>
        </dl>
      ) : (
        <p>Select a run to load detail.</p>
      )}

      <OperatorActionBar
        title="Actionable Next Step"
        hint="These controls are derived from run readiness, approval state, repair state, and evidence completeness."
        actions={props.operatorActions}
        isPending={props.isActionPending}
        errorMessage={props.errorMessage}
        onTaskAction={props.onTaskAction}
        onRunAction={props.onRunAction}
      />
    </article>
  );
}
