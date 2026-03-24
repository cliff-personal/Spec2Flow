import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listRuns, submitRun, type RunSubmissionPayload } from '../lib/control-plane-api';
import { parseChangedFiles } from '../lib/control-plane-formatters';
import type { SubmissionFormState } from '../lib/control-plane-ui-types';

const INITIAL_SUBMISSION_STATE: SubmissionFormState = {
  repositoryRootPath: '/Users/cliff/workspace/Synapse-Network',
  requirement: '',
  requirementPath: 'docs/provider_service/api/web3-sentiment-index.md',
  changedFiles: 'docs/provider_service/api/web3-sentiment-index.md'
};

export function useControlPlaneRunsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submissionState, setSubmissionState] = useState(INITIAL_SUBMISSION_STATE);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ['control-plane', 'runs'],
    queryFn: listRuns,
    retry: false,
    refetchInterval: 10000
  });

  const submissionMutation = useMutation({
    mutationFn: (payload: RunSubmissionPayload) => submitRun(payload),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['control-plane', 'runs'] });
      setActionMessage(`Created run ${result.platformRun.runId}`);
      navigate(`/runs/${result.platformRun.runId}`);
    }
  });

  function updateSubmissionField<K extends keyof SubmissionFormState>(field: K, value: SubmissionFormState[K]): void {
    setSubmissionState((current) => ({
      ...current,
      [field]: value
    }));
  }

  function submitDashboardRun(): void {
    setActionMessage(null);
    submissionMutation.mutate({
      repositoryRootPath: submissionState.repositoryRootPath,
      ...(submissionState.requirement.trim() ? { requirement: submissionState.requirement.trim() } : {}),
      ...(submissionState.requirementPath.trim() ? { requirementPath: submissionState.requirementPath.trim() } : {}),
      changedFiles: parseChangedFiles(submissionState.changedFiles)
    });
  }

  return {
    runsQuery,
    submissionState,
    updateSubmissionField,
    submitDashboardRun,
    submissionMutation,
    actionMessage,
    openRun: navigate
  };
}