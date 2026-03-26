import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { selectAttentionCandidateRuns, deriveRunAttentionItems } from '../components/run-attention-panel';
import { getRunObservability, listRuns } from '../lib/control-plane-api';

export function useControlPlaneRunsPage() {
  const navigate = useNavigate();
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

  return {
    runsQuery,
    attentionItems,
    actionMessage,
    setActionMessage,
    openRun: navigate
  };
}
