import { HeroPanel } from '../components/hero-panel';
import { RunsPanel } from '../components/runs-panel';
import { useControlPlaneRunsPage } from '../hooks/use-control-plane-runs-page';

export function ControlPlaneRunsPage(): JSX.Element {
  const runsPage = useControlPlaneRunsPage();
  const totalRuns = runsPage.runsQuery.data ?? [];
  const blockedRuns = totalRuns.filter((run) => run.status === 'blocked').length;
  const completedRuns = totalRuns.filter((run) => run.status === 'completed').length;

  return (
    <div className="page-stack">
      <HeroPanel
        eyebrow="Runs"
        title="Inspect the global autonomous delivery queue"
        description="The queue view is for cross-project monitoring only. Requirement intake stays project-scoped so runs inherit real workspace policy instead of freelancing against arbitrary paths."
        statusItems={[
          {
            label: 'Runs API',
            value: runsPage.runsQuery.isSuccess ? 'connected' : 'waiting'
          },
          {
            label: 'Queue Size',
            value: String(totalRuns.length)
          },
          {
            label: 'Blocked',
            value: String(blockedRuns)
          },
          {
            label: 'Completed',
            value: String(completedRuns)
          }
        ]}
      />

      <section className="grid" id="queue">
        <RunsPanel
          title="Global Run Queue"
          eyebrow="GET /api/runs"
          emptyMessage="No runs have been created yet. Register a project and submit a requirement from Projects."
          runs={runsPage.runsQuery.data ?? []}
          selectedRunId={null}
          onOpenRun={(runId) => runsPage.openRun(`/runs/${runId}`)}
          errorMessage={runsPage.runsQuery.isError ? runsPage.runsQuery.error.message : null}
          isSuccess={runsPage.runsQuery.isSuccess}
        />
      </section>
    </div>
  );
}
