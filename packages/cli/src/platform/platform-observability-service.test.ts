import { describe, expect, it } from 'vitest';

import { buildPlatformObservabilityReadModel } from './platform-observability-service.js';
import { PLATFORM_EVENT_TYPES } from './platform-event-taxonomy.js';
import type { PlatformRunStateSnapshot } from '../types/index.js';

function createSnapshot(): PlatformRunStateSnapshot {
  return {
    run: {
      runId: 'run-1',
      repositoryId: 'spec2flow',
      workflowName: 'fixture-flow',
      status: 'running',
      currentStage: 'collaboration',
      riskLevel: 'high',
      requestPayload: {},
      metadata: {},
      createdAt: '2026-03-24T10:00:00.000Z',
      updatedAt: '2026-03-24T10:06:00.000Z',
      startedAt: '2026-03-24T10:00:10.000Z'
    },
    tasks: [
      {
        runId: 'run-1',
        taskId: 'frontend-smoke--code-implementation',
        stage: 'code-implementation',
        title: 'Implement',
        goal: 'Implement',
        executorType: 'implementation-agent',
        status: 'completed',
        dependsOn: [],
        targetFiles: [],
        verifyCommands: [],
        inputs: {},
        roleProfile: {
          profileId: 'implementation',
          specialistRole: 'implementation-agent',
          commandPolicy: 'safe-repo-commands',
          canReadRepository: true,
          canEditFiles: true,
          canRunCommands: true,
          canWriteArtifacts: true,
          canOpenCollaboration: false,
          requiredAdapterSupports: [],
          expectedArtifacts: ['implementation-summary']
        },
        attempts: 1,
        retryCount: 1,
        autoRepairCount: 1
      },
      {
        runId: 'run-1',
        taskId: 'frontend-smoke--collaboration',
        stage: 'collaboration',
        title: 'Publish',
        goal: 'Publish',
        executorType: 'collaboration-agent',
        status: 'blocked',
        dependsOn: [],
        targetFiles: [],
        verifyCommands: [],
        inputs: {},
        roleProfile: {
          profileId: 'collaboration',
          specialistRole: 'collaboration-agent',
          commandPolicy: 'collaboration-only',
          canReadRepository: true,
          canEditFiles: false,
          canRunCommands: false,
          canWriteArtifacts: true,
          canOpenCollaboration: true,
          requiredAdapterSupports: [],
          expectedArtifacts: ['collaboration-handoff', 'publication-record']
        },
        attempts: 1,
        retryCount: 0,
        autoRepairCount: 0
      }
    ],
    recentEvents: [
      {
        eventId: 'event-1',
        runId: 'run-1',
        taskId: null,
        eventType: PLATFORM_EVENT_TYPES.RUN_CREATED,
        payload: {},
        createdAt: '2026-03-24T10:00:00.000Z'
      },
      {
        eventId: 'event-2',
        runId: 'run-1',
        taskId: 'frontend-smoke--code-implementation',
        eventType: PLATFORM_EVENT_TYPES.REPAIR_TRIGGERED,
        payload: {
          repairAttemptId: 'repair-1',
          attemptNumber: 1,
          failureClass: 'implementation-defect'
        },
        createdAt: '2026-03-24T10:03:00.000Z'
      },
      {
        eventId: 'event-3',
        runId: 'run-1',
        taskId: 'frontend-smoke--collaboration',
        eventType: PLATFORM_EVENT_TYPES.PUBLICATION_PREPARED,
        payload: {
          publicationId: 'publication-1',
          status: 'approval-required'
        },
        createdAt: '2026-03-24T10:05:00.000Z'
      },
      {
        eventId: 'event-4',
        runId: 'run-1',
        taskId: 'frontend-smoke--collaboration',
        eventType: PLATFORM_EVENT_TYPES.APPROVAL_REQUESTED,
        payload: {
          publicationId: 'publication-1',
          gateReason: 'human-approval-required'
        },
        createdAt: '2026-03-24T10:05:10.000Z'
      }
    ],
    artifacts: [
      {
        artifactId: 'artifact-1',
        runId: 'run-1',
        taskId: 'frontend-smoke--code-implementation',
        kind: 'report',
        path: 'spec2flow/outputs/implementation-summary.json'
      },
      {
        artifactId: 'artifact-2',
        runId: 'run-1',
        taskId: 'frontend-smoke--collaboration',
        kind: 'report',
        path: 'spec2flow/outputs/publication-record.json'
      }
    ],
    repairAttempts: [
      {
        repairAttemptId: 'repair-1',
        runId: 'run-1',
        sourceTaskId: 'frontend-smoke--code-implementation',
        triggerTaskId: 'frontend-smoke--defect-feedback',
        sourceStage: 'code-implementation',
        failureClass: 'implementation-defect',
        attemptNumber: 1,
        status: 'blocked'
      }
    ],
    publications: [
      {
        publicationId: 'publication-1',
        runId: 'run-1',
        publishMode: 'manual-handoff',
        status: 'approval-required',
        metadata: {
          taskId: 'frontend-smoke--collaboration',
          approvalRequired: true,
          gateReason: 'human-approval-required'
        }
      }
    ]
  };
}

describe('platform-observability-service', () => {
  it('builds a normalized observability read model from the platform snapshot', () => {
    const result = buildPlatformObservabilityReadModel(createSnapshot(), {
      now: '2026-03-24T10:06:10.000Z'
    });

    expect(result.taxonomyVersion).toBe('phase-6-v1');
    expect(result.eventCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: PLATFORM_EVENT_TYPES.PUBLICATION_APPROVAL_REQUIRED }),
      expect.objectContaining({ type: PLATFORM_EVENT_TYPES.APPROVAL_REQUESTED })
    ]));
    expect(result.metrics.tasks.total).toBe(2);
    expect(result.metrics.repairs.blocked).toBe(1);
    expect(result.metrics.publications.approvalRequired).toBe(1);
    expect(result.metrics.artifacts.tasksWithMissingExpectedArtifacts).toBe(1);
    expect(result.metrics.events.byCategory.publication).toBe(1);
    expect(result.metrics.events.byCategory.approval).toBe(1);
    expect(result.metrics.events.byType).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: PLATFORM_EVENT_TYPES.APPROVAL_REQUESTED, count: 1 }),
      expect.objectContaining({ type: PLATFORM_EVENT_TYPES.PUBLICATION_PREPARED, count: 1 })
    ]));
    expect(result.timeline.map((entry) => entry.type)).toEqual([
      PLATFORM_EVENT_TYPES.RUN_CREATED,
      PLATFORM_EVENT_TYPES.REPAIR_TRIGGERED,
      PLATFORM_EVENT_TYPES.PUBLICATION_PREPARED,
      PLATFORM_EVENT_TYPES.APPROVAL_REQUESTED
    ]);
    expect(result.taskSummaries.find((task) => task.taskId === 'frontend-smoke--collaboration')).toMatchObject({
      status: 'blocked',
      latestEventType: PLATFORM_EVENT_TYPES.APPROVAL_REQUESTED,
      recentEvents: expect.arrayContaining([
        expect.objectContaining({ type: PLATFORM_EVENT_TYPES.APPROVAL_REQUESTED }),
        expect.objectContaining({ type: PLATFORM_EVENT_TYPES.PUBLICATION_PREPARED })
      ]),
      missingExpectedArtifactCount: 1
    });
    expect(result.repairSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        repairAttemptId: 'repair-1',
        status: 'blocked',
        latestEventType: PLATFORM_EVENT_TYPES.REPAIR_TRIGGERED
      })
    ]));
    expect(result.publicationSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        publicationId: 'publication-1',
        taskId: 'frontend-smoke--collaboration',
        status: 'approval-required',
        approvalRequired: true
      })
    ]));
    expect(result.approvals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        publicationId: 'publication-1',
        taskId: 'frontend-smoke--collaboration',
        status: 'requested'
      })
    ]));
    expect(result.attentionRequired).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'task',
        taskId: 'frontend-smoke--collaboration'
      }),
      expect.objectContaining({
        kind: 'publication',
        message: 'Approval is requested for publication publication-1'
      })
    ]));
  });
});
