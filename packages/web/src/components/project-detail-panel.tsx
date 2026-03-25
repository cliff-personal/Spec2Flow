import type { ProjectListItem, RunListItem } from '../lib/control-plane-api';
import { formatTimestamp } from '../lib/control-plane-formatters';

export function ProjectDetailPanel(
  props: Readonly<{
    project: ProjectListItem | null;
    runs: RunListItem[];
  }>
): JSX.Element {
  if (!props.project) {
    return (
      <article className="panel panel--tall">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Project Command</p>
            <h3>Select a project</h3>
          </div>
        </div>
        <p>Choose one project to inspect workspace policy, worktree behavior, runtime config pointers, and recent delivery activity.</p>
      </article>
    );
  }

  return (
    <article className="panel panel--tall">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Project Command</p>
          <h3>{props.project.projectName}</h3>
        </div>
        <span className="panel__hint">{props.runs.length} runs</span>
      </div>

      <dl className="detail-list detail-list--compact">
        <div>
          <dt>Repository Root</dt>
          <dd>{props.project.repositoryRootPath}</dd>
        </div>
        <div>
          <dt>Workspace Root</dt>
          <dd>{props.project.workspaceRootPath}</dd>
        </div>
        <div>
          <dt>Default Branch</dt>
          <dd>{props.project.defaultBranch ?? 'n/a'}</dd>
        </div>
        <div>
          <dt>Branch Prefix</dt>
          <dd>{props.project.branchPrefix ?? 'n/a'}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatTimestamp(props.project.updatedAt)}</dd>
        </div>
      </dl>

      <div className="panel-subsection">
        <h4>Workspace policy</h4>
        <div className="chip-list">
          {props.project.workspacePolicy.allowedReadGlobs.map((glob) => (
            <span key={`read-${glob}`} className="chip chip--muted">{`read ${glob}`}</span>
          ))}
          {props.project.workspacePolicy.allowedWriteGlobs.map((glob) => (
            <span key={glob} className="chip">{glob}</span>
          ))}
          {props.project.workspacePolicy.forbiddenWriteGlobs.map((glob) => (
            <span key={`deny-${glob}`} className="chip chip--danger">{`deny ${glob}`}</span>
          ))}
        </div>
      </div>

      <div className="panel-subsection">
        <h4>Config pointers</h4>
        <div className="chip-list">
          {props.project.projectPath ? <span className="chip chip--muted">{props.project.projectPath}</span> : null}
          {props.project.topologyPath ? <span className="chip chip--muted">{props.project.topologyPath}</span> : null}
          {props.project.riskPath ? <span className="chip chip--muted">{props.project.riskPath}</span> : null}
        </div>
      </div>
    </article>
  );
}
