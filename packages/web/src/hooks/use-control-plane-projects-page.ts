import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  listProjects,
  listRuns,
  registerProject,
  submitRun,
  type ProjectListItem,
  type ProjectRegistrationPayload,
  type RunSubmissionPayload
} from '../lib/control-plane-api';
import { parseChangedFiles } from '../lib/control-plane-formatters';
import type { ProjectRegistrationFormState, SubmissionFormState } from '../lib/control-plane-ui-types';

const INITIAL_REGISTRATION_STATE: ProjectRegistrationFormState = {
  projectName: 'Spec2Flow',
  repositoryRootPath: '/Users/cliff/workspace/Spec2Flow',
  workspaceRootPath: '/Users/cliff/workspace/Spec2Flow',
  projectPath: '.spec2flow/project.yaml',
  topologyPath: '.spec2flow/topology.yaml',
  riskPath: '.spec2flow/policies/risk.yaml',
  defaultBranch: 'main',
  branchPrefix: 'spec2flow/',
  allowedWriteGlobs: 'src/**,tests/**,docs/**,.spec2flow/**'
};

const INITIAL_SUBMISSION_STATE: SubmissionFormState = {
  requirement: '',
  requirementPath: '',
  changedFiles: ''
};

function buildProjectRegistrationPayload(formState: ProjectRegistrationFormState): ProjectRegistrationPayload {
  return {
    repositoryRootPath: formState.repositoryRootPath,
    projectName: formState.projectName,
    workspaceRootPath: formState.workspaceRootPath,
    projectPath: formState.projectPath,
    topologyPath: formState.topologyPath,
    riskPath: formState.riskPath,
    defaultBranch: formState.defaultBranch,
    branchPrefix: formState.branchPrefix,
    workspacePolicy: {
      allowedWriteGlobs: parseChangedFiles(formState.allowedWriteGlobs)
    }
  };
}

function buildRunSubmissionPayload(project: ProjectListItem, submissionState: SubmissionFormState): RunSubmissionPayload {
  return {
    repositoryRootPath: project.repositoryRootPath,
    projectId: project.projectId,
    projectName: project.projectName,
    workspaceRootPath: project.workspaceRootPath,
    ...(project.projectPath ? { projectPath: project.projectPath } : {}),
    ...(project.topologyPath ? { topologyPath: project.topologyPath } : {}),
    ...(project.riskPath ? { riskPath: project.riskPath } : {}),
    ...(project.repositoryId ? { repositoryId: project.repositoryId } : {}),
    ...(project.repositoryName ? { repositoryName: project.repositoryName } : {}),
    ...(project.defaultBranch ? { defaultBranch: project.defaultBranch } : {}),
    ...(submissionState.requirement.trim() ? { requirement: submissionState.requirement.trim() } : {}),
    ...(submissionState.requirementPath.trim() ? { requirementPath: submissionState.requirementPath.trim() } : {}),
    changedFiles: parseChangedFiles(submissionState.changedFiles)
  };
}

export function useControlPlaneProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { projectId } = useParams<{ projectId?: string }>();
  const [registrationState, setRegistrationState] = useState(INITIAL_REGISTRATION_STATE);
  const [submissionState, setSubmissionState] = useState(INITIAL_SUBMISSION_STATE);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);

  const projectsQuery = useQuery({
    queryKey: ['control-plane', 'projects'],
    queryFn: listProjects,
    retry: false,
    refetchInterval: 10000
  });

  const runsQuery = useQuery({
    queryKey: ['control-plane', 'runs'],
    queryFn: listRuns,
    retry: false,
    refetchInterval: 10000
  });

  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
      return;
    }

    const firstProjectId = projectsQuery.data?.[0]?.projectId ?? null;
    if (!selectedProjectId && firstProjectId) {
      setSelectedProjectId(firstProjectId);
    }
  }, [projectId, projectsQuery.data, selectedProjectId]);

  const selectedProject = projectsQuery.data?.find((project) => project.projectId === selectedProjectId) ?? null;
  const selectedProjectRuns = runsQuery.data?.filter((run) => run.projectId === selectedProjectId) ?? [];

  const registrationMutation = useMutation({
    mutationFn: (payload: ProjectRegistrationPayload) => registerProject(payload),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'projects'] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'runs'] })
      ]);
      setActionMessage(`Registered project ${result.project.projectName}`);
      setSelectedProjectId(result.project.projectId);
      navigate(`/projects/${result.project.projectId}`);
    }
  });

  const submissionMutation = useMutation({
    mutationFn: (payload: RunSubmissionPayload) => submitRun(payload),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['control-plane', 'runs'] });
      setActionMessage(`Created run ${result.platformRun.runId}`);
      navigate(`/runs/${result.platformRun.runId}`);
    }
  });

  function updateRegistrationField<K extends keyof ProjectRegistrationFormState>(
    field: K,
    value: ProjectRegistrationFormState[K]
  ): void {
    setRegistrationState((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateSubmissionField<K extends keyof SubmissionFormState>(field: K, value: SubmissionFormState[K]): void {
    setSubmissionState((current) => ({
      ...current,
      [field]: value
    }));
  }

  function submitProjectRegistration(): void {
    setActionMessage(null);
    registrationMutation.mutate(buildProjectRegistrationPayload(registrationState));
  }

  function submitProjectRun(): void {
    if (!selectedProject) {
      return;
    }

    setActionMessage(null);
    submissionMutation.mutate(buildRunSubmissionPayload(selectedProject, submissionState));
  }

  function selectProject(projectIdValue: string): void {
    setSelectedProjectId(projectIdValue);
    navigate(`/projects/${projectIdValue}`);
  }

  return {
    actionMessage,
    openRun: navigate,
    projectsQuery,
    registrationMutation,
    registrationState,
    runsQuery,
    selectedProject,
    selectedProjectRuns,
    selectedProjectId,
    selectProject,
    submissionMutation,
    submissionState,
    submitProjectRegistration,
    submitProjectRun,
    updateRegistrationField,
    updateSubmissionField
  };
}
