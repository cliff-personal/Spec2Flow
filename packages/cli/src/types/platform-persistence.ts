import type { ArtifactKind } from './execution-state.js';
import type { ReviewPolicy } from './review-policy.js';
import type { RiskLevel, TaskExecutorType, TaskRoleProfile, TaskStage, TaskStatus } from './task-graph.js';

export type PlatformRunStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';

export type PlatformTaskStatus =
  | TaskStatus
  | 'leased'
  | 'retryable-failed'
  | 'cancelled';

export interface PlatformWorkerIdentity {
  workerId: string;
}

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
  status: PlatformRunStatus;
  currentStage: TaskStage | null;
  riskLevel: RiskLevel | null;
  requestPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface PlatformTaskRecord {
  runId: string;
  taskId: string;
  stage: TaskStage;
  title: string;
  goal: string;
  executorType: TaskExecutorType;
  status: PlatformTaskStatus;
  riskLevel?: RiskLevel | null;
  dependsOn: string[];
  targetFiles: string[];
  verifyCommands: string[];
  inputs: Record<string, unknown>;
  roleProfile: TaskRoleProfile;
  reviewPolicy?: ReviewPolicy | null;
  artifactsDir?: string | null;
  attempts?: number;
  retryCount?: number;
  maxRetries?: number;
  autoRepairCount?: number;
  maxAutoRepairAttempts?: number;
  currentLeaseId?: string | null;
  leasedByWorkerId?: string | null;
  leaseExpiresAt?: string | null;
  lastHeartbeatAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export type PlatformRepairAttemptStatus = 'requested' | 'succeeded' | 'failed' | 'blocked';

export interface PlatformRepairAttemptRecord {
  repairAttemptId: string;
  runId: string;
  sourceTaskId: string;
  triggerTaskId: string;
  sourceStage: TaskStage;
  failureClass: string;
  recommendedAction?: string | null;
  attemptNumber: number;
  status: PlatformRepairAttemptStatus;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}

export interface PlatformPublicationRecord {
  publicationId: string;
  runId: string;
  branchName?: string | null;
  commitSha?: string | null;
  prUrl?: string | null;
  publishMode: string;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PlatformTaskLeaseRecord {
  runId: string;
  taskId: string;
  stage: TaskStage;
  status: Extract<PlatformTaskStatus, 'leased' | 'in-progress'>;
  workerId: string;
  leaseId: string;
  attemptNumber: number;
  leaseExpiresAt: string;
  lastHeartbeatAt: string;
  leaseTtlSeconds: number;
  heartbeatIntervalSeconds: number;
}

export interface PlatformEventRecord {
  eventId: string;
  runId: string;
  taskId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt?: string | null;
}

export interface PlatformArtifactRecord {
  artifactId: string;
  runId: string;
  taskId?: string | null;
  kind: ArtifactKind;
  path: string;
  schemaType?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
}

export interface PlatformRunStateSnapshot {
  run: PlatformRunRecord | null;
  tasks: PlatformTaskRecord[];
  recentEvents: PlatformEventRecord[];
  artifacts: PlatformArtifactRecord[];
  repairAttempts: PlatformRepairAttemptRecord[];
  publications: PlatformPublicationRecord[];
}
