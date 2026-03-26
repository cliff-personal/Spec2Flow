import { useDeferredValue, useEffect, useState } from 'react';
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
import { deriveRunOperatorActions } from '../lib/run-operator-actions';

export function ControlPlaneRunDetailPage(): JSX.Element {
  const { runId = '' } = useParams<{ runId: string }>();
  const runDetailPage = useControlPlaneRunDetailPage(runId);
  const deferredTasks = useDeferredValue(runDetailPage.tasksQuery.data ?? []);
  const runSummary = runDetailPage.runDetailQuery.data?.runState.run;
  const runWorkspace = runDetailPage.runDetailQuery.data?.runState.workspace;
  const runProject = runDetailPage.runDetailQuery.data?.runState.project;
  const attentionCount = runDetailPage.observabilityQuery.data?.attentionRequired.length ?? 0;
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const operatorActions = deriveRunOperatorActions(
    runDetailPage.runDetailQuery.data,
    runDetailPage.observabilityQuery.data,
    deferredTasks,
  );
  let actionErrorMessage: string | null = null;
  if (runDetailPage.actionMutation.isError) {
    actionErrorMessage = runDetailPage.actionMutation.error.message;
  } else if (runDetailPage.runActionMutation.isError) {
    actionErrorMessage = runDetailPage.runActionMutation.error.message;
  } else if (runDetailPage.runDetailQuery.isError) {
    actionErrorMessage = runDetailPage.runDetailQuery.error.message;
  }

  const allTimeline = runDetailPage.observabilityQuery.data?.timeline ?? [];
  const filteredTimeline = selectedStage
    ? allTimeline.filter((e) => deferredTasks.some((t) => t.stage === selectedStage && t.taskId === e.taskId))
    : allTimeline;

  useEffect(() => {
    if (selectedStage) {
      return;
    }

    const defaultStage = runSummary?.currentStage ?? deferredTasks[0]?.stage ?? null;
    if (defaultStage) {
      setSelectedStage(defaultStage);
    }
  }, [deferredTasks, runSummary?.currentStage, selectedStage]);

  return (
    <div className="page-stack">
      <HeroPanel
        eyebrow="Run Detail"
        title={runProject ? `${runProject.name} autonomous delivery run` : 'Inspect one run as the source of truth'}
        description="This is the operator detail surface for one autonomous delivery run. It shows stage progression, task evidence, defects, execution history, and final review readiness without forcing the operator to read raw JSON."
        action={
          <div className="flex gap-3 flex-wrap">
            <Link className="hero-link" to="/runs">
              Back to Queue
            </Link>
            <Link className="hero-link" to={`/runs/${runId}/review`}>
              Review Packet
            </Link>
          </div>
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
          observability={runDetailPage.observabilityQuery.data}
          tasks={deferredTasks}
          operatorActions={operatorActions}
          isActionPending={runDetailPage.actionMutation.isPending || runDetailPage.runActionMutation.isPending}
          errorMessage={actionErrorMessage}
          onTaskAction={runDetailPage.triggerTaskAction}
          onRunAction={runDetailPage.triggerRunAction}
        />
        <ObservabilityPanel observability={runDetailPage.observabilityQuery.data} />
        <TaskActionsPanel
          tasks={deferredTasks}
          isPending={runDetailPage.actionMutation.isPending || runDetailPage.runActionMutation.isPending}
          errorMessage={runDetailPage.actionMutation.isError ? runDetailPage.actionMutation.error.message : null}
          onTaskAction={runDetailPage.triggerTaskAction}
        />
      </section>

      <section className="grid">
        <RunStageProgressPanel
          tasks={deferredTasks}
          selectedStage={selectedStage}
          onStageSelect={setSelectedStage}
        />
      </section>

      <section className="grid grid--two-equal" id="evidence">
        <TaskDetailPanel
          tasks={deferredTasks}
          taskSummaries={runDetailPage.observabilityQuery.data?.taskSummaries ?? []}
          artifacts={runDetailPage.runDetailQuery.data?.runState.artifacts ?? []}
          filterStage={selectedStage}
        />
        <ArtifactDetailPanel
          artifacts={runDetailPage.runDetailQuery.data?.runState.artifacts ?? []}
          tasks={deferredTasks}
        />
      </section>

      <section className="grid">
        <EventTimelinePanel timeline={filteredTimeline} />
      </section>

      <section className="grid grid--two-large" id="graph">
        <DagPreviewPanel tasks={deferredTasks} />
        <TaskSnapshotPanel tasks={deferredTasks} isSuccess={runDetailPage.tasksQuery.isSuccess} />
      </section>
    </div>
  );
}
