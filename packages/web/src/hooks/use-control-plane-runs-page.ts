import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { selectAttentionCandidateRuns, deriveRunAttentionItems } from '../components/run-attention-panel';
import { getRunObservability, listRuns, postRunAction } from '../lib/control-plane-api';
import type { RunActionType } from '../lib/control-plane-ui-types';

function formatRunActionMessage(result: { action: RunActionType; rerouteTargetStage?: string | null; currentStage?: string | null }): string {
  switch (result.action) {
    case 'resume-from-target-stage':
      return `已从 ${result.rerouteTargetStage ?? result.currentStage ?? '目标阶段'} 继续`;
    case 'pause':
      return '任务已停止';
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
      return '任务已继续';
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
    let note: string | undefined;
    if (action === 'resume-from-target-stage') {
      note = '从队列直接继续最新的评估器改道路径';
    } else if (action.startsWith('reroute-to-')) {
      note = '从队列覆盖评估器修复路径';
    } else if (action === 'cancel-route') {
      note = '从队列取消当前评估器修复路径';
    }

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
