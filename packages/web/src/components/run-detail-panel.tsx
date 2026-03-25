import type { RunDetail } from '../lib/control-plane-api';
import { formatStage } from '../lib/control-plane-formatters';
import { StatusPill } from './status-pill';

export function RunDetailPanel(
  props: Readonly<{
    runDetail: RunDetail | undefined;
    errorMessage: string | null;
  }>
): JSX.Element {
  return (
    <article className="panel panel--tall">
      <div className="panel__header">
        <div>
          <p className="eyebrow">GET /api/runs/:runId</p>
          <h3>Run Detail</h3>
        </div>
        <StatusPill value={props.runDetail?.runState.run.status} />
      </div>

      {props.errorMessage ? <p className="error-text">{props.errorMessage}</p> : null}
      {props.runDetail ? (
        <dl className="detail-list">
          <div>
            <dt>Run ID</dt>
            <dd>{props.runDetail.runState.run.runId}</dd>
          </div>
          <div>
            <dt>Workflow</dt>
            <dd>{props.runDetail.runState.run.workflowName}</dd>
          </div>
          <div>
            <dt>Current Stage</dt>
            <dd>{formatStage(props.runDetail.runState.run.currentStage)}</dd>
          </div>
          <div>
            <dt>Risk</dt>
            <dd>{props.runDetail.runState.run.riskLevel ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{props.runDetail.runState.project?.name ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Workspace Root</dt>
            <dd>{props.runDetail.runState.workspace?.workspaceRootPath ?? props.runDetail.runState.project?.workspaceRootPath ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Branch</dt>
            <dd>{props.runDetail.runState.workspace?.branchName ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Worktree</dt>
            <dd>{props.runDetail.runState.workspace?.worktreePath ?? 'n/a'}</dd>
          </div>
        </dl>
      ) : (
        <p>Select a run to load detail.</p>
      )}
    </article>
  );
}
