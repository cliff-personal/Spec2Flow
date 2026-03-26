import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { AppSidebar } from '../components/app-sidebar';
import { getControlPlaneBaseUrl } from '../lib/control-plane-api';

function deriveShellHeading(pathname: string, projectId: string | null, runId: string | null): {
  eyebrow: string;
  title: string;
  description: string;
} {
  if (pathname.startsWith('/runs/') && pathname.endsWith('/review') && runId) {
    return {
      eyebrow: 'Review Packet',
      title: `Review ${runId.slice(0, 8)}`,
      description: 'Validate the final delivery packet, evidence set, and publication outcome for one autonomous run.'
    };
  }

  if (pathname.startsWith('/runs/') && runId) {
    return {
      eyebrow: 'Run Command',
      title: `Run ${runId.slice(0, 8)}`,
      description: 'Track stage progression, evidence, defects, and final readiness for one autonomous delivery run.'
    };
  }

  if (pathname.startsWith('/runs')) {
    return {
      eyebrow: 'Global Queue',
      title: 'Mission Control Queue',
      description: 'Scan the cross-project run queue, then dive into one run when intervention or review is needed.'
    };
  }

  if (pathname.startsWith('/projects/') && projectId) {
    return {
      eyebrow: 'Project Workspace',
      title: `Project ${projectId.slice(0, 8)}`,
      description: 'Project-scoped requirement intake, workspace policy, and recent autonomous delivery activity.'
    };
  }

  return {
    eyebrow: 'Projects',
    title: 'Autonomous Delivery Control Plane',
    description: 'Register one project, submit one requirement, and let the six-stage loop execute inside a bounded workspace.'
  };
}

export function ControlPlaneShell(): JSX.Element {
  const { projectId, runId } = useParams<{ projectId?: string; runId?: string }>();
  const location = useLocation();
  const heading = deriveShellHeading(location.pathname, projectId ?? null, runId ?? null);

  return (
    <div className="app-shell">
      <AppSidebar backendBaseUrl={getControlPlaneBaseUrl()} currentProjectId={projectId ?? null} currentRunId={runId ?? null} />
      <div className="app-shell__main">
        <header className="shell-topbar">
          <div className="shell-topbar__copy">
            <p className="eyebrow">{heading.eyebrow}</p>
            <h2>{heading.title}</h2>
            <p>{heading.description}</p>
          </div>

          <div className="shell-topbar__actions">
            <div className="shell-signal">
              <span className="shell-signal__label">Backend</span>
              <strong>{getControlPlaneBaseUrl()}</strong>
            </div>
            <div className="shell-signal">
              <span className="shell-signal__label">Route</span>
              <strong>{location.pathname}</strong>
            </div>
            <Link className="shell-topbar__cta" to={projectId ? `/projects/${projectId}` : '/projects'}>
              {projectId ? 'Project Workspace' : 'Projects Home'}
            </Link>
          </div>
        </header>

        <main className="app-shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
