import { useDeferredValue } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DagPreviewPanel } from '../components/dag-preview-panel';
import { ArtifactDetailPanel } from '../components/artifact-detail-panel';
import { EventTimelinePanel } from '../components/event-timeline-panel';
import { HeroPanel } from '../components/hero-panel';
import { ObservabilityPanel } from '../components/observability-panel';
import { RunDetailPanel } from '../components/run-detail-panel';
import { RunStageProgressPanel } from '../components/run-stage-progress-panel';
import { TaskActionsPanel } from '../components/task-actions-panel';
import { TaskDetailPanel } from '../components/task-detail-panel';
import { TaskSnapshotPanel } from '../components/task-snapshot-panel';
import { useControlPlaneRunDetailPage } from '../hooks/use-control-plane-run-detail-page';

export function ControlPlaneRunDetailPage(): JSX.Element {
  const { runId = '' } = useParams<{ runId: string }>();
  const runDetailPage = useControlPlaneRunDetailPage(runId);
  const deferredTasks = useDeferredValue(runDetailPage.tasksQuery.data ?? []);
  const runSummary = runDetailPage.runDetailQuery.data?.runState.run;
  const runWorkspace = runDetailPage.runDetailQuery.data?.runState.workspace;
  const runProject = runDetailPage.runDetailQuery.data?.runState.project;
  const attentionCount = runDetailPage.observabilityQuery.data?.attentionRequired.length ?? 0;

  return (
    <div className="page-stack">
      <HeroPanel
        eyebrow="Run Detail"
        title={runProject ? `${runProject.name} autonomous delivery run` : 'Inspect one run as the source of truth'}
        description="This is the operator detail surface for one autonomous delivery run. It shows stage progression, task evidence, defects, execution history, and final review readiness without forcing the operator to read raw JSON."
        action={
          <Link className="hero-link" to="/runs">
            Back to Queue
          </Link>
        }
        statusItems={[
          {
            label: 'Run ID',
            value: runId || 'missing'
          },
          {
            label: 'Current Stage',
            value: runSummary?.currentStage ?? 'loading'
          },
          {
            label: 'Branch',
            value: runWorkspace?.branchName ?? 'provisioning'
          },
          {
            label: 'Attention',
            value: attentionCount > 0 ? String(attentionCount) : (runDetailPage.actionMessage ?? 'steady')
          }
        ]}
      />

      <section className="grid grid--three" id="detail">
        <RunDetailPanel
          runDetail={runDetailPage.runDetailQuery.data}
          errorMessage={runDetailPage.runDetailQuery.isError ? runDetailPage.runDetailQuery.error.message : null}
        />
        <ObservabilityPanel observability={runDetailPage.observabilityQuery.data} />
        <TaskActionsPanel
          tasks={deferredTasks}
          isPending={runDetailPage.actionMutation.isPending}
          errorMessage={runDetailPage.actionMutation.isError ? runDetailPage.actionMutation.error.message : null}
          onTaskAction={runDetailPage.triggerTaskAction}
        />
      </section>

      <section className="grid">
        <RunStageProgressPanel tasks={deferredTasks} />
      </section>

      <section className="grid grid--two-equal">
        <TaskDetailPanel
          tasks={deferredTasks}
          taskSummaries={runDetailPage.observabilityQuery.data?.taskSummaries ?? []}
          artifacts={runDetailPage.runDetailQuery.data?.runState.artifacts ?? []}
        />
        <ArtifactDetailPanel
          artifacts={runDetailPage.runDetailQuery.data?.runState.artifacts ?? []}
          tasks={deferredTasks}
        />
      </section>

      <section className="grid">
        <EventTimelinePanel timeline={runDetailPage.observabilityQuery.data?.timeline ?? []} />
      </section>

      <section className="grid grid--two-large" id="graph">
        <DagPreviewPanel tasks={deferredTasks} />
        <TaskSnapshotPanel tasks={deferredTasks} isSuccess={runDetailPage.tasksQuery.isSuccess} />
      </section>
    </div>
  );
}
