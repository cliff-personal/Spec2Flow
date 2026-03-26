import { getControlPlaneBaseUrl, type PlatformObservability, type PlatformReviewDecisionStatus, type PlatformTaskRecord, type RunDetail, type RunListItem } from '../lib/control-plane-api';
import { formatStage, formatTimestamp } from '../lib/control-plane-formatters';
import { summarizeReviewDecision } from '../lib/review-decision-summary';
import type { RunOperatorAction } from '../lib/run-operator-actions';
import { OperatorActionBar } from './operator-action-bar';
import { deriveRunReadinessSignal } from './run-detail-panel';

export type ReviewPacketSummary = {
  runId: string;
  projectId: string | null;
  requirementTitle: string;
  requirementSummary: string;
  implementedFiles: string[];
  testFiles: string[];
  verifyCommands: string[];
  evidenceArtifacts: Array<{ artifactId: string; label: string; path: string; contentHref: string }>;
  repairAttempts: number;
  resolvedDefects: number;
  openDefects: number;
  publicationStatus: string;
  reviewDecision: PlatformReviewDecisionStatus;
  reviewDecisionLabel: string;
  reviewDecisionDetail: string;
  finalBranch: string;
  finalCommit: string;
  branchHref: string;
  branchCtaLabel: string;
  evidenceHref: string | null;
  nextAction: string;
  readinessStatus: string;
  readinessScore: number;
};

type ReviewPacketPanelProps = Readonly<{
  summary: ReviewPacketSummary;
  completedAt: string | null | undefined;
  operatorActions: RunOperatorAction[];
  isActionPending: boolean;
  errorMessage: string | null;
  onTaskAction: (taskId: string, action: 'retry' | 'approve' | 'reject', note?: string) => void;
  onRunAction: (action: 'pause' | 'resume') => void;
}>;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function artifactLabel(kind: string): string {
  return kind.replaceAll('-', ' ');
}

function classifyTestFile(path: string): boolean {
  return /(^|\/)(test|tests|spec|__tests__)\b/i.test(path) || /\.(test|spec)\./i.test(path);
}

export function deriveReviewPacketSummary(
  runDetail: RunDetail,
  observability: PlatformObservability | undefined,
  tasks: PlatformTaskRecord[],
  runListItem?: RunListItem
): ReviewPacketSummary {
  const readiness = deriveRunReadinessSignal(runDetail, observability, tasks);
  const targetFiles = unique(tasks.flatMap((task) => task.targetFiles ?? []));
  const implementedFiles = targetFiles.filter((path) => !classifyTestFile(path));
  const testFiles = targetFiles.filter(classifyTestFile);
  const verifyCommands = unique(tasks.flatMap((task) => task.verifyCommands ?? []));
  const evidenceArtifacts = runDetail.runState.artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    label: artifactLabel(artifact.kind),
    path: artifact.path,
    contentHref: `${getControlPlaneBaseUrl()}/api/artifacts/${encodeURIComponent(artifact.artifactId)}/content`,
  }));
  const repairAttempts = observability?.repairSummaries.length ?? 0;
  const resolvedDefects = observability?.repairSummaries.filter((summary) => summary.status === 'succeeded').length ?? 0;
  const openDefects = (observability?.repairSummaries.filter((summary) => summary.status !== 'succeeded').length ?? 0)
    + (observability?.attentionRequired.length ?? 0);
  const latestPublication = observability?.publicationSummaries[0];
  const reviewDecision = summarizeReviewDecision(latestPublication, observability);
  const finalBranch = runDetail.runState.workspace?.branchName ?? 'n/a';
  const finalCommit = latestPublication?.commitSha ?? 'pending';
  const branchHref = latestPublication?.prUrl ?? `/runs/${runDetail.runState.run.runId}`;
  const branchCtaLabel = latestPublication?.prUrl ? 'Open Branch / PR' : 'Open Run Detail';
  const evidenceHref = evidenceArtifacts[0]?.contentHref ?? null;

  return {
    runId: runDetail.runState.run.runId,
    projectId: runDetail.runState.project?.projectId ?? null,
    requirementTitle: runListItem?.requirement?.trim() || runDetail.runState.run.workflowName,
    requirementSummary: runListItem?.requirement?.trim()
      || `Workflow ${runDetail.runState.run.workflowName} completed through ${formatStage(runDetail.runState.run.currentStage) || 'the full pipeline'}.`,
    implementedFiles,
    testFiles,
    verifyCommands,
    evidenceArtifacts,
    repairAttempts,
    resolvedDefects,
    openDefects,
    publicationStatus: latestPublication?.status ?? 'not-published',
    reviewDecision: reviewDecision.status,
    reviewDecisionLabel: reviewDecision.label,
    reviewDecisionDetail: reviewDecision.detail,
    finalBranch,
    finalCommit,
    branchHref,
    branchCtaLabel,
    evidenceHref,
    nextAction: readiness.nextAction,
    readinessStatus: readiness.status,
    readinessScore: readiness.score,
  };
}

export function ReviewPacketPanel(props: ReviewPacketPanelProps): JSX.Element {
  return (
    <div className="page-stack">
      <section className="grid grid--two-large">
        <article className="panel panel--tall">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Requirement Summary</p>
              <h3>Review-ready delivery narrative</h3>
            </div>
            <span className="panel__hint">Completed {formatTimestamp(props.completedAt)}</span>
          </div>

          <div className="rounded-3xl px-4 py-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[18px] font-medium" style={{ color: 'rgba(255,255,255,0.88)' }}>{props.summary.requirementTitle}</p>
            <p className="text-[13px] mt-3 leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{props.summary.requirementSummary}</p>
            <div className="flex gap-3 flex-wrap mt-4">
              <a
                className="hero-link"
                href={props.summary.branchHref}
                target={props.summary.branchHref.startsWith('http') ? '_blank' : undefined}
                rel={props.summary.branchHref.startsWith('http') ? 'noreferrer' : undefined}
              >
                {props.summary.branchCtaLabel}
              </a>
              {props.summary.evidenceHref ? (
                <a className="hero-link" href={props.summary.evidenceHref} rel="noreferrer" target="_blank">
                  Open Evidence
                </a>
              ) : null}
            </div>
          </div>

          <dl className="detail-list mt-4">
            <div>
              <dt>Readiness</dt>
              <dd>{props.summary.readinessStatus}</dd>
            </div>
            <div>
              <dt>Autonomy Score</dt>
              <dd>{props.summary.readinessScore}</dd>
            </div>
            <div>
              <dt>Publication</dt>
              <dd>{props.summary.publicationStatus}</dd>
            </div>
            <div>
              <dt>Review Decision</dt>
              <dd>{props.summary.reviewDecisionLabel}</dd>
            </div>
            <div>
              <dt>Final Branch</dt>
              <dd>{props.summary.finalBranch}</dd>
            </div>
            <div>
              <dt>Final Commit</dt>
              <dd>{props.summary.finalCommit}</dd>
            </div>
            <div>
              <dt>Next Action</dt>
              <dd>{props.summary.nextAction}</dd>
            </div>
          </dl>

          <div className="rounded-3xl px-4 py-4 mt-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>Final Review Decision</p>
            <p className="text-[18px] font-medium mt-2" style={{ color: 'rgba(255,255,255,0.84)' }}>{props.summary.reviewDecisionLabel}</p>
            <p className="text-[12px] mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{props.summary.reviewDecisionDetail}</p>
          </div>

          <OperatorActionBar
            title="Resolve Or Advance"
            hint="This is now the final sign-off surface: accept the result, request follow-up, or jump straight into evidence."
            actions={props.operatorActions}
            isPending={props.isActionPending}
            errorMessage={props.errorMessage}
            onTaskAction={props.onTaskAction}
            onRunAction={props.onRunAction}
          />
        </article>

        <article className="panel panel--tall" id="evidence">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Delivery Evidence</p>
              <h3>Code, tests, defects, and artifacts</h3>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-3xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>Implemented Files</p>
              <p className="text-[22px] font-medium mt-2" style={{ color: 'rgba(255,255,255,0.86)' }}>{props.summary.implementedFiles.length}</p>
            </div>
            <div className="rounded-3xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>Tests Added/Changed</p>
              <p className="text-[22px] font-medium mt-2" style={{ color: 'rgba(255,255,255,0.86)' }}>{props.summary.testFiles.length}</p>
            </div>
            <div className="rounded-3xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>Defect Loop</p>
              <p className="text-[22px] font-medium mt-2" style={{ color: 'rgba(255,255,255,0.86)' }}>{props.summary.resolvedDefects} resolved / {props.summary.openDefects} open</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 mt-4">
            <div className="rounded-3xl px-4 py-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[10px] tracking-[0.18em] uppercase mb-3" style={{ color: 'rgba(255,255,255,0.24)' }}>Implemented Files</p>
              <div className="flex flex-col gap-2">
                {props.summary.implementedFiles.slice(0, 8).map((path) => (
                  <p key={path} className="text-[12px] break-all" style={{ color: 'rgba(255,255,255,0.62)' }}>{path}</p>
                ))}
                {props.summary.implementedFiles.length === 0 ? <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.34)' }}>No explicit target files recorded.</p> : null}
              </div>
            </div>

            <div className="rounded-3xl px-4 py-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[10px] tracking-[0.18em] uppercase mb-3" style={{ color: 'rgba(255,255,255,0.24)' }}>Tests And Verify Commands</p>
              <div className="flex flex-col gap-2">
                {props.summary.testFiles.slice(0, 6).map((path) => (
                  <p key={path} className="text-[12px] break-all" style={{ color: 'rgba(255,255,255,0.62)' }}>{path}</p>
                ))}
                {props.summary.verifyCommands.slice(0, 4).map((command) => (
                  <p key={command} className="text-[12px] break-all" style={{ color: 'rgba(99,231,255,0.72)' }}>{command}</p>
                ))}
                {props.summary.testFiles.length === 0 && props.summary.verifyCommands.length === 0 ? (
                  <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.34)' }}>No explicit test files or verify commands recorded.</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-3xl px-4 py-4 mt-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[10px] tracking-[0.18em] uppercase mb-3" style={{ color: 'rgba(255,255,255,0.24)' }}>Evidence Artifacts</p>
            <div className="flex flex-col gap-2">
              {props.summary.evidenceArtifacts.slice(0, 10).map((artifact) => (
                <div key={artifact.artifactId} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.72)' }}>{artifact.label}</p>
                    <p className="text-[11px] break-all" style={{ color: 'rgba(255,255,255,0.42)' }}>{artifact.path}</p>
                  </div>
                  <a className="hero-link" href={artifact.contentHref} rel="noreferrer" target="_blank">
                    Open
                  </a>
                </div>
              ))}
              {props.summary.evidenceArtifacts.length === 0 ? <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.34)' }}>No artifacts attached to this run.</p> : null}
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}