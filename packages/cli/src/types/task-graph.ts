import type { ReviewPolicy } from './review-policy.js';

export type TaskStage =
  | 'environment-preparation'
  | 'requirements-analysis'
  | 'code-implementation'
  | 'test-design'
  | 'automated-execution'
  | 'defect-feedback'
  | 'collaboration';

export type TaskExecutorType =
  | 'controller-agent'
  | 'requirements-agent'
  | 'implementation-agent'
  | 'test-design-agent'
  | 'execution-agent'
  | 'defect-agent'
  | 'review-agent'
  | 'human';

export type TaskStatus =
  | 'pending'
  | 'ready'
  | 'in-progress'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'skipped';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TaskGraphSource {
  requirementSummaryRef?: string;
  requirementRef?: string | null;
  requirementText?: string;
  projectAdapterRef?: string | null;
  topologyRef?: string | null;
  riskPolicyRef?: string | null;
  changeSet?: string[];
  routeSelectionMode?: string | null;
  selectedRoutes?: string[];
}

export interface Task {
  id: string;
  stage: TaskStage;
  title: string;
  goal: string;
  executorType: TaskExecutorType;
  status: TaskStatus;
  riskLevel?: RiskLevel;
  dependsOn?: string[];
  inputs?: Record<string, unknown>;
  targetFiles?: string[];
  verifyCommands?: string[];
  artifactsDir?: string;
  reviewPolicy?: ReviewPolicy;
}

export interface TaskGraph {
  id: string;
  workflowName: string;
  source?: TaskGraphSource;
  tasks: Task[];
}

export interface TaskGraphDocument {
  taskGraph: TaskGraph;
}
