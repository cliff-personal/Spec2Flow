import type { PlatformEventTaxonomyDescriptor, PlatformObservabilityTimelineEntry } from '../types/platform-observability.js';
import type { PlatformEventRecord } from '../types/platform-persistence.js';

export const PLATFORM_EVENT_TAXONOMY_VERSION = 'phase-6-v1';

export const PLATFORM_EVENT_TYPES = {
  RUN_CREATED: 'run.created',
  PLANNING_COMPLETED: 'planning.completed',
  TASKS_PERSISTED: 'tasks.persisted',
  TASK_LEASED: 'task.leased',
  TASK_HEARTBEAT: 'task.heartbeat',
  TASK_STARTED: 'task.started',
  TASK_READY: 'task.ready',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  TASK_BLOCKED: 'task.blocked',
  TASK_SKIPPED: 'task.skipped',
  TASK_LEASE_EXPIRED: 'task.lease-expired',
  TASK_RETRY_SCHEDULED: 'task.retry-scheduled',
  TASK_REQUEUED: 'task.requeued',
  TASK_RETRY_EXHAUSTED: 'task.retry-exhausted',
  TASK_ERRORS_RECORDED: 'task.errors-recorded',
  ARTIFACT_ATTACHED: 'artifact.attached',
  REPAIR_TRIGGERED: 'repair.triggered',
  REPAIR_ESCALATED: 'repair.escalated',
  REPAIR_SUCCEEDED: 'repair.succeeded',
  REPAIR_FAILED: 'repair.failed',
  REPAIR_BLOCKED: 'repair.blocked',
  PUBLICATION_PREPARED: 'publication.prepared',
  PUBLICATION_APPROVAL_REQUIRED: 'publication.approval-required',
  PUBLICATION_BLOCKED: 'publication.blocked',
  PUBLICATION_PUBLISHED: 'publication.published',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_APPROVED: 'approval.approved',
  APPROVAL_REJECTED: 'approval.rejected'
} as const;

export type PlatformEventType = typeof PLATFORM_EVENT_TYPES[keyof typeof PLATFORM_EVENT_TYPES];

const platformEventDescriptors: Record<string, PlatformEventTaxonomyDescriptor> = {
  [PLATFORM_EVENT_TYPES.RUN_CREATED]: {
    type: PLATFORM_EVENT_TYPES.RUN_CREATED,
    category: 'run',
    action: 'created',
    title: 'Run created',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.PLANNING_COMPLETED]: {
    type: PLATFORM_EVENT_TYPES.PLANNING_COMPLETED,
    category: 'planning',
    action: 'completed',
    title: 'Planning completed',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.TASKS_PERSISTED]: {
    type: PLATFORM_EVENT_TYPES.TASKS_PERSISTED,
    category: 'planning',
    action: 'persisted',
    title: 'Tasks persisted',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.TASK_LEASED]: {
    type: PLATFORM_EVENT_TYPES.TASK_LEASED,
    category: 'task',
    action: 'leased',
    title: 'Task leased',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.TASK_HEARTBEAT]: {
    type: PLATFORM_EVENT_TYPES.TASK_HEARTBEAT,
    category: 'task',
    action: 'heartbeat',
    title: 'Task heartbeat renewed',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.TASK_STARTED]: {
    type: PLATFORM_EVENT_TYPES.TASK_STARTED,
    category: 'task',
    action: 'started',
    title: 'Task started',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.TASK_READY]: {
    type: PLATFORM_EVENT_TYPES.TASK_READY,
    category: 'task',
    action: 'ready',
    title: 'Task ready',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.TASK_COMPLETED]: {
    type: PLATFORM_EVENT_TYPES.TASK_COMPLETED,
    category: 'task',
    action: 'completed',
    title: 'Task completed',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.TASK_FAILED]: {
    type: PLATFORM_EVENT_TYPES.TASK_FAILED,
    category: 'task',
    action: 'failed',
    title: 'Task failed',
    severity: 'error'
  },
  [PLATFORM_EVENT_TYPES.TASK_BLOCKED]: {
    type: PLATFORM_EVENT_TYPES.TASK_BLOCKED,
    category: 'task',
    action: 'blocked',
    title: 'Task blocked',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.TASK_SKIPPED]: {
    type: PLATFORM_EVENT_TYPES.TASK_SKIPPED,
    category: 'task',
    action: 'skipped',
    title: 'Task skipped',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.TASK_LEASE_EXPIRED]: {
    type: PLATFORM_EVENT_TYPES.TASK_LEASE_EXPIRED,
    category: 'task',
    action: 'lease-expired',
    title: 'Task lease expired',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.TASK_RETRY_SCHEDULED]: {
    type: PLATFORM_EVENT_TYPES.TASK_RETRY_SCHEDULED,
    category: 'task',
    action: 'retry-scheduled',
    title: 'Task retry scheduled',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.TASK_REQUEUED]: {
    type: PLATFORM_EVENT_TYPES.TASK_REQUEUED,
    category: 'task',
    action: 'requeued',
    title: 'Task requeued',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.TASK_RETRY_EXHAUSTED]: {
    type: PLATFORM_EVENT_TYPES.TASK_RETRY_EXHAUSTED,
    category: 'task',
    action: 'retry-exhausted',
    title: 'Task retry budget exhausted',
    severity: 'error'
  },
  [PLATFORM_EVENT_TYPES.TASK_ERRORS_RECORDED]: {
    type: PLATFORM_EVENT_TYPES.TASK_ERRORS_RECORDED,
    category: 'task',
    action: 'errors-recorded',
    title: 'Task errors recorded',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.ARTIFACT_ATTACHED]: {
    type: PLATFORM_EVENT_TYPES.ARTIFACT_ATTACHED,
    category: 'artifact',
    action: 'attached',
    title: 'Artifact attached',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.REPAIR_TRIGGERED]: {
    type: PLATFORM_EVENT_TYPES.REPAIR_TRIGGERED,
    category: 'repair',
    action: 'triggered',
    title: 'Repair triggered',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.REPAIR_ESCALATED]: {
    type: PLATFORM_EVENT_TYPES.REPAIR_ESCALATED,
    category: 'repair',
    action: 'escalated',
    title: 'Repair escalated',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.REPAIR_SUCCEEDED]: {
    type: PLATFORM_EVENT_TYPES.REPAIR_SUCCEEDED,
    category: 'repair',
    action: 'succeeded',
    title: 'Repair succeeded',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.REPAIR_FAILED]: {
    type: PLATFORM_EVENT_TYPES.REPAIR_FAILED,
    category: 'repair',
    action: 'failed',
    title: 'Repair failed',
    severity: 'error'
  },
  [PLATFORM_EVENT_TYPES.REPAIR_BLOCKED]: {
    type: PLATFORM_EVENT_TYPES.REPAIR_BLOCKED,
    category: 'repair',
    action: 'blocked',
    title: 'Repair blocked',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.PUBLICATION_PREPARED]: {
    type: PLATFORM_EVENT_TYPES.PUBLICATION_PREPARED,
    category: 'publication',
    action: 'prepared',
    title: 'Publication prepared',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.PUBLICATION_APPROVAL_REQUIRED]: {
    type: PLATFORM_EVENT_TYPES.PUBLICATION_APPROVAL_REQUIRED,
    category: 'publication',
    action: 'approval-required',
    title: 'Publication awaiting approval',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.PUBLICATION_BLOCKED]: {
    type: PLATFORM_EVENT_TYPES.PUBLICATION_BLOCKED,
    category: 'publication',
    action: 'blocked',
    title: 'Publication blocked',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.PUBLICATION_PUBLISHED]: {
    type: PLATFORM_EVENT_TYPES.PUBLICATION_PUBLISHED,
    category: 'publication',
    action: 'published',
    title: 'Publication published',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.APPROVAL_REQUESTED]: {
    type: PLATFORM_EVENT_TYPES.APPROVAL_REQUESTED,
    category: 'approval',
    action: 'requested',
    title: 'Approval requested',
    severity: 'warning'
  },
  [PLATFORM_EVENT_TYPES.APPROVAL_APPROVED]: {
    type: PLATFORM_EVENT_TYPES.APPROVAL_APPROVED,
    category: 'approval',
    action: 'approved',
    title: 'Approval granted',
    severity: 'info'
  },
  [PLATFORM_EVENT_TYPES.APPROVAL_REJECTED]: {
    type: PLATFORM_EVENT_TYPES.APPROVAL_REJECTED,
    category: 'approval',
    action: 'rejected',
    title: 'Approval rejected',
    severity: 'warning'
  }
};

export function describePlatformEventType(eventType: string): PlatformEventTaxonomyDescriptor {
  return platformEventDescriptors[eventType] ?? {
    type: eventType,
    category: 'unknown',
    action: 'unknown',
    title: eventType,
    severity: 'info'
  };
}

export function listPlatformEventTaxonomyDescriptors(): PlatformEventTaxonomyDescriptor[] {
  return Object.values(platformEventDescriptors).sort((left, right) => left.type.localeCompare(right.type));
}

export function buildPlatformTimelineEntry(event: PlatformEventRecord): PlatformObservabilityTimelineEntry {
  const descriptor = describePlatformEventType(event.eventType);
  return {
    eventId: event.eventId,
    createdAt: event.createdAt ?? null,
    taskId: event.taskId ?? null,
    type: descriptor.type,
    category: descriptor.category,
    action: descriptor.action,
    title: descriptor.title,
    severity: descriptor.severity,
    payload: event.payload
  };
}
