import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRunDetail, getRunObservability, getRunTasks, postTaskAction } from '../lib/control-plane-api';
import type { TaskActionType } from '../lib/control-plane-ui-types';

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
    mutationFn: async (payload: { taskId: string; action: TaskActionType }) => {
      await postTaskAction(payload.taskId, payload.action, runId);
    },
    onSuccess: async () => {
      setActionMessage('Task action completed');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-detail', runId] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-tasks', runId] }),
        queryClient.invalidateQueries({ queryKey: ['control-plane', 'run-observability', runId] })
      ]);
    }
  });

  function triggerTaskAction(taskId: string, action: TaskActionType): void {
    setActionMessage(null);
    actionMutation.mutate({ taskId, action });
  }

  return {
    runDetailQuery,
    tasksQuery,
    observabilityQuery,
    actionMutation,
    actionMessage,
    triggerTaskAction
  };
}