import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ControlPlaneRunDetailPage } from './pages/control-plane-run-detail-page';
import { ControlPlaneRunsPage } from './pages/control-plane-runs-page';
import { ControlPlaneShell } from './pages/control-plane-shell';

export function AppRouter(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ControlPlaneShell />} path="/">
          <Route element={<Navigate replace to="/runs" />} index />
          <Route element={<ControlPlaneRunsPage />} path="runs" />
          <Route element={<ControlPlaneRunDetailPage />} path="runs/:runId" />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}