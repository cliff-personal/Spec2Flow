import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProjectsPage } from './pages/projects-page';
import { ControlPlaneRunDetailPage } from './pages/control-plane-run-detail-page';
import { ControlPlaneRunsPage } from './pages/control-plane-runs-page';
import { ControlPlaneShell } from './pages/control-plane-shell';

export function AppRouter(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Navigate replace to="/projects" />} path="/" />
        <Route element={<ProjectsPage />} path="/projects" />
        <Route element={<ProjectsPage />} path="/projects/:projectId" />
        <Route element={<ProjectsPage />} path="/projects/:projectId/runs/:runId" />
        <Route element={<ControlPlaneShell />} path="/">
          <Route element={<ControlPlaneRunsPage />} path="runs" />
          <Route element={<ControlPlaneRunDetailPage />} path="runs/:runId" />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
