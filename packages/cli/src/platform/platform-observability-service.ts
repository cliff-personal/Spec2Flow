import { DEFAULT_PLATFORM_RUN_STATE_EVENT_LIMIT, getPlatformRunState, type GetPlatformRunStateOptions } from './platform-scheduler-service.js';
import {
  PLATFORM_EVENT_TAXONOMY_VERSION,
  PLATFORM_EVENT_TYPES,
  buildPlatformTimelineEntry,
  listPlatformEventTaxonomyDescriptors
} from './platform-event-taxonomy.js';
import type {
  PlatformArtifactRecord,
  PlatformEventCategory,
  PlatformObservabilityApprovalItem,
  PlatformObservabilityAttentionItem,
  PlatformObservabilityEventTypeCount,
  PlatformObservabilityMetrics,
  PlatformPublicationObservabilitySummary,
  PlatformObservabilityReadModel,
  PlatformObservabilityTimelineEntry,
  PlatformRepairAttemptRecord,
  PlatformRepairObservabilitySummary,
  PlatformReviewDecisionStatus,
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

function formatStageLabel(stage: string): string {
  return stage
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function sortTimelineEntriesAscending(left: PlatformObservabilityTimelineEntry, right: PlatformObservabilityTimelineEntry): number {
  const leftTimestamp = Date.parse(left.createdAt ?? '');
  const rightTimestamp = Date.parse(right.createdAt ?? '');
  if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }

  return left.eventId.localeCompare(right.eventId);
}

function sortTimelineEntriesDescending(left: PlatformObservabilityTimelineEntry, right: PlatformObservabilityTimelineEntry): number {
  const leftTimestamp = Date.parse(left.createdAt ?? '');
  const rightTimestamp = Date.parse(right.createdAt ?? '');
  if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  return right.eventId.localeCompare(left.eventId);
}

function buildTimeline(snapshot: PlatformRunStateSnapshot): PlatformObservabilityTimelineEntry[] {
  return [...snapshot.recentEvents]
    .map((event) => buildPlatformTimelineEntry(event))
    .sort(sortTimelineEntriesAscending);
}

function groupTimelineByTask(timeline: PlatformObservabilityTimelineEntry[]): Map<string, PlatformObservabilityTimelineEntry[]> {
  const groupedEntries = new Map<string, PlatformObservabilityTimelineEntry[]>();

  for (const entry of timeline) {
    if (!entry.taskId) {
      continue;
    }

    const existingEntries = groupedEntries.get(entry.taskId) ?? [];
    existingEntries.push(entry);
    groupedEntries.set(entry.taskId, existingEntries);
  }

  for (const [taskId, entries] of groupedEntries) {
    groupedEntries.set(taskId, [...entries].sort(sortTimelineEntriesDescending));
  }

  return groupedEntries;
}

function getPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getPayloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getPayloadBoolean(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === true;
}

function derivePublicationReviewDecision(
  publication: PlatformRunStateSnapshot['publications'][number],
  approvalRequired: boolean
): {
  reviewDecision: PlatformReviewDecisionStatus;
  reviewDecisionAt: string | null;
  reviewDecisionBy: string | null;
  reviewDecisionNote: string | null;
} {
  const approvalStatus = getPayloadString(publication.metadata ?? {}, 'approvalStatus');
  const reviewDecisionAt = getPayloadString(publication.metadata ?? {}, 'approvalActionAt');
  const reviewDecisionBy = getPayloadString(publication.metadata ?? {}, 'approvalActor');
  const reviewDecisionNote = getPayloadString(publication.metadata ?? {}, 'approvalNote');

  if (approvalStatus === 'approved') {
    return {
      reviewDecision: 'accepted',
      reviewDecisionAt,
      reviewDecisionBy,
      reviewDecisionNote,
    };
  }

  if (approvalStatus === 'rejected') {
    return {
      reviewDecision: 'follow-up-required',
      reviewDecisionAt,
      reviewDecisionBy,
      reviewDecisionNote,
    };
  }

  if (approvalRequired || publication.status === 'approval-required') {
    return {
      reviewDecision: 'awaiting-decision',
      reviewDecisionAt,
      reviewDecisionBy,
      reviewDecisionNote,
    };
  }

  if (publication.status === 'blocked') {
    return {
      reviewDecision: 'follow-up-required',
      reviewDecisionAt,
      reviewDecisionBy,
      reviewDecisionNote,
    };
  }

  return {
    reviewDecision: 'not-required',
    reviewDecisionAt,
    reviewDecisionBy,
    reviewDecisionNote,
  };
}

function buildTaskSummaries(snapshot: PlatformRunStateSnapshot, timeline: PlatformObservabilityTimelineEntry[]): PlatformTaskObservabilitySummary[] {
  const latestEventByTask = new Map<string, PlatformTaskObservabilitySummary['latestEventType']>();
  const latestEventAtByTask = new Map<string, string | null>();
  const latestEventSeverityByTask = new Map<string, PlatformTaskObservabilitySummary['latestEventSeverity']>();
  const artifactCountByTask = countArtifactsByTask(snapshot.artifacts);
  const timelineByTask = groupTimelineByTask(timeline);

  for (const entry of [...timeline].sort(sortTimelineEntriesDescending)) {
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
      recentEvents: (timelineByTask.get(task.taskId) ?? []).slice(0, 5),
      leasedByWorkerId: task.leasedByWorkerId ?? null,
      leaseExpiresAt: task.leaseExpiresAt ?? null
    };
  });
}

function buildMetrics(snapshot: PlatformRunStateSnapshot, now: string): PlatformObservabilityMetrics {
  const timeline = buildTimeline(snapshot);
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
  const eventTypeCounts = new Map<string, PlatformObservabilityEventTypeCount>();

  for (const entry of timeline) {
    eventCategoryCounts[entry.category] += 1;
    const existingCount = eventTypeCounts.get(entry.type);
    if (existingCount) {
      existingCount.count += 1;
      continue;
    }

    eventTypeCounts.set(entry.type, {
      type: entry.type,
      category: entry.category,
      severity: entry.severity,
      count: 1
    });
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
    latestEventAt: timeline.at(-1)?.createdAt ?? snapshot.run?.updatedAt ?? null,
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
      byCategory: eventCategoryCounts,
      byType: [...eventTypeCounts.values()].sort((left, right) => left.type.localeCompare(right.type))
    }
  };
}

function mapApprovalStatus(entryType: string): PlatformObservabilityApprovalItem['status'] {
  if (entryType === PLATFORM_EVENT_TYPES.APPROVAL_APPROVED) {
    return 'approved';
  }

  if (entryType === PLATFORM_EVENT_TYPES.APPROVAL_REJECTED) {
    return 'rejected';
  }

  return 'requested';
}

function isApprovalEventType(
  entryType: string
): entryType is typeof PLATFORM_EVENT_TYPES.APPROVAL_REQUESTED | typeof PLATFORM_EVENT_TYPES.APPROVAL_APPROVED | typeof PLATFORM_EVENT_TYPES.APPROVAL_REJECTED {
  return entryType === PLATFORM_EVENT_TYPES.APPROVAL_REQUESTED
    || entryType === PLATFORM_EVENT_TYPES.APPROVAL_APPROVED
    || entryType === PLATFORM_EVENT_TYPES.APPROVAL_REJECTED;
}

function buildRepairSummaries(
  timeline: PlatformObservabilityTimelineEntry[],
  repairAttempts: PlatformRepairAttemptRecord[]
): PlatformRepairObservabilitySummary[] {
  return repairAttempts.map((attempt) => {
    const matchingEvents = timeline
      .filter((entry) => {
        const payloadRepairAttemptId = getPayloadString(entry.payload, 'repairAttemptId');
        if (payloadRepairAttemptId) {
          return payloadRepairAttemptId === attempt.repairAttemptId;
        }

        return entry.taskId === attempt.sourceTaskId && getPayloadNumber(entry.payload, 'attemptNumber') === attempt.attemptNumber;
      })
      .sort(sortTimelineEntriesDescending);
    const latestEvent = matchingEvents[0] ?? null;

    return {
      repairAttemptId: attempt.repairAttemptId,
      taskId: attempt.sourceTaskId,
      triggerTaskId: attempt.triggerTaskId,
      sourceStage: attempt.sourceStage,
      failureClass: attempt.failureClass,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      recommendedAction: attempt.recommendedAction ?? null,
      latestEventType: latestEvent?.type ?? null,
      latestEventAt: latestEvent?.createdAt ?? null,
      latestEventSeverity: latestEvent?.severity ?? null,
      recentEvents: matchingEvents.slice(0, 5)
    };
  });
}

function buildPublicationSummaries(
  timeline: PlatformObservabilityTimelineEntry[],
  publications: PlatformRunStateSnapshot['publications']
): PlatformPublicationObservabilitySummary[] {
  return publications.map((publication) => {
    const matchingEvents = timeline
      .filter((entry) => getPayloadString(entry.payload, 'publicationId') === publication.publicationId)
      .sort(sortTimelineEntriesDescending);
    const latestEvent = matchingEvents[0] ?? null;
    const taskId = typeof publication.metadata?.taskId === 'string' ? publication.metadata.taskId : null;
    const approvalRequired = publication.status === 'approval-required' || getPayloadBoolean(publication.metadata ?? {}, 'approvalRequired');
    const reviewDecision = derivePublicationReviewDecision(publication, approvalRequired);

    return {
      publicationId: publication.publicationId,
      taskId,
      status: publication.status,
      publishMode: publication.publishMode,
      branchName: publication.branchName ?? null,
      commitSha: publication.commitSha ?? null,
      prUrl: publication.prUrl ?? null,
      approvalRequired,
      gateReason: getPayloadString(publication.metadata ?? {}, 'gateReason'),
      reviewDecision: reviewDecision.reviewDecision,
      reviewDecisionAt: reviewDecision.reviewDecisionAt,
      reviewDecisionBy: reviewDecision.reviewDecisionBy,
      reviewDecisionNote: reviewDecision.reviewDecisionNote,
      latestEventType: latestEvent?.type ?? null,
      latestEventAt: latestEvent?.createdAt ?? null,
      latestEventSeverity: latestEvent?.severity ?? null,
      recentEvents: matchingEvents.slice(0, 5)
    };
  });
}

function buildApprovals(
  timeline: PlatformObservabilityTimelineEntry[],
  publications: PlatformRunStateSnapshot['publications']
): PlatformObservabilityApprovalItem[] {
  const timelineApprovals = timeline
    .filter((entry) => isApprovalEventType(entry.type))
    .map((entry) => ({
      publicationId: getPayloadString(entry.payload, 'publicationId'),
      taskId: entry.taskId ?? null,
      createdAt: entry.createdAt ?? null,
      status: mapApprovalStatus(entry.type),
      reason: getPayloadString(entry.payload, 'gateReason') ?? getPayloadString(entry.payload, 'note'),
      latestEventType: entry.type
    }));

  const backfilledApprovals = publications
    .filter((publication) => publication.status === 'approval-required')
    .filter((publication) => !timelineApprovals.some((entry) => entry.publicationId === publication.publicationId))
    .map((publication) => ({
      publicationId: publication.publicationId,
      taskId: typeof publication.metadata?.taskId === 'string' ? publication.metadata.taskId : null,
      createdAt: publication.updatedAt ?? publication.createdAt ?? null,
      status: 'requested' as const,
      reason: getPayloadString(publication.metadata ?? {}, 'gateReason'),
      latestEventType: PLATFORM_EVENT_TYPES.PUBLICATION_APPROVAL_REQUIRED
    }));

  const approvalByPublication = new Map<string, PlatformObservabilityApprovalItem>();

  for (const approval of [...timelineApprovals, ...backfilledApprovals].sort((left, right) => {
    const leftTimestamp = Date.parse(left.createdAt ?? '');
    const rightTimestamp = Date.parse(right.createdAt ?? '');
    if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }

    return String(right.publicationId ?? '').localeCompare(String(left.publicationId ?? ''));
  })) {
    const publicationKey = approval.publicationId ?? `task:${approval.taskId ?? 'unknown'}`;
    if (!approvalByPublication.has(publicationKey)) {
      approvalByPublication.set(publicationKey, approval);
    }
  }

  return [...approvalByPublication.values()];
}

function collectTaskAttentionItems(taskSummaries: PlatformTaskObservabilitySummary[]): PlatformObservabilityAttentionItem[] {
  const items: PlatformObservabilityAttentionItem[] = [];

  for (const task of taskSummaries) {
    if (task.status === 'blocked' || task.status === 'failed') {
      items.push({
        kind: 'task',
        type: task.status === 'failed' ? 'task-failed' : 'task-blocked',
        severity: task.status === 'failed' ? 'error' : 'warning',
        taskId: task.taskId,
        title: task.status === 'failed' ? `Task failed: ${task.taskId}` : `Task blocked: ${task.taskId}`,
        description: `${task.taskId} is ${task.status}.`,
      });
    }

    if (task.missingExpectedArtifactCount > 0) {
      items.push({
        kind: 'task',
        type: 'task-missing-artifacts',
        severity: 'warning',
        taskId: task.taskId,
        title: `Missing artifacts: ${task.taskId}`,
        description: `${task.taskId} is missing ${task.missingExpectedArtifactCount} expected artifact(s).`,
      });
    }
  }

  return items;
}

function collectEvaluatorRerouteAttentionItems(tasks: PlatformRunStateSnapshot['tasks']): PlatformObservabilityAttentionItem[] {
  return [...tasks]
    .filter((task) => task.evaluationDecision === 'needs-repair' && typeof task.requestedRepairTargetStage === 'string')
    .sort((left, right) => {
      const leftTimestamp = Date.parse(left.updatedAt ?? left.completedAt ?? left.createdAt ?? '');
      const rightTimestamp = Date.parse(right.updatedAt ?? right.completedAt ?? right.createdAt ?? '');
      if (!Number.isNaN(leftTimestamp) && !Number.isNaN(rightTimestamp) && leftTimestamp !== rightTimestamp) {
        return rightTimestamp - leftTimestamp;
      }

      return right.taskId.localeCompare(left.taskId);
    })
    .map((task) => {
      const repairTargetStage = task.requestedRepairTargetStage ?? null;
      const stageLabel = repairTargetStage ? formatStageLabel(repairTargetStage) : 'Requested stage';
      const summary = task.evaluationSummary?.trim();

      return {
        kind: 'task' as const,
        type: 'evaluator-reroute-requested' as const,
        severity: 'warning' as const,
        taskId: task.taskId,
        ...(repairTargetStage ? { repairTargetStage } : {}),
        title: `Evaluator requested reroute to ${stageLabel}`,
        description: summary
          ? `${task.taskId} asked the controller to flow back to ${stageLabel}. ${summary}`
          : `${task.taskId} asked the controller to flow back to ${stageLabel}.`
      };
    });
}

function collectRepairAttentionItems(repairSummaries: PlatformRepairObservabilitySummary[]): PlatformObservabilityAttentionItem[] {
  return repairSummaries
    .filter((attempt) => attempt.status === 'blocked' || attempt.status === 'failed')
    .map((attempt) => ({
      kind: 'repair' as const,
      type: attempt.status === 'failed' ? 'repair-failed' as const : 'repair-blocked' as const,
      severity: attempt.status === 'failed' ? 'error' : 'warning',
      taskId: attempt.taskId,
      title: `Repair ${attempt.status}: ${attempt.taskId}`,
      description: `Repair attempt ${attempt.attemptNumber} for ${attempt.taskId} is ${attempt.status}.`
    }));
}

function collectPublicationAttentionItems(publicationSummaries: PlatformPublicationObservabilitySummary[]): PlatformObservabilityAttentionItem[] {
  return publicationSummaries
    .filter((publication) => publication.status === 'blocked')
    .map((publication) => ({
      kind: 'publication' as const,
      type: 'publication-blocked' as const,
      severity: 'warning' as const,
      taskId: publication.taskId ?? null,
      title: `Publication blocked: ${publication.publicationId}`,
      description: `Publication ${publication.publicationId} is ${publication.status}.`
    }));
}

function collectApprovalAttentionItems(approvals: PlatformObservabilityApprovalItem[]): PlatformObservabilityAttentionItem[] {
  return approvals
    .filter((approval) => approval.status !== 'approved')
    .map((approval) => {
      let type: PlatformObservabilityAttentionItem['type'] = 'approval-requested';
      let title = 'Approval requested';

      if (approval.status === 'rejected') {
        type = 'approval-rejected';
        title = 'Approval rejected';
      } else if (approval.status === 'blocked') {
        type = 'approval-blocked';
        title = 'Approval blocked';
      }

      return {
        kind: 'publication' as const,
        type,
        severity: approval.status === 'rejected' || approval.status === 'blocked' ? 'warning' as const : 'info' as const,
        taskId: approval.taskId ?? null,
        title,
        description: `Approval is ${approval.status} for publication ${approval.publicationId ?? 'unknown'}.`
      };
    });
}

function getAttentionPriority(item: PlatformObservabilityAttentionItem): number {
  switch (item.type) {
    case 'evaluator-reroute-requested':
      return 400;
    case 'task-failed':
      return 300;
    case 'task-blocked':
      return 250;
    case 'repair-failed':
      return 220;
    case 'repair-blocked':
      return 210;
    case 'publication-blocked':
      return 180;
    case 'approval-rejected':
      return 170;
    case 'approval-blocked':
      return 160;
    case 'approval-requested':
      return 150;
    case 'task-missing-artifacts':
      return 120;
    default:
      return 0;
  }
}

function buildAttentionRequired(
  tasks: PlatformRunStateSnapshot['tasks'],
  taskSummaries: PlatformTaskObservabilitySummary[],
  repairSummaries: PlatformRepairObservabilitySummary[],
  publicationSummaries: PlatformPublicationObservabilitySummary[],
  approvals: PlatformObservabilityApprovalItem[]
): PlatformObservabilityAttentionItem[] {
  return [
    ...collectEvaluatorRerouteAttentionItems(tasks),
    ...collectTaskAttentionItems(taskSummaries),
    ...collectRepairAttentionItems(repairSummaries),
    ...collectPublicationAttentionItems(publicationSummaries),
    ...collectApprovalAttentionItems(approvals)
  ].sort((left, right) => getAttentionPriority(right) - getAttentionPriority(left));
}

export function buildPlatformObservabilityReadModel(
  snapshot: PlatformRunStateSnapshot,
  options: { now?: string } = {}
): PlatformObservabilityReadModel {
  const now = options.now ?? new Date().toISOString();
  const timeline = buildTimeline(snapshot);
  const taskSummaries = buildTaskSummaries(snapshot, timeline);
  const repairSummaries = buildRepairSummaries(timeline, snapshot.repairAttempts);
  const publicationSummaries = buildPublicationSummaries(timeline, snapshot.publications);
  const approvals = buildApprovals(timeline, snapshot.publications);

  return {
    taxonomyVersion: PLATFORM_EVENT_TAXONOMY_VERSION,
    eventCatalog: listPlatformEventTaxonomyDescriptors(),
    run: snapshot.run,
    metrics: buildMetrics(snapshot, now),
    timeline,
    taskSummaries,
    repairSummaries,
    publicationSummaries,
    approvals,
    recentEvents: snapshot.recentEvents,
    repairs: snapshot.repairAttempts,
    publications: snapshot.publications,
    attentionRequired: buildAttentionRequired(snapshot.tasks, taskSummaries, repairSummaries, publicationSummaries, approvals)
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

  return buildPlatformObservabilityReadModel(snapshot, options.now ? { now: options.now } : {});
}
