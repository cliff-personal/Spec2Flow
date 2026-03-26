import { HeroPanel } from '../components/hero-panel';
import { RunAttentionPanel } from '../components/run-attention-panel';
import { RunsPanel } from '../components/runs-panel';
import { useControlPlaneRunsPage } from '../hooks/use-control-plane-runs-page';

export function ControlPlaneRunsPage(): JSX.Element {
  const runsPage = useControlPlaneRunsPage();
  const totalRuns = runsPage.runsQuery.data ?? [];
  const blockedRuns = totalRuns.filter((run) => run.status === 'blocked').length;
  const completedRuns = totalRuns.filter((run) => run.status === 'completed').length;
  const attentionRuns = runsPage.attentionItems.filter((item) => item.attentionCount > 0 || item.status !== 'completed');

  return (
    <div className="page-stack">
      <HeroPanel
        eyebrow="Runs"
        title="Inspect the global attention deck and delivery queue"
        description="The runs surface is attention-first: operators should see which autonomous delivery loops need intervention before scanning the full cross-project queue. Requirement intake still stays project-scoped so runs inherit real workspace policy instead of freelancing against arbitrary paths."
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
            label: 'Needs Attention',
            value: String(attentionRuns.filter((item) => item.attentionCount > 0 || item.status === 'blocked').length)
          },
          {
            label: 'Completed',
            value: String(completedRuns)
          }
        ]}
      />

      <section className="grid" id="attention">
        <RunAttentionPanel
          items={attentionRuns}
          onOpenRun={(runId) => runsPage.openRun(`/runs/${runId}`)}
        />
      </section>

      <section className="grid" id="queue">
        <RunsPanel
          title="Global Run Queue"
          eyebrow="GET /api/runs"
          emptyMessage="No runs have been created yet. Register a project and submit a requirement from Projects."
          runs={runsPage.runsQuery.data ?? []}
          selectedRunId={null}
          onOpenRun={(runId) => runsPage.openRun(`/runs/${runId}`)}
          onRunAction={runsPage.triggerRunAction}
          errorMessage={runsPage.runActionMutation.isError
            ? runsPage.runActionMutation.error.message
            : (runsPage.runsQuery.isError ? runsPage.runsQuery.error.message : null)}
          isSuccess={runsPage.runsQuery.isSuccess}
          isActionPending={runsPage.runActionMutation.isPending}
        />
      </section>
    </div>
  );
}
