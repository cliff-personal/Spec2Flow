import type { RiskLevel, TaskStage, TaskStatus } from './task-graph.js';

export type ExecutionStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';

export type ArtifactKind = 'log' | 'trace' | 'screenshot' | 'video' | 'report' | 'bug-draft' | 'diff' | 'other';

export interface ProviderSessionMetadata {
  adapter: string;
  model?: string;
  sessionId?: string;
}

export interface ArtifactRef {
  id: string;
  kind: ArtifactKind;
  path: string;
  taskId?: string;
}

export interface ErrorItem {
  code: string;
  message: string;
  taskId?: string;
  recoverable?: boolean;
}

export interface TaskState {
  taskId: string;
  status: TaskStatus;
  executor?: string;
  attempts?: number;
  startedAt?: string;
  completedAt?: string;
  artifactRefs?: string[];
  notes?: string[];
}

export interface ExecutionState {
  runId: string;
  workflowName: string;
  status: ExecutionStatus;
  currentStage?: TaskStage;
  provider?: ProviderSessionMetadata;
  startedAt?: string;
  updatedAt?: string;
  tasks: TaskState[];
  artifacts?: ArtifactRef[];
  errors?: ErrorItem[];
}

export interface ExecutionStateDocument {
  executionState: ExecutionState;
}

export interface TaskContextSummary {
  taskId: string;
  stage?: TaskStage;
  riskLevel?: RiskLevel;
}
