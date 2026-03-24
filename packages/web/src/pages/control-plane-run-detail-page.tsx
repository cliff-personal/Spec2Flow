import { useDeferredValue } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DagPreviewPanel } from '../components/dag-preview-panel';
import { ArtifactDetailPanel } from '../components/artifact-detail-panel';
import { EventTimelinePanel } from '../components/event-timeline-panel';
import { HeroPanel } from '../components/hero-panel';
import { ObservabilityPanel } from '../components/observability-panel';
import { RunDetailPanel } from '../components/run-detail-panel';
import { TaskActionsPanel } from '../components/task-actions-panel';
import { TaskDetailPanel } from '../components/task-detail-panel';
import { TaskSnapshotPanel } from '../components/task-snapshot-panel';
import { useControlPlaneRunDetailPage } from '../hooks/use-control-plane-run-detail-page';

export function ControlPlaneRunDetailPage(): JSX.Element {
  const { runId = '' } = useParams<{ runId: string }>();
  const runDetailPage = useControlPlaneRunDetailPage(runId);
  const deferredTasks = useDeferredValue(runDetailPage.tasksQuery.data ?? []);

  return (
    <>
      <HeroPanel
        eyebrow="Run Detail"
        title="Inspect one run as the source of truth"
        description="This route is the operator detail surface for a single run. It owns observability, task actions, DAG inspection, and task snapshot views for the selected run id."
        action={
          <Link className="hero-link" to="/runs">
            Back to runs
          </Link>
        }
        statusItems={[
          {
            label: 'Run ID',
            value: runId || 'missing'
          },
          {
            label: 'Run status',
            value: runDetailPage.runDetailQuery.data?.runState.run.status ?? 'loading'
          },
          {
            label: 'Last action',
            value: runDetailPage.actionMessage ?? 'none'
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

      <section className="grid grid--two-equal">
        <TaskDetailPanel
          tasks={deferredTasks}
          taskSummaries={runDetailPage.observabilityQuery.data?.taskSummaries ?? []}
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
    </>
  );
}