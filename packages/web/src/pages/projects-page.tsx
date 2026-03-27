import { useState, useEffect } from 'react';
import { useControlPlaneProjectsPage } from '../hooks/use-control-plane-projects-page';
import { AppNavRail } from '../components/shared/app-nav-rail';
import { AppTopbar } from '../components/shared/app-topbar';
import { ProjectTreeSidebar } from '../components/projects/project-tree-sidebar';
import { ProjectsHeroPanel } from '../components/projects/projects-hero';
import { RunSessionPanel } from '../components/projects/run-session-panel';
import type { RunListItem } from '../lib/control-plane-api';

export function ProjectsPage(): JSX.Element {
  const projectsPage = useControlPlaneProjectsPage();
  // When true, show blank hero panel regardless of active run (user clicked ✏ new requirement)
  const [forceNewMode, setForceNewMode] = useState(false);

  // Exit forceNewMode whenever the user navigates into a session view
  useEffect(() => {
    if (projectsPage.sessionRunIdParam) {
      setForceNewMode(false);
    }
  }, [projectsPage.sessionRunIdParam]);

  function handleGenerate(suggestion?: string): void {
    setForceNewMode(false);
    if (suggestion) {
      projectsPage.updateSubmissionField('requirement', suggestion);
      projectsPage.submitWithRequirement(suggestion);
      return;
    }
    projectsPage.submitProjectRun();
  }

  function handleOpenRun(run: RunListItem): void {
    const pid = run.projectId ?? projectsPage.selectedProjectId;
    if (pid) {
      projectsPage.openRun(`/projects/${pid}/runs/${run.runId}`);
    } else {
      projectsPage.openRun(`/runs/${run.runId}`);
    }
  }

  function handleBackFromSession(): void {
    if (projectsPage.selectedProjectId) {
      projectsPage.openRun(`/projects/${projectsPage.selectedProjectId}`);
    } else {
      projectsPage.openRun('/projects');
    }
  }

  const showSession = Boolean(projectsPage.sessionRunIdParam && projectsPage.sessionRun);

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
        runs={projectsPage.runsQuery.data ?? []}
        selectedProjectId={projectsPage.selectedProjectId}
        selectedRunId={projectsPage.sessionRunIdParam}
        onSelectProject={(id) => {
          setForceNewMode(true);
          projectsPage.updateSubmissionField('requirement', '');
          projectsPage.selectProject(id);
        }}
        onRegisterProject={(path) =>
          projectsPage.registrationMutation.mutate({ repositoryRootPath: path })
        }
        onOpenRun={handleOpenRun}
        onNewRequirement={(projectId) => {
          setForceNewMode(true);
          projectsPage.updateSubmissionField('requirement', '');
          // Navigate away from a session or switch project; same-URL case is handled by forceNewMode.
          if (projectsPage.sessionRunIdParam || projectsPage.selectedProjectId !== projectId) {
            projectsPage.openRun(`/projects/${projectId}`);
          }
        }}
        isRegistering={projectsPage.registrationMutation.isPending}
      />

      {/* Main content: ml-[21rem] = 80px sidebar + 256px project tree */}
      <main
        className="mt-16 h-[calc(100vh-4rem)] relative flex items-start justify-center overflow-hidden"
        style={{ marginLeft: '21rem', padding: '0 3rem' }}
      >
        {showSession ? (
          <RunSessionPanel
            run={projectsPage.sessionRun!}
            tasks={projectsPage.sessionTasks}
            observability={projectsPage.sessionObservabilityQuery.data}
            taskSummaries={projectsPage.sessionObservabilityQuery.data?.taskSummaries ?? []}
            artifacts={projectsPage.sessionRunDetailQuery.data?.runState.artifacts ?? []}
            pendingConfirmations={projectsPage.sessionPendingConfirmations}
            blockedTaskId={projectsPage.sessionBlockedTaskId}
            isActionPending={projectsPage.taskActionMutation.isPending}
            isRunActionPending={projectsPage.runActionMutation.isPending}
            actionMessage={projectsPage.actionMessage}
            onBack={handleBackFromSession}
            onApproveConfirmation={projectsPage.approvePendingConfirmation}
            onApproveAndRememberConfirmation={projectsPage.approveAndRememberPendingConfirmation}
            onRejectConfirmation={projectsPage.rejectPendingConfirmation}
            onRetryTask={projectsPage.retryBlockedTask}
            onPauseRun={projectsPage.pauseActiveRun}
            onResumeRun={projectsPage.resumeActiveRun}
          />
        ) : (
          <ProjectsHeroPanel
            selectedProject={projectsPage.selectedProject}
            activeRun={forceNewMode ? null : projectsPage.activeProjectRun}
            tasks={projectsPage.activeRunTasksQuery.data ?? []}
            taskSummaries={projectsPage.activeRunObservabilityQuery.data?.taskSummaries ?? []}
            executionFeed={projectsPage.activeRunExecutionFeed}
            blockedReason={projectsPage.blockedReason}
            blockedTaskId={projectsPage.blockedTaskId}
            pendingConfirmations={projectsPage.pendingConfirmations}
            requirement={projectsPage.submissionState.requirement}
            requirementHistory={projectsPage.requirementHistory}
            onRequirementChange={(value) =>
              projectsPage.updateSubmissionField('requirement', value)
            }
            onGenerate={handleGenerate}
            onApproveConfirmation={projectsPage.approvePendingConfirmation}
            onApproveAndRememberConfirmation={projectsPage.approveAndRememberPendingConfirmation}
            onPauseRun={projectsPage.pauseActiveRun}
            onRejectConfirmation={projectsPage.rejectPendingConfirmation}
            onResumeRun={projectsPage.resumeActiveRun}
            onRetryTask={projectsPage.retryBlockedTask}
            actionMessage={projectsPage.actionMessage}
            isActionPending={projectsPage.taskActionMutation.isPending}
            isPending={projectsPage.submissionMutation.isPending}
            isRunActionPending={projectsPage.runActionMutation.isPending}
            errorMessage={
              projectsPage.submissionMutation.isError
                ? projectsPage.submissionMutation.error.message
                : null
            }
          />
        )}
      </main>

      {/* Bottom status bar */}
    </div>
  );
}
