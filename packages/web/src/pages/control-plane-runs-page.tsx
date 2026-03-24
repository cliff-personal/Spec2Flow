import { HeroPanel } from '../components/hero-panel';
import { RunSubmissionPanel } from '../components/run-submission-panel';
import { RunsPanel } from '../components/runs-panel';
import { useControlPlaneRunsPage } from '../hooks/use-control-plane-runs-page';

export function ControlPlaneRunsPage(): JSX.Element {
  const runsPage = useControlPlaneRunsPage();

  return (
    <>
      <HeroPanel
        eyebrow="Runs"
        title="Submit runs and inspect the active queue"
        description="This route is the operator intake surface: create a run, then drill into a specific run page for detail, observability, and task actions."
        statusItems={[
          {
            label: 'Runs API',
            value: runsPage.runsQuery.isSuccess ? 'connected' : 'waiting'
          },
          {
            label: 'Queue Size',
            value: String(runsPage.runsQuery.data?.length ?? 0)
          },
          {
            label: 'Last action',
            value: runsPage.actionMessage ?? 'none'
          }
        ]}
      />

      <section className="grid grid--two" id="submission">
        <RunSubmissionPanel
          submissionState={runsPage.submissionState}
          onFieldChange={runsPage.updateSubmissionField}
          onSubmit={runsPage.submitDashboardRun}
          isPending={runsPage.submissionMutation.isPending}
          errorMessage={runsPage.submissionMutation.isError ? runsPage.submissionMutation.error.message : null}
        />
        <RunsPanel
          runs={runsPage.runsQuery.data ?? []}
          selectedRunId={null}
          onOpenRun={(runId) => runsPage.openRun(`/runs/${runId}`)}
          errorMessage={runsPage.runsQuery.isError ? runsPage.runsQuery.error.message : null}
          isSuccess={runsPage.runsQuery.isSuccess}
        />
      </section>
    </>
  );
}