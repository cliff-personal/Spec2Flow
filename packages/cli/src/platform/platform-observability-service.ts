import { DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT, getPlatformRunState, type GetPlatformRunStateOptions } from './platform-scheduler-service.js';
import { PLATFORM_EVENT_TAXONOMY_VERSION, buildPlatformTimelineEntry, describePlatformEventType } from './platform-event-taxonomy.js';
import type {
  PlatformArtifactRecord,
  PlatformEventCategory,
  PlatformObservabilityAttentionItem,
  PlatformObservabilityMetrics,
  PlatformObservabilityReadModel,
  PlatformRepairAttemptRecord,
  PlatformRunStateSnapshot,
  PlatformTaskObservabilitySummary
} from '../types/index.js';
import type { SqlExecutor } from './platform-database.js';

export interface GetPlatformObservabilityOptions extends GetPlatformRunStateOptions {
  now?: string;
}

function countArtifactsByTask(artifacts: PlatformArtifactRecord[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const artifact of artifacts) {
    if (!artifact.taskId) {
      continue;
    }

    counts.set(artifact.taskId, (counts.get(artifact.taskId) ?? 0) + 1);
  }

  return counts;
}

function buildTaskSummaries(snapshot: PlatformRunStateSnapshot): PlatformTaskObservabilitySummary[] {
  const timeline = snapshot.recentEvents.map((event) => buildPlatformTimelineEntry(event));
  const latestEventByTask = new Map<string, PlatformTaskObservabilitySummary['latestEventType']>();
  const latestEventAtByTask = new Map<string, string | null>();
  const latestEventSeverityByTask = new Map<string, PlatformTaskObservabilitySummary['latestEventSeverity']>();
  const artifactCountByTask = countArtifactsByTask(snapshot.artifacts);

  for (const entry of [...timeline].sort((left, right) => {
    const leftTimestamp = Date.parse(left.createdAt ?? '');
    const rightTimestamp = Date.parse(right.createdAt ?? '');
    if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && rightTimestamp !== leftTimestamp) {
      return rightTimestamp - leftTimestamp;
    }

    return right.eventId.localeCompare(left.eventId);
  })) {
    if (!entry.taskId || latestEventByTask.has(entry.taskId)) {
      continue;
    }

    latestEventByTask.set(entry.taskId, entry.type);
    latestEventAtByTask.set(entry.taskId, entry.createdAt ?? null);
    latestEventSeverityByTask.set(entry.taskId, entry.severity);
  }

  return snapshot.tasks.map((task) => {
    const expectedArtifactCount = task.roleProfile.expectedArtifacts.length;
    const artifactCount = artifactCountByTask.get(task.taskId) ?? 0;

    return {
      taskId: task.taskId,
      stage: task.stage,
      status: task.status,
      attempts: task.attempts ?? 0,
      retryCount: task.retryCount ?? 0,
      autoRepairCount: task.autoRepairCount ?? 0,
      artifactCount,
      expectedArtifactCount,
      missingExpectedArtifactCount: Math.max(0, expectedArtifactCount - artifactCount),
      latestEventType: latestEventByTask.get(task.taskId) ?? null,
      latestEventAt: latestEventAtByTask.get(task.taskId) ?? null,
      latestEventSeverity: latestEventSeverityByTask.get(task.taskId) ?? null,
      leasedByWorkerId: task.leasedByWorkerId ?? null,
      leaseExpiresAt: task.leaseExpiresAt ?? null
    };
  });
}

function buildMetrics(snapshot: PlatformRunStateSnapshot, now: string): PlatformObservabilityMetrics {
  const timeline = snapshot.recentEvents.map((event) => buildPlatformTimelineEntry(event));
  const artifactCountByTask = countArtifactsByTask(snapshot.artifacts);
  const eventCategoryCounts: Record<PlatformEventCategory, number> = {
    run: 0,
    planning: 0,
    task: 0,
    artifact: 0,
    repair: 0,
    publication: 0,
    approval: 0,
    unknown: 0
  };

  for (const entry of timeline) {
    eventCategoryCounts[entry.category] += 1;
  }

  const runStart = snapshot.run?.startedAt ?? snapshot.run?.createdAt ?? null;
  const runEnd = snapshot.run?.completedAt ?? now;
  const runDurationSeconds = runStart
    ? Math.max(0, Math.round((Date.parse(runEnd) - Date.parse(runStart)) / 1000))
    : null;

  const failureClassFrequency = snapshot.repairAttempts.reduce<Record<string, number>>((accumulator, attempt) => {
    accumulator[attempt.failureClass] = (accumulator[attempt.failureClass] ?? 0) + 1;
    return accumulator;
  }, {});

  const tasksWithMissingExpectedArtifacts = snapshot.tasks.filter((task) => {
    const expectedCount = task.roleProfile.expectedArtifacts.length;
    const actualCount = artifactCountByTask.get(task.taskId) ?? 0;
    return expectedCount > actualCount;
  }).length;

  return {
    runDurationSeconds,
    latestEventAt: timeline[timeline.length - 1]?.createdAt ?? snapshot.run?.updatedAt ?? null,
    tasks: {
      total: snapshot.tasks.length,
      pending: snapshot.tasks.filter((task) => task.status === 'pending').length,
      ready: snapshot.tasks.filter((task) => task.status === 'ready').length,
      leased: snapshot.tasks.filter((task) => task.status === 'leased').length,
      inProgress: snapshot.tasks.filter((task) => task.status === 'in-progress').length,
      blocked: snapshot.tasks.filter((task) => task.status === 'blocked').length,
      completed: snapshot.tasks.filter((task) => task.status === 'completed').length,
      failed: snapshot.tasks.filter((task) => task.status === 'failed').length,
      skipped: snapshot.tasks.filter((task) => task.status === 'skipped').length,
      retryableFailed: snapshot.tasks.filter((task) => task.status === 'retryable-failed').length,
      cancelled: snapshot.tasks.filter((task) => task.status === 'cancelled').length
    },
    repairs: {
      total: snapshot.repairAttempts.length,
      requested: snapshot.repairAttempts.filter((attempt) => attempt.status === 'requested').length,
      succeeded: snapshot.repairAttempts.filter((attempt) => attempt.status === 'succeeded').length,
      failed: snapshot.repairAttempts.filter((attempt) => attempt.status === 'failed').length,
      blocked: snapshot.repairAttempts.filter((attempt) => attempt.status === 'blocked').length,
      failureClassFrequency
    },
    publications: {
      total: snapshot.publications.length,
      published: snapshot.publications.filter((publication) => publication.status === 'published').length,
      approvalRequired: snapshot.publications.filter((publication) => publication.status === 'approval-required').length,
      blocked: snapshot.publications.filter((publication) => publication.status === 'blocked').length
    },
    artifacts: {
      total: snapshot.artifacts.length,
      expected: snapshot.tasks.reduce((sum, task) => sum + task.roleProfile.expectedArtifacts.length, 0),
      tasksWithMissingExpectedArtifacts
    },
    retries: {
      executionRetryCount: snapshot.tasks.reduce((sum, task) => sum + (task.retryCount ?? 0), 0),
      autoRepairCount: snapshot.tasks.reduce((sum, task) => sum + (task.autoRepairCount ?? 0), 0)
    },
    events: {
      recentCount: timeline.length,
      byCategory: eventCategoryCounts
    }
  };
}

function buildAttentionRequired(snapshot: PlatformRunStateSnapshot): PlatformObservabilityAttentionItem[] {
  const items: PlatformObservabilityAttentionItem[] = [];

  for (const task of snapshot.tasks) {
    if (task.status === 'blocked' || task.status === 'failed') {
      items.push({
        kind: 'task',
        severity: task.status === 'failed' ? 'error' : 'warning',
        taskId: task.taskId,
        message: `${task.taskId} is ${task.status}`
      });
    }
  }

  for (const attempt of snapshot.repairAttempts) {
    if (attempt.status === 'blocked' || attempt.status === 'failed') {
      items.push({
        kind: 'repair',
        severity: attempt.status === 'failed' ? 'error' : 'warning',
        taskId: attempt.sourceTaskId,
        message: `Repair attempt ${attempt.attemptNumber} for ${attempt.sourceTaskId} is ${attempt.status}`
      });
    }
  }

  for (const publication of snapshot.publications) {
    if (publication.status === 'approval-required' || publication.status === 'blocked') {
      items.push({
        kind: 'publication',
        severity: publication.status === 'blocked' ? 'warning' : 'info',
        taskId: typeof publication.metadata?.taskId === 'string' ? publication.metadata.taskId : null,
        message: `Publication ${publication.publicationId} is ${publication.status}`
      });
    }
  }

  return items;
}

function buildTimeline(snapshot: PlatformRunStateSnapshot) {
  return [...snapshot.recentEvents]
    .map((event) => buildPlatformTimelineEntry(event))
    .sort((left, right) => {
      const leftTimestamp = Date.parse(left.createdAt ?? '');
      const rightTimestamp = Date.parse(right.createdAt ?? '');
      if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
      }

      return left.eventId.localeCompare(right.eventId);
    });
}

export function buildPlatformObservabilityReadModel(
  snapshot: PlatformRunStateSnapshot,
  options: { now?: string } = {}
): PlatformObservabilityReadModel {
  const now = options.now ?? new Date().toISOString();

  return {
    taxonomyVersion: PLATFORM_EVENT_TAXONOMY_VERSION,
    run: snapshot.run,
    metrics: buildMetrics(snapshot, now),
    timeline: buildTimeline(snapshot),
    taskSummaries: buildTaskSummaries(snapshot),
    recentEvents: snapshot.recentEvents,
    repairs: snapshot.repairAttempts,
    publications: snapshot.publications,
    attentionRequired: buildAttentionRequired(snapshot)
  };
}

export async function getPlatformObservability(
  executor: SqlExecutor,
  schema: string,
  options: GetPlatformObservabilityOptions
): Promise<PlatformObservabilityReadModel> {
  const snapshot = await getPlatformRunState(executor, schema, {
    runId: options.runId,
    eventLimit: options.eventLimit ?? DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT
  });

  return buildPlatformObservabilityReadModel(snapshot, {
    now: options.now
  });
}
