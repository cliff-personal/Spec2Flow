import type { ArtifactRef, ErrorItem } from './execution-state.js';
import type { TaskStatus } from './task-graph.js';

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  executionStateRef: string;
  notes: string[];
  artifacts: ArtifactRef[];
  errors: ErrorItem[];
  submittedAt: string;
}

export interface TaskResultDocument {
  taskResult: TaskResult;
}
