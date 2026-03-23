import type { TaskExecutionMode } from './adapter-run.js';
import type { TaskStatus } from './task-graph.js';

export interface WorkflowLoopReceiptSummary {
  taskId: string;
  status: TaskStatus;
  claimRef: string;
  adapterRunRef: string;
  executionMode: TaskExecutionMode;
}

export interface WorkflowLoopSummary {
  runId: string | null;
  workflowName: string | null;
  maxSteps: number;
  stepsExecuted: number;
  stopReason: string;
  claimedTaskIds: string[];
  receipts: WorkflowLoopReceiptSummary[];
}

export interface WorkflowLoopSummaryDocument {
  workflowLoop: WorkflowLoopSummary;
}
