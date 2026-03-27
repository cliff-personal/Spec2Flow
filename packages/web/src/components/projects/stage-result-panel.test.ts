import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildRequirementsAnalysisReportEntries,
  buildClosureTimeline,
  deriveCommandSignalCards,
  StageResultPanel,
} from './stage-result-panel';
import type {
  ArtifactContent,
  PlatformArtifactRecord,
  PlatformObservabilityApprovalItem,
  PlatformObservabilityTimelineEntry,
  PlatformPublicationObservabilitySummary,
  PlatformRepairObservabilitySummary,
  PlatformTaskObservabilitySummary,
  PlatformTaskRecord,
} from '../../lib/control-plane-api';

function makeTask(overrides: Partial<PlatformTaskRecord> = {}): PlatformTaskRecord {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    stage: 'defect-feedback',
    title: 'Repair regression',
    goal: 'Close the defect loop',
    executorType: 'agent',
    status: 'completed',
    ...overrides,
  };
}

function makeTaskSummary(overrides: Partial<PlatformTaskObservabilitySummary> = {}): PlatformTaskObservabilitySummary {
  return {
    taskId: 'task-1',
    stage: 'defect-feedback',
    status: 'completed',
    attempts: 1,
    retryCount: 0,
    autoRepairCount: 0,
    artifactCount: 1,
    expectedArtifactCount: 1,
    missingExpectedArtifactCount: 0,
    recentEvents: [],
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<PlatformArtifactRecord> = {}): PlatformArtifactRecord {
  return {
    artifactId: 'artifact-1',
    runId: 'run-1',
    taskId: 'task-1',
    kind: 'report',
    path: 'spec2flow/outputs/execution/frontend-smoke/requirements-summary.json',
    metadata: {
      originalArtifactId: 'requirements-summary',
    },
    ...overrides,
  };
}

function makeEvent(overrides: Partial<PlatformObservabilityTimelineEntry> = {}): PlatformObservabilityTimelineEntry {
  return {
    eventId: 'event-1',
    createdAt: '2026-03-26T10:00:00.000Z',
    taskId: 'task-1',
    type: 'repair.triggered',
    category: 'repair',
    action: 'triggered',
    title: 'Repair loop triggered',
    severity: 'warning',
    payload: {},
    ...overrides,
  };
}

function makeRepairSummary(
  overrides: Partial<PlatformRepairObservabilitySummary> = {}
): PlatformRepairObservabilitySummary {
  return {
    repairAttemptId: 'repair-1',
    taskId: 'task-1',
    triggerTaskId: 'task-origin',
    sourceStage: 'automated-execution',
    failureClass: 'assertion-failure',
    attemptNumber: 1,
    status: 'succeeded',
    latestEventAt: '2026-03-26T10:02:00.000Z',
    recentEvents: [
      makeEvent({
        eventId: 'repair-event-1',
        createdAt: '2026-03-26T10:02:00.000Z',
        type: 'repair.succeeded',
        severity: 'info',
        title: 'Repair succeeded',
      }),
    ],
    ...overrides,
  };
}

function makePublicationSummary(
  overrides: Partial<PlatformPublicationObservabilitySummary> = {}
): PlatformPublicationObservabilitySummary {
  return {
    publicationId: 'publication-1',
    taskId: 'task-1',
    status: 'published',
    publishMode: 'pull-request',
    approvalRequired: false,
    latestEventAt: '2026-03-26T10:03:00.000Z',
    recentEvents: [
      makeEvent({
        eventId: 'publication-event-1',
        createdAt: '2026-03-26T10:03:00.000Z',
        type: 'publication.published',
        category: 'publication',
        action: 'published',
        title: 'Publication completed',
        severity: 'info',
      }),
    ],
    ...overrides,
  };
}

function makeApproval(overrides: Partial<PlatformObservabilityApprovalItem> = {}): PlatformObservabilityApprovalItem {
  return {
    publicationId: 'publication-1',
    taskId: 'task-1',
    createdAt: '2026-03-26T10:04:00.000Z',
    status: 'requested',
    reason: 'Need release approval',
    ...overrides,
  };
}

describe('deriveCommandSignalCards', () => {
  it('reports clean autonomy when no repair or approval signals exist', () => {
    const cards = deriveCommandSignalCards(
      [makeTask()],
      [makeTaskSummary()],
      [],
      [],
      [],
      []
    );

    expect(cards[0]).toMatchObject({ value: 'clean', tone: 'success' });
    expect(cards[1]).toMatchObject({ value: 'none', tone: 'success' });
    expect(cards[2]).toMatchObject({ value: 'promote next stage', tone: 'success' });
  });

  it('surfaces approval gates as the blocker and next action', () => {
    const cards = deriveCommandSignalCards(
      [makeTask({ status: 'blocked' })],
      [makeTaskSummary({ status: 'blocked' })],
      [makeRepairSummary()],
      [makePublicationSummary({ status: 'approval-required', gateReason: 'Release gate is waiting' })],
      [makeApproval()],
      [makeEvent({ eventId: 'approval-event', category: 'approval', type: 'approval.requested', title: 'Approval requested' })]
    );

    expect(cards[1]).toMatchObject({ value: 'approval gate', tone: 'warning' });
    expect(cards[1].detail).toContain('Need release approval');
    expect(cards[2]).toMatchObject({ value: 'await approval', tone: 'warning' });
  });

  it('keeps repair loop as the next automatic action when repairs are still open', () => {
    const cards = deriveCommandSignalCards(
      [makeTask({ status: 'in-progress' })],
      [makeTaskSummary({ status: 'in-progress' })],
      [makeRepairSummary({ status: 'blocked', recommendedAction: 'Inspect flaky test harness' })],
      [],
      [],
      [makeEvent({ eventId: 'repair-blocked', type: 'repair.blocked', title: 'Repair blocked', severity: 'error' })]
    );

    expect(cards[0]).toMatchObject({ value: '0%', tone: 'warning' });
    expect(cards[1]).toMatchObject({ value: 'blocked', tone: 'error' });
    expect(cards[1].detail).toContain('Inspect flaky test harness');
    expect(cards[2]).toMatchObject({ value: 'continue repair loop', tone: 'info' });
  });
});

describe('buildClosureTimeline', () => {
  it('merges stage, repair, approval, and publication signals in chronological order', () => {
    const timeline = buildClosureTimeline(
      [
        makeEvent({
          eventId: 'stage-event',
          createdAt: '2026-03-26T10:00:00.000Z',
          type: 'defect.detected',
          category: 'defect',
          action: 'detected',
          title: 'Defect detected',
          severity: 'error',
        }),
      ],
      [makeRepairSummary()],
      [makePublicationSummary()],
      [makeApproval()]
    );

    expect(timeline.map((item) => item.id)).toEqual([
      'stage-event',
      'repair-event-1',
      'publication-event-1',
      'approval-publication-1',
    ]);
    expect(timeline.map((item) => item.lane)).toEqual(['stage', 'repair', 'publication', 'approval']);
  });

  it('deduplicates repeated events from stage and repair sources', () => {
    const duplicateRepairEvent = makeEvent({
      eventId: 'repair-dup',
      createdAt: '2026-03-26T10:02:00.000Z',
      type: 'repair.succeeded',
      title: 'Repair succeeded',
      category: 'repair',
      severity: 'info',
    });

    const timeline = buildClosureTimeline(
      [duplicateRepairEvent],
      [makeRepairSummary({ recentEvents: [duplicateRepairEvent] })],
      [],
      []
    );

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ id: 'repair-dup', lane: 'repair' });
  });
});

describe('buildRequirementsAnalysisReportEntries', () => {
  it('prefers requirements-summary content before model-output deliverable content', () => {
    const artifacts = [
      makeArtifact({ artifactId: 'artifact-requirements' }),
      makeArtifact({
        artifactId: 'artifact-model-output',
        path: 'spec2flow/outputs/execution/frontend-smoke/requirements-analysis-model-output.json',
        metadata: {},
      }),
    ];
    const artifactContents: Record<string, ArtifactContent> = {
      'artifact-requirements': {
        content: JSON.stringify({
          summary: 'Requirements summary body',
          acceptanceCriteria: ['First requirement'],
        }),
        contentType: 'application/json',
      },
      'artifact-model-output': {
        content: JSON.stringify({
          deliverable: {
            summary: 'Model output summary body',
            acceptanceCriteria: ['Second requirement'],
          },
        }),
        contentType: 'application/json',
      },
    };

    const reports = buildRequirementsAnalysisReportEntries(artifacts, artifactContents);

    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      artifactId: 'artifact-requirements',
      label: 'requirements-summary',
    });
    expect(reports[0].excerpt).toContain('Requirements summary body');
    expect(reports[1].artifactId).toBe('artifact-model-output');
    expect(reports[1].excerpt).toContain('Model output summary body');
  });

  it('does not fall back to task status style summaries when artifacts are not parseable', () => {
    const reports = buildRequirementsAnalysisReportEntries(
      [makeArtifact({ artifactId: 'artifact-requirements' })],
      {
        'artifact-requirements': {
          content: '{"unexpected":true}',
          contentType: 'application/json',
        },
      }
    );

    expect(reports).toEqual([]);
  });
});

describe('StageResultPanel', () => {
  it('separates planning output from real agent results for requirements analysis', () => {
    const html = renderToStaticMarkup(
      createElement(StageResultPanel, {
        stageKey: 'requirements-analysis',
        stageLabel: '需求分析',
        tasks: [
          makeTask({
            taskId: 'cli-runtime--requirements-analysis',
            stage: 'requirements-analysis',
            title: 'Analyze cli-runtime requirements',
            goal: 'Summarize scope and acceptance criteria for cli-runtime',
          }),
        ],
        taskSummaries: [
          makeTaskSummary({
            taskId: 'cli-runtime--requirements-analysis',
            stage: 'requirements-analysis',
            artifactCount: 2,
            expectedArtifactCount: 2,
          }),
        ],
        artifacts: [makeArtifact()],
        repairSummaries: [],
        publicationSummaries: [],
        approvals: [],
        stageEvents: [],
        eventCount: 0,
      })
    );

    expect(html).toContain('任务拆分');
    expect(html).toContain('规划器生成的 route 子任务');
    expect(html).toContain('Agent 结果');
    expect(html).toContain('真实执行摘要和产物内容');
    expect(html).toContain('执行摘要');
    expect(html).toContain('requirements-summary');
  });
});