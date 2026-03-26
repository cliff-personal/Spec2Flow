import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HeroPanel } from '../components/hero-panel';
import { ReviewPacketPanel, deriveReviewPacketSummary } from '../components/review-packet-panel';
import { useControlPlaneRunDetailPage } from '../hooks/use-control-plane-run-detail-page';
import { listRuns } from '../lib/control-plane-api';
import { deriveRunOperatorActions } from '../lib/run-operator-actions';

export function ControlPlaneReviewPacketPage(): JSX.Element {
  const { runId = '' } = useParams<{ runId: string }>();
  const runDetailPage = useControlPlaneRunDetailPage(runId);
  const runsQuery = useQuery({
    queryKey: ['control-plane', 'runs', 'review-packet'],
    queryFn: listRuns,
    retry: false,
  });

  const runListItem = (runsQuery.data ?? []).find((run) => run.runId === runId);
  const runDetail = runDetailPage.runDetailQuery.data;
  const observability = runDetailPage.observabilityQuery.data;
  const tasks = runDetailPage.tasksQuery.data ?? [];
  const operatorActions = deriveRunOperatorActions(runDetail, observability, tasks, { surface: 'review-packet' });
  let actionErrorMessage: string | null = null;
  if (runDetailPage.actionMutation.isError) {
    actionErrorMessage = runDetailPage.actionMutation.error.message;
  } else if (runDetailPage.runActionMutation.isError) {
    actionErrorMessage = runDetailPage.runActionMutation.error.message;
  }

  if (!runDetail) {
    return (
      <div className="page-stack">
        <HeroPanel
          eyebrow="Review Packet"
          title="Loading review packet"
          description="The review packet is assembling from run detail, observability, and evidence artifacts."
          action={
            <Link className="hero-link" to={`/runs/${runId}`}>
              Back to Run Detail
            </Link>
          }
          statusItems={[
            { label: 'Run ID', value: runId || 'missing' },
            { label: 'State', value: 'loading' },
          ]}
        />
      </div>
    );
  }

  const summary = deriveReviewPacketSummary(runDetail, observability, tasks, runListItem);

  return (
    <div className="page-stack">
      <HeroPanel
        eyebrow="Review Packet"
        title="Human handoff and final delivery packet"
        description="This surface compresses one autonomous delivery run into a final review narrative: requirement, changed files, verification, defect closure, publication state, and evidence links."
        action={
          <div className="flex gap-3 flex-wrap">
            <Link className="hero-link" to={`/runs/${runId}`}>
              Back to Run Detail
            </Link>
            <Link className="hero-link" to="/runs">
              Queue
            </Link>
          </div>
        }
        statusItems={[
          { label: 'Run ID', value: runId },
          { label: 'Readiness', value: summary.readinessStatus },
          { label: 'Autonomy Score', value: String(summary.readinessScore) },
          { label: 'Review Decision', value: summary.reviewDecisionLabel },
        ]}
      />

      <ReviewPacketPanel
        summary={summary}
        completedAt={runDetail.runState.run.completedAt ?? runListItem?.completedAt}
        operatorActions={operatorActions}
        isActionPending={runDetailPage.actionMutation.isPending || runDetailPage.runActionMutation.isPending}
        errorMessage={actionErrorMessage}
        onTaskAction={runDetailPage.triggerTaskAction}
        onRunAction={runDetailPage.triggerRunAction}
      />
    </div>
  );
}