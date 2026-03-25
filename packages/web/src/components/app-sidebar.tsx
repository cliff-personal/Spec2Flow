import { NavLink } from 'react-router-dom';

export function AppSidebar(
  props: Readonly<{ backendBaseUrl: string; currentProjectId: string | null; currentRunId: string | null }>
): JSX.Element {
  return (
    <aside className="app-shell__sidebar">
      <div className="sidebar-brand">
        <p className="eyebrow">Spec2Flow</p>
        <h1>Control Plane</h1>
        <p className="sidebar-copy">
          Mission-control shell for project registration, autonomous runs, evidence review, and bounded repair loops.
        </p>
      </div>

      <nav className="nav-list" aria-label="Sections">
        <NavLink to="/projects">Projects</NavLink>
        {props.currentProjectId ? <NavLink to={`/projects/${props.currentProjectId}`}>Current Project</NavLink> : null}
        <NavLink to="/runs">Runs</NavLink>
        {props.currentRunId ? <NavLink to={`/runs/${props.currentRunId}`}>Current Run</NavLink> : null}
      </nav>

      <div className="sidebar-signal-grid">
        <div className="sidebar-signal-card">
          <span className="sidebar-note__label">Workspace Mode</span>
          <strong>Project-first</strong>
          <p>Every run inherits workspace policy, branch naming, and worktree boundaries from the selected project.</p>
        </div>
        <div className="sidebar-signal-card">
          <span className="sidebar-note__label">Review Model</span>
          <strong>Evidence-first</strong>
          <p>Operators intervene late. The product prioritizes status, diffs, tests, artifacts, and final review packets.</p>
        </div>
      </div>

      <div className="sidebar-note">
        <span className="sidebar-note__label">Backend</span>
        <strong>{props.backendBaseUrl}</strong>
        <p>The console pivots around projects, workspaces, and review-ready runs instead of raw queue rows.</p>
      </div>
    </aside>
  );
}
