import { useEffect, useState } from 'react';
import type { PlatformTaskObservabilitySummary, PlatformTaskRecord } from '../lib/control-plane-api';
import { formatStage, formatTimestamp } from '../lib/control-plane-formatters';
import { StatusPill } from './status-pill';

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
  }>
): JSX.Element {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(props.tasks[0]?.taskId ?? null);

  useEffect(() => {
    if (!selectedTaskId && props.tasks[0]) {
      setSelectedTaskId(props.tasks[0].taskId);
      return;
    }

    if (selectedTaskId && !props.tasks.some((task) => task.taskId === selectedTaskId)) {
      setSelectedTaskId(props.tasks[0]?.taskId ?? null);
    }
  }, [props.tasks, selectedTaskId]);

  const selectedTask = props.tasks.find((task) => task.taskId === selectedTaskId) ?? null;
  const selectedSummary = props.taskSummaries.find((summary) => summary.taskId === selectedTaskId) ?? null;

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
                      {selectedSummary?.artifactCount ?? 0} / {selectedSummary?.expectedArtifactCount ?? selectedTask.roleProfile?.expectedArtifacts.length ?? 0}
                    </dd>
                  </div>
                </dl>

                <div className="panel-subsection">
                  <h4>Target Files</h4>
                  <div className="chip-list">
                    {(selectedTask.targetFiles ?? []).map((filePath) => (
                      <span key={filePath} className="chip">{filePath}</span>
                    ))}
                  </div>
                </div>

                <div className="panel-subsection">
                  <h4>Verify Commands</h4>
                  <div className="chip-list">
                    {(selectedTask.verifyCommands ?? []).map((command) => (
                      <span key={command} className="chip">{command}</span>
                    ))}
                  </div>
                </div>

                {selectedTask.inputs && Object.keys(selectedTask.inputs).length > 0 ? (
                  <div className="panel-subsection">
                    <h4>Inputs</h4>
                    <pre className="detail-code-block">{stringifyValue(selectedTask.inputs)}</pre>
                  </div>
                ) : null}

                <div className="panel-subsection">
                  <h4>Recent Task Events</h4>
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
              </>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}