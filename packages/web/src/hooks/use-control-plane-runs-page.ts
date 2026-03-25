import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listRuns } from '../lib/control-plane-api';

export function useControlPlaneRunsPage() {
  const navigate = useNavigate();
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ['control-plane', 'runs'],
    queryFn: listRuns,
    retry: false,
    refetchInterval: 10000
  });

  return {
    runsQuery,
    actionMessage,
    setActionMessage,
    openRun: navigate
  };
}
