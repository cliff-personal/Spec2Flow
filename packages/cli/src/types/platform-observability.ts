import type { PlatformEventRecord, PlatformPublicationRecord, PlatformRepairAttemptRecord, PlatformRunRecord, PlatformTaskRecord } from './platform-persistence.js';

export type PlatformEventCategory =
  | 'run'
  | 'planning'
  | 'task'
  | 'artifact'
  | 'repair'
  | 'publication'
  | 'approval'
  | 'unknown';

export type PlatformEventSeverity = 'info' | 'warning' | 'error';

export interface PlatformObservabilityTimelineEntry {
  eventId: string;
  createdAt: string | null;
  taskId?: string | null;
  type: string;
  category: PlatformEventCategory;
  action: string;
  title: string;
  severity: PlatformEventSeverity;
  payload: Record<string, unknown>;
}

export interface PlatformTaskObservabilitySummary {
  taskId: string;
  stage: PlatformTaskRecord['stage'];
  status: PlatformTaskRecord['status'];
  attempts: number;
  retryCount: number;
  autoRepairCount: number;
  artifactCount: number;
  expectedArtifactCount: number;
  missingExpectedArtifactCount: number;
  latestEventType?: string | null;
  latestEventAt?: string | null;
  latestEventSeverity?: PlatformEventSeverity | null;
  leasedByWorkerId?: string | null;
  leaseExpiresAt?: string | null;
}

export interface PlatformObservabilityMetrics {
  runDurationSeconds: number | null;
  latestEventAt: string | null;
  tasks: {
    total: number;
    pending: number;
    ready: number;
    leased: number;
    inProgress: number;
    blocked: number;
    completed: number;
    failed: number;
    skipped: number;
    retryableFailed: number;
    cancelled: number;
  };
  repairs: {
    total: number;
    requested: number;
    succeeded: number;
    failed: number;
    blocked: number;
    failureClassFrequency: Record<string, number>;
  };
  publications: {
    total: number;
    published: number;
    approvalRequired: number;
    blocked: number;
  };
  artifacts: {
    total: number;
    expected: number;
    tasksWithMissingExpectedArtifacts: number;
  };
  retries: {
    executionRetryCount: number;
    autoRepairCount: number;
  };
  events: {
    recentCount: number;
    byCategory: Record<PlatformEventCategory, number>;
  };
}

export interface PlatformObservabilityAttentionItem {
  kind: 'task' | 'repair' | 'publication';
  severity: PlatformEventSeverity;
  taskId?: string | null;
  message: string;
}

export interface PlatformObservabilityReadModel {
  taxonomyVersion: string;
  run: PlatformRunRecord | null;
  metrics: PlatformObservabilityMetrics;
  timeline: PlatformObservabilityTimelineEntry[];
  taskSummaries: PlatformTaskObservabilitySummary[];
  recentEvents: PlatformEventRecord[];
  repairs: PlatformRepairAttemptRecord[];
  publications: PlatformPublicationRecord[];
  attentionRequired: PlatformObservabilityAttentionItem[];
}
