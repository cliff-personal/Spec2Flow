import { useEffect, useState } from 'react';
import type { PlatformArtifactRecord, PlatformTaskObservabilitySummary, PlatformTaskRecord } from '../lib/control-plane-api';
import { formatStage, formatTimestamp } from '../lib/control-plane-formatters';
import { StatusPill } from './status-pill';

type TaskDetailTab = 'summary' | 'artifacts' | 'tests' | 'events' | 'tokens';

const TAB_LABELS: Record<TaskDetailTab, string> = {
  summary: 'Summary',
  artifacts: 'Artifacts',
  tests: 'Test Cases',
  events: 'Defects & Events',
  tokens: 'Token Pulse'
};

function pickDefaultTask(tasks: PlatformTaskRecord[]): string | null {
  const preferredTask = tasks.find((task) => ['in-progress', 'leased', 'ready', 'blocked'].includes(task.status)) ?? tasks[0];
  return preferredTask?.taskId ?? null;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

export function TaskDetailPanel(
  props: Readonly<{
    tasks: PlatformTaskRecord[];
    taskSummaries: PlatformTaskObservabilitySummary[];
    artifacts: PlatformArtifactRecord[];
  }>
): JSX.Element {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(pickDefaultTask(props.tasks));
  const [selectedTab, setSelectedTab] = useState<TaskDetailTab>('summary');

  useEffect(() => {
    if (!selectedTaskId && props.tasks[0]) {
      setSelectedTaskId(pickDefaultTask(props.tasks));
      return;
    }

    if (selectedTaskId && !props.tasks.some((task) => task.taskId === selectedTaskId)) {
      setSelectedTaskId(pickDefaultTask(props.tasks));
    }
  }, [props.tasks, selectedTaskId]);

  useEffect(() => {
    setSelectedTab('summary');
  }, [selectedTaskId]);

  const selectedTask = props.tasks.find((task) => task.taskId === selectedTaskId) ?? null;
  const selectedSummary = props.taskSummaries.find((summary) => summary.taskId === selectedTaskId) ?? null;
  const selectedArtifacts = props.artifacts.filter((artifact) => artifact.taskId === selectedTaskId);
  const defectEvents = (selectedSummary?.recentEvents ?? []).filter((event) => event.category === 'repair' || event.type.includes('defect'));

  return (
    <article className="panel panel--tall">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Task Detail</p>
          <h3>One task, real operator context</h3>
        </div>
        {selectedTask ? <StatusPill value={selectedTask.status} /> : null}
      </div>

      {props.tasks.length === 0 ? (
        <p>No task records available for this run.</p>
      ) : (
        <div className="detail-split-panel">
          <div className="detail-split-panel__list">
            {props.tasks.map((task) => (
              <button
                key={task.taskId}
                className={`detail-selector ${task.taskId === selectedTaskId ? 'detail-selector--active' : ''}`}
                onClick={() => setSelectedTaskId(task.taskId)}
                type="button"
              >
                <strong>{task.title}</strong>
                <span>{formatStage(task.stage)}</span>
              </button>
            ))}
          </div>

          <div className="detail-split-panel__body">
            {selectedTask ? (
              <>
                <dl className="detail-list">
                  <div>
                    <dt>Task ID</dt>
                    <dd>{selectedTask.taskId}</dd>
                  </div>
                  <div>
                    <dt>Goal</dt>
                    <dd>{selectedTask.goal}</dd>
                  </div>
                  <div>
                    <dt>Executor</dt>
                    <dd>{selectedTask.executorType}</dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>{selectedSummary?.attempts ?? selectedTask.attempts ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Retries</dt>
                    <dd>{selectedSummary?.retryCount ?? selectedTask.retryCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Auto Repair</dt>
                    <dd>{selectedSummary?.autoRepairCount ?? selectedTask.autoRepairCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Artifacts</dt>
                    <dd>
                      {selectedSummary?.artifactCount ?? selectedArtifacts.length} / {selectedSummary?.expectedArtifactCount ?? selectedTask.roleProfile?.expectedArtifacts.length ?? 0}
                    </dd>
                  </div>
                  <div>
                    <dt>Lease Owner</dt>
                    <dd>{selectedSummary?.leasedByWorkerId ?? selectedTask.leasedByWorkerId ?? 'unclaimed'}</dd>
                  </div>
                  <div>
                    <dt>Lease Expiry</dt>
                    <dd>{formatTimestamp(selectedSummary?.leaseExpiresAt ?? selectedTask.leaseExpiresAt)}</dd>
                  </div>
                </dl>

                <div className="tab-strip" role="tablist" aria-label="Task detail tabs">
                  {(['summary', 'artifacts', 'tests', 'events', 'tokens'] as TaskDetailTab[]).map((tab) => (
                    <button
                      key={tab}
                      className={`tab-chip ${selectedTab === tab ? 'tab-chip--active' : ''}`}
                      onClick={() => setSelectedTab(tab)}
                      type="button"
                    >
                      {TAB_LABELS[tab]}
                    </button>
                  ))}
                </div>

                {selectedTab === 'summary' ? (
                  <>
                    <div className="panel-subsection">
                      <h4>Target Files</h4>
                      <div className="chip-list">
                        {(selectedTask.targetFiles ?? []).map((filePath) => (
                          <span key={filePath} className="chip">{filePath}</span>
                        ))}
                      </div>
                    </div>

                    {selectedTask.inputs && Object.keys(selectedTask.inputs).length > 0 ? (
                      <div className="panel-subsection">
                        <h4>Task Inputs</h4>
                        <pre className="detail-code-block">{stringifyValue(selectedTask.inputs)}</pre>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {selectedTab === 'artifacts' ? (
                    <div className="panel-subsection">
                      <h4>Artifacts and deliverables</h4>
                      <div className="mini-event-list">
                        {selectedArtifacts.map((artifact) => (
                          <div key={artifact.artifactId} className="mini-event">
                          <strong>{artifact.kind}</strong>
                          <span>{artifact.path}</span>
                        </div>
                      ))}
                      {selectedArtifacts.length === 0 ? <p>No task artifacts recorded yet.</p> : null}
                    </div>
                    <div className="chip-list">
                      {(selectedTask.roleProfile?.expectedArtifacts ?? []).map((artifactId) => (
                        <span key={artifactId} className="chip">{artifactId}</span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedTab === 'tests' ? (
                  <div className="panel-subsection">
                    <h4>Verify commands and validation</h4>
                    <div className="chip-list">
                      {(selectedTask.verifyCommands ?? []).map((command) => (
                        <span key={command} className="chip">{command}</span>
                      ))}
                    </div>
                    {defectEvents.length > 0 ? (
                      <div className="mini-event-list">
                        {defectEvents.map((event) => (
                          <div key={event.eventId} className={`mini-event mini-event--${event.severity}`}>
                            <strong>{event.title}</strong>
                            <span>{formatTimestamp(event.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>No defect or validation anomalies recorded for this task yet.</p>
                    )}
                  </div>
                ) : null}

                {selectedTab === 'events' ? (
                  <div className="panel-subsection">
                    <h4>Recent task events</h4>
                    <div className="mini-event-list">
                      {(selectedSummary?.recentEvents ?? []).map((event) => (
                        <div key={event.eventId} className={`mini-event mini-event--${event.severity}`}>
                          <strong>{event.title}</strong>
                          <span>{formatTimestamp(event.createdAt)}</span>
                        </div>
                      ))}
                      {(selectedSummary?.recentEvents ?? []).length === 0 ? <p>No task-scoped events yet.</p> : null}
                    </div>
                  </div>
                ) : null}

                {selectedTab === 'tokens' ? (
                  <div className="panel-subsection">
                    <h4>Token usage</h4>
                    <p className="panel-copy-muted">
                      Token accounting is still a planned backend read model. The surface already reserves space for input, output, and cost data so the operator console does not need to be redesigned later.
                    </p>
                    <div className="chip-list">
                      <span className="chip chip--muted">input tokens: pending</span>
                      <span className="chip chip--muted">output tokens: pending</span>
                      <span className="chip chip--muted">cost estimate: pending</span>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}
