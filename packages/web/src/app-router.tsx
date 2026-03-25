import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ControlPlaneProjectsPage } from './pages/control-plane-projects-page';
import { ControlPlaneRunDetailPage } from './pages/control-plane-run-detail-page';
import { ControlPlaneRunsPage } from './pages/control-plane-runs-page';
import { ControlPlaneShell } from './pages/control-plane-shell';

export function AppRouter(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ControlPlaneShell />} path="/">
          <Route element={<Navigate replace to="/projects" />} index />
          <Route element={<ControlPlaneProjectsPage />} path="projects" />
          <Route element={<ControlPlaneProjectsPage />} path="projects/:projectId" />
          <Route element={<ControlPlaneRunsPage />} path="runs" />
          <Route element={<ControlPlaneRunDetailPage />} path="runs/:runId" />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
