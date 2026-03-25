import type { ProjectListItem, RunListItem } from '../lib/control-plane-api';
import { formatTimestamp } from '../lib/control-plane-formatters';

function countRuns(runs: RunListItem[], projectId: string, status?: RunListItem['status']): number {
  return runs.filter((run) => run.projectId === projectId && (!status || run.status === status)).length;
}

export function ProjectsPanel(
  props: Readonly<{
    projects: ProjectListItem[];
    runs: RunListItem[];
    selectedProjectId: string | null;
    onSelectProject: (projectId: string) => void;
    errorMessage: string | null;
  }>
): JSX.Element {
  return (
    <article className="panel panel--tall">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Project Registry</p>
          <h3>Workspace Inventory</h3>
        </div>
        <span className="panel__hint">{props.projects.length} registered</span>
      </div>

      {props.errorMessage ? <p className="error-text">{props.errorMessage}</p> : null}

      <div className="project-list">
        {props.projects.map((project) => (
          <button
            key={project.projectId}
            className={`project-card ${props.selectedProjectId === project.projectId ? 'project-card--active' : ''}`}
            onClick={() => props.onSelectProject(project.projectId)}
            type="button"
          >
            <div className="project-card__header">
              <div>
                <strong>{project.projectName}</strong>
                <span>{project.repositoryName}</span>
              </div>
              <span className="status-pill">{countRuns(props.runs, project.projectId)} runs</span>
            </div>

            <dl className="project-card__meta">
              <div>
                <dt>Workspace</dt>
                <dd>{project.workspaceRootPath}</dd>
              </div>
              <div>
                <dt>Branch Prefix</dt>
                <dd>{project.branchPrefix ?? 'default'}</dd>
              </div>
              <div>
                <dt>Blocked</dt>
                <dd>{countRuns(props.runs, project.projectId, 'blocked')}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatTimestamp(project.updatedAt)}</dd>
              </div>
            </dl>

            <div className="project-card__metrics">
              <span>Active {countRuns(props.runs, project.projectId, 'running')}</span>
              <span>Completed {countRuns(props.runs, project.projectId, 'completed')}</span>
              <span>Write scope {project.workspacePolicy.allowedWriteGlobs.length}</span>
            </div>
          </button>
        ))}

        {props.projects.length === 0 ? <p>No projects yet. Register the first workspace to start autonomous delivery.</p> : null}
      </div>
    </article>
  );
}
