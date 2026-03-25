import { useState } from 'react';
import { useControlPlaneProjectsPage } from '../hooks/use-control-plane-projects-page';
import { AppNavRail } from '../components/shared/app-nav-rail';
import { AppTopbar } from '../components/shared/app-topbar';
import { ProjectTreeSidebar } from '../components/projects/project-tree-sidebar';
import { ProjectsHeroPanel } from '../components/projects/projects-hero';
import { ProjectsStatusBar } from '../components/projects/projects-status-bar';
import { ProjectRegistrationDrawer } from '../components/projects/project-registration-drawer';

export function ProjectsPage(): JSX.Element {
  const projectsPage = useControlPlaneProjectsPage();
  const [registrationOpen, setRegistrationOpen] = useState(false);

  function handleGenerate(suggestion?: string): void {
    if (suggestion) {
      projectsPage.updateSubmissionField('requirement', suggestion);
      // Allow one render cycle then submit
      setTimeout(() => {
        if (projectsPage.selectedProject) {
          projectsPage.updateSubmissionField('requirement', suggestion);
        }
      }, 0);
    }
    projectsPage.submitProjectRun();
  }

  return (
    <div
      className="font-body text-on-surface overflow-hidden"
      style={{
        minHeight: '100vh',
        backgroundColor: '#0E0E0F',
        backgroundImage: [
          'radial-gradient(circle at 50% 50%, rgba(0, 240, 255, 0.03) 0%, transparent 50%)',
          'linear-gradient(to right, rgba(53, 52, 54, 0.1) 1px, transparent 1px)',
          'linear-gradient(to bottom, rgba(53, 52, 54, 0.1) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: '100% 100%, 40px 40px, 40px 40px',
      }}
    >
      {/* Far-left nav rail */}
      <AppNavRail />

      {/* Top bar */}
      <AppTopbar />

      {/* Project tree sidebar */}
      <ProjectTreeSidebar
        projects={projectsPage.projectsQuery.data ?? []}
        selectedProjectId={projectsPage.selectedProjectId}
        onSelectProject={projectsPage.selectProject}
        onAddProject={() => setRegistrationOpen(true)}
      />

      {/* Main content: ml-[21rem] = 80px sidebar + 256px project tree */}
      <main
        className="mt-16 h-[calc(100vh-4rem)] relative flex items-center justify-center p-12 overflow-hidden"
        style={{ marginLeft: '21rem' }}
      >
        <ProjectsHeroPanel
          selectedProject={projectsPage.selectedProject}
          requirement={projectsPage.submissionState.requirement}
          onRequirementChange={(value) =>
            projectsPage.updateSubmissionField('requirement', value)
          }
          onGenerate={handleGenerate}
          isPending={projectsPage.submissionMutation.isPending}
          errorMessage={
            projectsPage.submissionMutation.isError
              ? projectsPage.submissionMutation.error.message
              : null
          }
          actionMessage={projectsPage.actionMessage}
        />
      </main>

      {/* Bottom status bar */}
      <ProjectsStatusBar />

      {/* Registration drawer (slide-in from right) */}
      <ProjectRegistrationDrawer
        isOpen={registrationOpen}
        onClose={() => setRegistrationOpen(false)}
        formState={projectsPage.registrationState}
        onFieldChange={projectsPage.updateRegistrationField}
        onSubmit={() => {
          projectsPage.submitProjectRegistration();
          setRegistrationOpen(false);
        }}
        isPending={projectsPage.registrationMutation.isPending}
        errorMessage={
          projectsPage.registrationMutation.isError
            ? projectsPage.registrationMutation.error.message
            : null
        }
      />
    </div>
  );
}
