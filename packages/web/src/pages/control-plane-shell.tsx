import { Outlet, useParams } from 'react-router-dom';
import { AppSidebar } from '../components/app-sidebar';
import { getControlPlaneBaseUrl } from '../lib/control-plane-api';

export function ControlPlaneShell(): JSX.Element {
  const { runId } = useParams<{ runId: string }>();

  return (
    <div className="app-shell">
      <AppSidebar backendBaseUrl={getControlPlaneBaseUrl()} currentRunId={runId ?? null} />
      <main className="app-shell__content">
        <Outlet />
      </main>
    </div>
  );
}