import { NavLink } from 'react-router-dom';

export function AppSidebar(props: Readonly<{ backendBaseUrl: string; currentRunId: string | null }>): JSX.Element {
  return (
    <aside className="app-shell__sidebar">
      <div>
        <p className="eyebrow">Spec2Flow</p>
        <h1>Control Plane</h1>
        <p className="sidebar-copy">
          Backend-first operator shell for run submission, progress inspection, and gated task actions.
        </p>
      </div>

      <nav className="nav-list" aria-label="Sections">
        <NavLink to="/runs">Runs</NavLink>
        {props.currentRunId ? <NavLink to={`/runs/${props.currentRunId}`}>Current Run</NavLink> : null}
      </nav>

      <div className="sidebar-note">
        <span className="sidebar-note__label">Backend</span>
        <strong>{props.backendBaseUrl}</strong>
        <p>Pause and resume are backend-ready; the frontend intentionally stays thin until task detail and artifact views harden.</p>
      </div>
    </aside>
  );
}
