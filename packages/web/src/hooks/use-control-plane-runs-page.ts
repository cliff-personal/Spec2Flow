import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { selectAttentionCandidateRuns, deriveRunAttentionItems } from '../components/run-attention-panel';
import { getRunObservability, listRuns, postRunAction } from '../lib/control-plane-api';
import type { RunActionType } from '../lib/control-plane-ui-types';

function formatRunActionMessage(result: { action: RunActionType; rerouteTargetStage?: string | null; currentStage?: string | null }): string {
  switch (result.action) {
    case 'resume-from-target-stage':
      return `Resumed from ${result.rerouteTargetStage ?? result.currentStage ?? 'reroute target'}`;
    case 'pause':
      return 'Run paused';
    case 'approve-publication':
      return 'Publication approved';
    case 'force-publish':
      return 'Publication forced through';
    case 'cancel-route':
      return 'Repair route cancelled';
    case 'reroute-to-requirements-analysis':
      return 'Repair rerouted to requirements analysis';
    case 'reroute-to-code-implementation':
      return 'Repair rerouted to code implementation';
    case 'reroute-to-test-design':
      return 'Repair rerouted to test design';
    case 'reroute-to-automated-execution':
      return 'Repair rerouted to automated execution';
    default:
      return 'Run resumed';
  }
}

export function useControlPlaneRunsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ['control-plane', 'runs'],
    queryFn: listRuns,
    retry: false,
    refetchInterval: 10000
  });

  const attentionCandidates = useMemo(
    () => selectAttentionCandidateRuns(runsQuery.data ?? []),
    [runsQuery.data]
  );

  const attentionObservabilityQueries = useQueries({
    queries: attentionCandidates.map((run) => ({
      queryKey: ['control-plane', 'run-observability', run.runId, 'attention-deck'],
      queryFn: () => getRunObservability(run.runId, 40),
      enabled: runsQuery.isSuccess,
      retry: false,
      refetchInterval: 10000,
    })),
  });

  const attentionItems = useMemo(() => {
    const observabilityByRunId = Object.fromEntries(
      attentionCandidates.map((run, index) => [run.runId, attentionObservabilityQueries[index]?.data])
    );

    return deriveRunAttentionItems(attentionCandidates, observabilityByRunId);
  }, [attentionCandidates, attentionObservabilityQueries]);

  const runActionMutation = useMutation({
    mutationFn: async (payload: { runId: string; action: RunActionType; note?: string }) =>
      postRunAction(payload.runId, payload.action, payload.note),
    onSuccess: async (result) => {
      setActionMessage(formatRunActionMessage(result));

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'runs'] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-observability'] })
      ]);
    }
  });

  function triggerRunAction(runId: string, action: RunActionType): void {
    setActionMessage(null);
    const note = action === 'resume-from-target-stage'
      ? 'Resume latest evaluator reroute directly from queue'
      : action.startsWith('reroute-to-')
        ? 'Override evaluator repair route from queue'
        : action === 'cancel-route'
          ? 'Cancel active evaluator repair route from queue'
          : undefined;
    runActionMutation.mutate({ runId, action, ...(note ? { note } : {}) });
  }

  return {
    runsQuery,
    attentionItems,
    runActionMutation,
    actionMessage,
    triggerRunAction,
    openRun: navigate
  };
}
