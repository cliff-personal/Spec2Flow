import type { ArtifactRef, ErrorItem } from './execution-state.js';
import type { TaskStage, TaskStatus } from './task-graph.js';
import type { TaskResult } from './task-result.js';

export interface AdapterRunActivity {
  commands: string[];
  editedFiles: string[];
  artifactFiles: string[];
  collaborationActions: string[];
}

export interface AdapterRun {
  adapterName: string;
  provider: string;
  taskId: string;
  runId: string;
  stage: TaskStage;
  status: TaskStatus;
  summary: string;
  notes: string[];
  activity: AdapterRunActivity;
  artifacts: ArtifactRef[];
  errors: ErrorItem[];
}

export interface AdapterRunDocument {
  adapterRun: AdapterRun;
}

export type TaskExecutionMode = 'external-adapter' | 'simulation';

export interface TaskExecutionResult {
  adapterRun: AdapterRun;
  receipt: TaskResult;
  mode: TaskExecutionMode;
}
