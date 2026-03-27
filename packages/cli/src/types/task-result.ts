import type { ArtifactRef, ErrorItem } from './execution-state.js';
import type { TaskStatus } from './task-graph.js';

export type ArtifactContractStatus = 'not-applicable' | 'satisfied' | 'partial' | 'missing';

export interface ArtifactContractSummary {
  status: ArtifactContractStatus;
  expectedArtifacts: string[];
  presentArtifacts: string[];
  missingArtifacts: string[];
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  executionStateRef: string;
  notes: string[];
  artifacts: ArtifactRef[];
  artifactContract: ArtifactContractSummary;
  errors: ErrorItem[];
  submittedAt: string;
}

export interface TaskResultDocument {
  taskResult: TaskResult;
}
