import type { PlatformTaskRecord } from '../lib/control-plane-api';
import type { TaskActionType } from '../lib/control-plane-ui-types';

export function TaskActionsPanel(
  props: Readonly<{
    tasks: PlatformTaskRecord[];
    isPending: boolean;
    errorMessage: string | null;
    onTaskAction: (taskId: string, action: TaskActionType) => void;
  }>
): JSX.Element {
  return (
    <article className="panel panel--tall">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Operator Controls</p>
          <h3>Retry, approve, or reject</h3>
        </div>
        <span className="panel__hint">retry / approve / reject</span>
      </div>

      <div className="task-actions">
        {props.tasks.slice(0, 5).map((task) => (
          <div key={task.taskId} className="task-actions__row">
            <div>
              <strong>{task.title}</strong>
              <span>{task.stage}</span>
              <span>{task.status}</span>
            </div>
            <div className="task-actions__buttons">
              <button disabled={props.isPending} onClick={() => props.onTaskAction(task.taskId, 'retry')} type="button">Retry</button>
              <button disabled={props.isPending} onClick={() => props.onTaskAction(task.taskId, 'approve')} type="button">Approve</button>
              <button className="button-ghost" disabled={props.isPending} onClick={() => props.onTaskAction(task.taskId, 'reject')} type="button">Reject</button>
            </div>
          </div>
        ))}
        {props.errorMessage ? <p className="error-text">{props.errorMessage}</p> : null}
      </div>
    </article>
  );
}
