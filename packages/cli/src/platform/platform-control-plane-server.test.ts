import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { startPlatformControlPlaneServer, type StartedPlatformControlPlaneServer } from './platform-control-plane-server.js';

let startedServer: StartedPlatformControlPlaneServer | null = null;

afterEach(async () => {
  if (startedServer) {
    await startedServer.close();
    startedServer = null;
  }
});

describe('platform-control-plane-server', () => {
  it('serves health, run list, run detail, task list, and observability endpoints', async () => {
    startedServer = await startPlatformControlPlaneServer({
      host: '127.0.0.1',
      port: 0,
      eventLimit: 20,
      listPlatformRuns: async () => [{
        runId: 'run-1',
        repositoryId: 'spec2flow',
        repositoryName: 'Spec2Flow',
        repositoryRootPath: '/workspace/Spec2Flow',
        workflowName: 'platform-flow',
        status: 'running',
        currentStage: 'collaboration',
        riskLevel: 'high',
        createdAt: '2026-03-24T12:00:00.000Z',
        updatedAt: '2026-03-24T12:05:00.000Z',
        startedAt: '2026-03-24T12:00:10.000Z',
        completedAt: null
      }],
      getPlatformControlPlaneRunDetail: async () => ({
        runState: {
          run: {
            runId: 'run-1',
            repositoryId: 'spec2flow',
            workflowName: 'platform-flow',
            status: 'running',
            currentStage: 'collaboration',
            riskLevel: 'high'
          },
          tasks: [],
          recentEvents: [],
          artifacts: [],
          repairAttempts: [],
          publications: []
        },
        platformObservability: {
          taxonomyVersion: 'phase-6-v1',
          eventCatalog: [],
          run: null,
          metrics: {
            runDurationSeconds: null,
            latestEventAt: null,
            tasks: {
              total: 0,
              pending: 0,
              ready: 0,
              leased: 0,
              inProgress: 0,
              blocked: 0,
              completed: 0,
              failed: 0,
              skipped: 0,
              retryableFailed: 0,
              cancelled: 0
            },
            repairs: {
              total: 0,
              requested: 0,
              succeeded: 0,
              failed: 0,
              blocked: 0,
              failureClassFrequency: {}
            },
            publications: {
              total: 0,
              published: 0,
              approvalRequired: 0,
              blocked: 0
            },
            artifacts: {
              total: 0,
              expected: 0,
              tasksWithMissingExpectedArtifacts: 0
            },
            retries: {
              executionRetryCount: 0,
              autoRepairCount: 0
            },
            events: {
              recentCount: 0,
              byCategory: {
                run: 0,
                planning: 0,
                task: 0,
                artifact: 0,
                repair: 0,
                publication: 0,
                approval: 0,
                unknown: 0
              },
              byType: []
            }
          },
          timeline: [],
          taskSummaries: [],
          repairSummaries: [],
          publicationSummaries: [],
          approvals: [],
          recentEvents: [],
          repairs: [],
          publications: [],
          attentionRequired: []
        }
      }),
      getPlatformControlPlaneRunTasks: async () => [{
        runId: 'run-1',
        taskId: 'task-1',
        stage: 'collaboration',
        title: 'Publish handoff',
        goal: 'Publish handoff',
        executorType: 'collaboration-agent',
        status: 'blocked',
        dependsOn: [],
        targetFiles: [],
        verifyCommands: [],
        inputs: {},
        roleProfile: {
          profileId: 'collaboration',
          specialistRole: 'collaboration-agent',
          commandPolicy: 'none',
          canReadRepository: true,
          canEditFiles: false,
          canRunCommands: false,
          canWriteArtifacts: true,
          canOpenCollaboration: true,
          requiredAdapterSupports: [],
          expectedArtifacts: []
        }
      }],
      getPlatformControlPlaneRunObservability: async () => ({
        taxonomyVersion: 'phase-6-v1',
        eventCatalog: [],
        run: null,
        metrics: {
          runDurationSeconds: null,
          latestEventAt: null,
          tasks: {
            total: 0,
            pending: 0,
            ready: 0,
            leased: 0,
            inProgress: 0,
            blocked: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
            retryableFailed: 0,
            cancelled: 0
          },
          repairs: {
            total: 0,
            requested: 0,
            succeeded: 0,
            failed: 0,
            blocked: 0,
            failureClassFrequency: {}
          },
          publications: {
            total: 0,
            published: 0,
            approvalRequired: 0,
            blocked: 0
          },
          artifacts: {
            total: 0,
            expected: 0,
            tasksWithMissingExpectedArtifacts: 0
          },
          retries: {
            executionRetryCount: 0,
            autoRepairCount: 0
          },
          events: {
            recentCount: 0,
            byCategory: {
              run: 0,
              planning: 0,
              task: 0,
              artifact: 0,
              repair: 0,
              publication: 0,
              approval: 0,
              unknown: 0
            },
            byType: []
          }
        },
        timeline: [],
        taskSummaries: [],
        repairSummaries: [],
        publicationSummaries: [],
        approvals: [],
        recentEvents: [],
        repairs: [],
        publications: [],
        attentionRequired: []
      }),
      getPlatformControlPlaneTaskArtifactCatalog: async () => ({
        runId: 'run-1',
        taskId: 'task-1',
        artifactId: 'artifact-1',
        path: 'spec2flow/outputs/execution/task-1/execution-artifact-catalog.json',
        catalog: {
          generatedAt: '2026-03-25T01:00:00.000Z',
          taskId: 'task-1',
          stage: 'automated-execution',
          summary: 'catalog',
          store: {
            mode: 'remote-catalog',
            provider: 'generic-http',
            uploadConfigured: true,
            uploadMethod: 'PUT'
          },
          artifacts: []
        }
      }),
      getPlatformControlPlaneLocalArtifactContent: async () => ({
        objectKey: 'frontend-smoke/spec2flow/outputs/execution/frontend-smoke/execution-report.json',
        artifactId: 'execution-report',
        runId: 'run-1',
        taskId: 'task-1',
        localPath: fileURLToPath(new URL('./fixtures/platform-control-plane-local-artifact.json', import.meta.url)),
        contentType: 'application/json; charset=utf-8'
      }),
      submitPlatformRun: async () => ({
        platformRun: {
          schema: 'spec2flow_platform',
          repositoryId: 'spec2flow',
          repositoryName: 'Spec2Flow',
          repositoryRootPath: '/workspace/Spec2Flow',
          runId: 'run-2',
          workflowName: 'platform-flow',
          taskCount: 2,
          eventCount: 3,
          artifactCount: 0,
          status: 'pending',
          currentStage: 'requirements-analysis',
          riskLevel: 'medium'
        },
        taskGraph: {
          graphId: 'graph-2',
          routeSelectionMode: 'requirement',
          selectedRoutes: ['platform-runtime'],
          changedFiles: ['packages/cli/src/platform/platform-repository.ts'],
          requirementPath: null
        },
        validatorResult: {
          status: 'passed',
          summary: {
            passed: 3,
            warnings: 0,
            failed: 0
          }
        }
      }),
      retryPlatformTask: async () => ({
        action: 'retry',
        runId: 'run-1',
        taskId: 'task-1',
        taskStatus: 'ready',
        runStatus: 'running',
        currentStage: 'collaboration',
        publicationId: null,
        publicationStatus: null
      }),
      approvePlatformTask: async () => ({
        action: 'approve',
        runId: 'run-1',
        taskId: 'task-1',
        taskStatus: 'completed',
        runStatus: 'completed',
        currentStage: null,
        publicationId: 'publication-1',
        publicationStatus: 'published'
      }),
      rejectPlatformTask: async () => ({
        action: 'reject',
        runId: 'run-1',
        taskId: 'task-1',
        taskStatus: 'blocked',
        runStatus: 'blocked',
        currentStage: 'collaboration',
        publicationId: 'publication-1',
        publicationStatus: 'blocked'
      }),
      pausePlatformRun: async () => ({
        action: 'pause',
        runId: 'run-1',
        runStatus: 'running',
        currentStage: 'collaboration',
        paused: true
      }),
      resumePlatformRun: async () => ({
        action: 'resume',
        runId: 'run-1',
        runStatus: 'running',
        currentStage: 'collaboration',
        paused: false
      })
    });

    const baseUrl = `http://${startedServer.host}:${startedServer.port}`;
    const healthResponse = await fetch(`${baseUrl}/healthz`);
    expect(healthResponse.status).toBe(200);

    const runListResponse = await fetch(`${baseUrl}/api/runs`);
    expect(runListResponse.status).toBe(200);
    expect(await runListResponse.json()).toEqual(expect.objectContaining({
      runs: expect.arrayContaining([expect.objectContaining({ runId: 'run-1' })])
    }));

    const runSubmissionResponse = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        repositoryRootPath: '/workspace/Spec2Flow',
        requirement: 'Add platform control plane backend',
        changedFiles: ['packages/cli/src/platform/platform-control-plane-server.ts']
      })
    });
    expect(runSubmissionResponse.status).toBe(201);
    expect(await runSubmissionResponse.json()).toEqual(expect.objectContaining({
      runSubmission: expect.objectContaining({
        platformRun: expect.objectContaining({ runId: 'run-2' })
      })
    }));

    const runDetailResponse = await fetch(`${baseUrl}/api/runs/run-1`);
    expect(runDetailResponse.status).toBe(200);
    expect(await runDetailResponse.json()).toEqual(expect.objectContaining({
      run: expect.objectContaining({
        runState: expect.objectContaining({
          run: expect.objectContaining({ runId: 'run-1' })
        })
      })
    }));

    const runTasksResponse = await fetch(`${baseUrl}/api/runs/run-1/tasks`);
    expect(runTasksResponse.status).toBe(200);
    expect(await runTasksResponse.json()).toEqual(expect.objectContaining({
      tasks: expect.arrayContaining([expect.objectContaining({ taskId: 'task-1' })])
    }));

    const artifactCatalogResponse = await fetch(`${baseUrl}/api/runs/run-1/tasks/task-1/artifact-catalog`);
    expect(artifactCatalogResponse.status).toBe(200);
    expect(await artifactCatalogResponse.json()).toEqual(expect.objectContaining({
      artifactCatalog: expect.objectContaining({
        taskId: 'task-1',
        catalog: expect.objectContaining({
          stage: 'automated-execution'
        })
      })
    }));

    const artifactResponse = await fetch(`${baseUrl}/artifacts/frontend-smoke/spec2flow/outputs/execution/frontend-smoke/execution-report.json`);
    expect(artifactResponse.status).toBe(200);
    expect(artifactResponse.headers.get('content-type')).toContain('application/json');
    expect(await artifactResponse.json()).toEqual(expect.objectContaining({
      status: 'ok'
    }));

    const observabilityResponse = await fetch(`${baseUrl}/api/runs/run-1/observability`);
    expect(observabilityResponse.status).toBe(200);
    expect(await observabilityResponse.json()).toEqual(expect.objectContaining({
      platformObservability: expect.objectContaining({ taxonomyVersion: 'phase-6-v1' })
    }));

    const retryResponse = await fetch(`${baseUrl}/api/tasks/task-1/actions/retry`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ runId: 'run-1', actor: 'operator-1' })
    });
    expect(retryResponse.status).toBe(200);
    expect(await retryResponse.json()).toEqual(expect.objectContaining({
      action: expect.objectContaining({ action: 'retry', taskStatus: 'ready' })
    }));

    const pauseResponse = await fetch(`${baseUrl}/api/runs/run-1/actions/pause`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ actor: 'operator-1', note: 'pause for review' })
    });
    expect(pauseResponse.status).toBe(200);
    expect(await pauseResponse.json()).toEqual(expect.objectContaining({
      action: expect.objectContaining({ action: 'pause', paused: true })
    }));

    const resumeResponse = await fetch(`${baseUrl}/api/runs/run-1/actions/resume`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ actor: 'operator-1', note: 'resume execution' })
    });
    expect(resumeResponse.status).toBe(200);
    expect(await resumeResponse.json()).toEqual(expect.objectContaining({
      action: expect.objectContaining({ action: 'resume', paused: false })
    }));
  });

  it('returns a request validation error when task actions omit runId', async () => {
    startedServer = await startPlatformControlPlaneServer({
      host: '127.0.0.1',
      port: 0,
      eventLimit: 20,
      listPlatformRuns: async () => [],
      getPlatformControlPlaneRunDetail: async () => null,
      getPlatformControlPlaneRunTasks: async () => null,
      getPlatformControlPlaneRunObservability: async () => null,
      getPlatformControlPlaneTaskArtifactCatalog: async () => null,
      getPlatformControlPlaneLocalArtifactContent: async () => null,
      submitPlatformRun: async () => ({
        platformRun: {
          schema: 'spec2flow_platform',
          repositoryId: 'spec2flow',
          repositoryName: 'Spec2Flow',
          repositoryRootPath: '/workspace/Spec2Flow',
          runId: 'run-2',
          workflowName: 'platform-flow',
          taskCount: 1,
          eventCount: 3,
          artifactCount: 0,
          status: 'pending',
          currentStage: 'requirements-analysis',
          riskLevel: 'medium'
        },
        taskGraph: {
          graphId: 'graph-2',
          routeSelectionMode: 'all',
          selectedRoutes: [],
          changedFiles: [],
          requirementPath: null
        },
        validatorResult: {
          status: 'passed',
          summary: {
            passed: 3,
            warnings: 0,
            failed: 0
          }
        }
      }),
      retryPlatformTask: async () => null,
      approvePlatformTask: async () => null,
      rejectPlatformTask: async () => null,
      pausePlatformRun: async () => null,
      resumePlatformRun: async () => null
    });

    const baseUrl = `http://${startedServer.host}:${startedServer.port}`;
    const response = await fetch(`${baseUrl}/api/tasks/frontend-smoke--collaboration/actions/retry`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ actor: 'operator-1' })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'invalid-request'
      })
    }));
  });

  it('returns a request validation error when run submission omits repositoryRootPath', async () => {
    startedServer = await startPlatformControlPlaneServer({
      host: '127.0.0.1',
      port: 0,
      eventLimit: 20,
      listPlatformRuns: async () => [],
      getPlatformControlPlaneRunDetail: async () => null,
      getPlatformControlPlaneRunTasks: async () => null,
      getPlatformControlPlaneRunObservability: async () => null,
      getPlatformControlPlaneTaskArtifactCatalog: async () => null,
      getPlatformControlPlaneLocalArtifactContent: async () => null,
      submitPlatformRun: async () => {
        throw new Error('unreachable');
      },
      retryPlatformTask: async () => null,
      approvePlatformTask: async () => null,
      rejectPlatformTask: async () => null,
      pausePlatformRun: async () => null,
      resumePlatformRun: async () => null
    });

    const baseUrl = `http://${startedServer.host}:${startedServer.port}`;
    const response = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        requirement: 'Add platform control plane backend'
      })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: 'invalid-request'
      })
    }));
  });
});
