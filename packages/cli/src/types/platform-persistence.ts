import type { ArtifactKind } from './execution-state.js';
import type { ReviewPolicy } from './review-policy.js';
import type { RiskLevel, TaskExecutorType, TaskRoleProfile, TaskStage, TaskStatus } from './task-graph.js';

export interface PlatformRepositoryRecord {
  repositoryId: string;
  name: string;
  rootPath: string;
  defaultBranch?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PlatformRunRecord {
  runId: string;
  repositoryId: string;
  workflowName: string;
  requestText?: string | null;
  status: string;
  currentStage: TaskStage | null;
  riskLevel: RiskLevel | null;
  requestPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PlatformTaskRecord {
  runId: string;
  taskId: string;
  stage: TaskStage;
  title: string;
  goal: string;
  executorType: TaskExecutorType;
  status: TaskStatus;
  riskLevel?: RiskLevel | null;
  dependsOn: string[];
  targetFiles: string[];
  verifyCommands: string[];
  inputs: Record<string, unknown>;
  roleProfile: TaskRoleProfile;
  reviewPolicy?: ReviewPolicy | null;
  artifactsDir?: string | null;
  attempts?: number;
}

export interface PlatformEventRecord {
  eventId: string;
  runId: string;
  taskId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface PlatformArtifactRecord {
  artifactId: string;
  runId: string;
  taskId?: string | null;
  kind: ArtifactKind;
  path: string;
  schemaType?: string | null;
  metadata?: Record<string, unknown>;
}
