import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRunDetail, getRunObservability, getRunTasks, postRunAction, postTaskAction } from '../lib/control-plane-api';
import type { RunActionType, TaskActionType } from '../lib/control-plane-ui-types';

function formatRunActionMessage(action: RunActionType): string {
  switch (action) {
    case 'pause':
      return '任务已停止';
    case 'resume-from-target-stage':
      return '任务已从改道目标继续';
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

export function useControlPlaneRunDetailPage(runId: string) {
  const queryClient = useQueryClient();
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const runDetailQuery = useQuery({
    queryKey: ['control-plane', 'run-detail', runId],
    queryFn: () => getRunDetail(runId),
    enabled: runId.length > 0,
    retry: false
  });

  const tasksQuery = useQuery({
    queryKey: ['control-plane', 'run-tasks', runId],
    queryFn: () => getRunTasks(runId),
    enabled: runId.length > 0,
    retry: false
  });

  const observabilityQuery = useQuery({
    queryKey: ['control-plane', 'run-observability', runId],
    queryFn: () => getRunObservability(runId),
    enabled: runId.length > 0,
    retry: false,
    refetchInterval: 10000
  });

  const actionMutation = useMutation({
    mutationFn: async (payload: { taskId: string; action: TaskActionType; note?: string }) => {
      await postTaskAction(payload.taskId, payload.action, runId, payload.note);
    },
    onSuccess: async (_result, payload) => {
      if (payload.action === 'approve') {
        setActionMessage('Acceptance decision recorded');
      } else if (payload.action === 'reject') {
        setActionMessage('Follow-up decision recorded');
      } else {
        setActionMessage('Task action completed');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-detail', runId] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-tasks', runId] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-observability', runId] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'runs'] })
      ]);
    }
  });

  const runActionMutation = useMutation({
    mutationFn: async (payload: { action: RunActionType; note?: string }) => postRunAction(runId, payload.action, payload.note),
    onSuccess: async (_result, payload) => {
      setActionMessage(formatRunActionMessage(payload.action));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-detail', runId] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-tasks', runId] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-observability', runId] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'runs'] })
      ]);
    }
  });

  function triggerTaskAction(taskId: string, action: TaskActionType, note?: string): void {
    setActionMessage(null);
    actionMutation.mutate({ taskId, action, ...(note ? { note } : {}) });
  }

  function triggerRunAction(action: RunActionType, note?: string): void {
    setActionMessage(null);
    runActionMutation.mutate({ action, ...(note ? { note } : {}) });
  }

  return {
    runDetailQuery,
    tasksQuery,
    observabilityQuery,
    actionMutation,
    runActionMutation,
    actionMessage,
    triggerTaskAction,
    triggerRunAction
  };
}