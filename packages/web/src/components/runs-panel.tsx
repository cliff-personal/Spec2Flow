import type { RunListItem } from '../lib/control-plane-api';
import { formatTimestamp } from '../lib/control-plane-formatters';
import { StatusPill } from './status-pill';

export function RunsPanel(
  props: Readonly<{
    runs: RunListItem[];
    selectedRunId: string | null;
    onOpenRun: (runId: string) => void;
    errorMessage: string | null;
    isSuccess: boolean;
  }>
): JSX.Element {
  return (
    <article className="panel" id="runs">
      <div className="panel__header">
        <div>
          <p className="eyebrow">GET /api/runs</p>
          <h3>Runs</h3>
        </div>
        <span className="panel__hint">Auto-refresh every 10s</span>
      </div>

      {props.errorMessage ? <p className="error-text">{props.errorMessage}</p> : null}
      <div className="run-list">
        {props.runs.map((run) => (
          <button
            key={run.runId}
            className={`run-list__item ${props.selectedRunId === run.runId ? 'run-list__item--active' : ''}`}
            onClick={() => props.onOpenRun(run.runId)}
            type="button"
          >
            <div>
              <strong>{run.workflowName}</strong>
              <span>{run.projectName ?? run.repositoryName}</span>
              <span>{run.branchName ?? run.repositoryRootPath}</span>
            </div>
            <div>
              <StatusPill value={run.status} />
              <span className="run-list__timestamp">{formatTimestamp(run.updatedAt)}</span>
            </div>
          </button>
        ))}
        {props.isSuccess && props.runs.length === 0 ? <p>No runs yet.</p> : null}
      </div>
    </article>
  );
}
