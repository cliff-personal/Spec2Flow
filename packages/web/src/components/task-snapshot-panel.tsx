import type { PlatformTaskRecord } from '../lib/control-plane-api';
import { StatusPill } from './status-pill';

export function TaskSnapshotPanel(
  props: Readonly<{
    tasks: PlatformTaskRecord[];
    isSuccess: boolean;
  }>
): JSX.Element {
  return (
    <article className="panel panel--tall">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Task Snapshot</p>
          <h3>Route Tasks</h3>
        </div>
        <span className="panel__hint">Thin shell, backend truth</span>
      </div>

      <div className="task-table">
        {props.tasks.map((task) => (
          <div key={task.taskId} className="task-table__row">
            <div>
              <strong>{task.title}</strong>
              <span>{task.goal}</span>
            </div>
            <div>
              <span>{task.stage}</span>
              <StatusPill value={task.status} />
            </div>
          </div>
        ))}
        {props.isSuccess && props.tasks.length === 0 ? <p>No task records yet.</p> : null}
      </div>
    </article>
  );
}