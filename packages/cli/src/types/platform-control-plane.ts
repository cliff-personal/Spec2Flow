import type { PlatformObservabilityReadModel } from './platform-observability.js';
import type { PlatformRunRecord, PlatformRunStateSnapshot, PlatformTaskRecord } from './platform-persistence.js';

export interface PlatformControlPlaneRunListItem {
  runId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryRootPath: string;
  workflowName: string;
  status: PlatformRunRecord['status'];
  currentStage: PlatformRunRecord['currentStage'];
  riskLevel: PlatformRunRecord['riskLevel'];
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PlatformControlPlaneRunDetail {
  runState: PlatformRunStateSnapshot;
  platformObservability: PlatformObservabilityReadModel;
}

export interface PlatformControlPlaneTaskList {
  tasks: PlatformTaskRecord[];
}

export interface PlatformControlPlaneTaskActionResult {
  action: 'retry' | 'approve' | 'reject';
  runId: string;
  taskId: string;
  taskStatus: PlatformTaskRecord['status'];
  runStatus: PlatformRunRecord['status'];
  currentStage: PlatformRunRecord['currentStage'];
  publicationId?: string | null;
  publicationStatus?: string | null;
}

export interface PlatformControlPlaneRunListDocument {
  runs: PlatformControlPlaneRunListItem[];
}

export interface PlatformControlPlaneRunDetailDocument {
  run: PlatformControlPlaneRunDetail;
}

export interface PlatformControlPlaneTaskActionDocument {
  action: PlatformControlPlaneTaskActionResult;
}

export interface PlatformControlPlaneErrorDocument {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}