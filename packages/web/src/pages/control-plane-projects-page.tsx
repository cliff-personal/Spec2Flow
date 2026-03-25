import { Link } from 'react-router-dom';
import { HeroPanel } from '../components/hero-panel';
import { ProjectDetailPanel } from '../components/project-detail-panel';
import { ProjectRegistrationPanel } from '../components/project-registration-panel';
import { ProjectsPanel } from '../components/projects-panel';
import { RunSubmissionPanel } from '../components/run-submission-panel';
import { RunsPanel } from '../components/runs-panel';
import { useControlPlaneProjectsPage } from '../hooks/use-control-plane-projects-page';

export function ControlPlaneProjectsPage(): JSX.Element {
  const projectsPage = useControlPlaneProjectsPage();
  const totalProjects = projectsPage.projectsQuery.data?.length ?? 0;
  const totalRuns = projectsPage.runsQuery.data ?? [];
  const activeRuns = totalRuns.filter((run) => ['running', 'pending'].includes(run.status)).length;
  const blockedRuns = totalRuns.filter((run) => run.status === 'blocked').length;

  return (
    <div className="page-stack">
      <HeroPanel
        eyebrow="Projects"
        title="Register one workspace, then let the delivery loop handle the rest"
        description="This is the product home. Select one project, define the workspace boundary once, and submit requirements into a review-ready autonomous run system."
        statusItems={[
          {
            label: 'Projects',
            value: String(totalProjects)
          },
          {
            label: 'Active Runs',
            value: String(activeRuns)
          },
          {
            label: 'Blocked',
            value: String(blockedRuns)
          },
          {
            label: 'Last action',
            value: projectsPage.actionMessage ?? 'steady'
          }
        ]}
        action={(
          <Link className="hero-link" to="/runs">
            Open Global Queue
          </Link>
        )}
      />

      <section className="grid grid--two-equal">
        <ProjectsPanel
          projects={projectsPage.projectsQuery.data ?? []}
          runs={projectsPage.runsQuery.data ?? []}
          selectedProjectId={projectsPage.selectedProjectId}
          onSelectProject={projectsPage.selectProject}
          errorMessage={projectsPage.projectsQuery.isError ? projectsPage.projectsQuery.error.message : null}
        />
        <ProjectRegistrationPanel
          formState={projectsPage.registrationState}
          onFieldChange={projectsPage.updateRegistrationField}
          onSubmit={projectsPage.submitProjectRegistration}
          isPending={projectsPage.registrationMutation.isPending}
          errorMessage={projectsPage.registrationMutation.isError ? projectsPage.registrationMutation.error.message : null}
        />
      </section>

      <section className="grid grid--two">
        <ProjectDetailPanel
          project={projectsPage.selectedProject}
          runs={projectsPage.selectedProjectRuns}
        />
        <RunSubmissionPanel
          selectedProject={projectsPage.selectedProject}
          submissionState={projectsPage.submissionState}
          onFieldChange={projectsPage.updateSubmissionField}
          onSubmit={projectsPage.submitProjectRun}
          isPending={projectsPage.submissionMutation.isPending}
          errorMessage={projectsPage.submissionMutation.isError ? projectsPage.submissionMutation.error.message : null}
        />
      </section>

      <section className="grid">
        <RunsPanel
          title={projectsPage.selectedProject ? `${projectsPage.selectedProject.projectName} Delivery Runs` : 'Project Runs'}
          eyebrow="Mission Queue"
          emptyMessage="No runs yet for the selected project."
          runs={projectsPage.selectedProjectRuns}
          selectedRunId={null}
          onOpenRun={(runId) => projectsPage.openRun(`/runs/${runId}`)}
          errorMessage={projectsPage.runsQuery.isError ? projectsPage.runsQuery.error.message : null}
          isSuccess={projectsPage.runsQuery.isSuccess}
        />
      </section>
    </div>
  );
}
