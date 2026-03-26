import { describe, expect, it, vi } from 'vitest';

import { runServePlatformControlPlane, type ServePlatformControlPlaneDependencies } from './serve-platform-control-plane-command.js';
import type { PlatformControlPlaneRunSubmissionResult } from '../types/index.js';

describe('serve-platform-control-plane-command', () => {
  it('starts the control-plane server with DB-backed handlers', async () => {
    const runSubmissionResult: PlatformControlPlaneRunSubmissionResult = {
      platformRun: {
        schema: 'spec2flow_platform',
        projectId: 'spec2flow-local',
        projectName: 'Spec2Flow',
        repositoryId: 'spec2flow',
        repositoryName: 'Spec2Flow',
        repositoryRootPath: '/workspace/Spec2Flow',
        workspaceRootPath: '/workspace/Spec2Flow',
        runId: 'run-1',
        workflowName: 'platform-flow',
        taskCount: 0,
        eventCount: 0,
        artifactCount: 0,
        status: 'pending',
        currentStage: 'requirements-analysis',
        riskLevel: 'medium',
        branchName: 'spec2flow/run-1',
        baseBranch: 'main',
        worktreeMode: 'managed',
        worktreePath: '/workspace/Spec2Flow/.spec2flow/worktrees/run-1',
        provisioningStatus: 'provisioned'
      },
      taskGraph: {
        graphId: 'graph-1',
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
    };
    const createPlatformPool = vi.fn(() => ({
      connect: vi.fn(async () => ({
        query: async () => ({
          rows: [],
          rowCount: 0
        }),
        release: () => undefined
      })),
      end: vi.fn(async () => undefined)
    })) as unknown as ServePlatformControlPlaneDependencies['createPlatformPool'];
    const startPlatformControlPlaneServer = vi.fn(async () => ({
      host: '127.0.0.1',
      port: 4310,
      close: async () => undefined
    })) as unknown as ServePlatformControlPlaneDependencies['startPlatformControlPlaneServer'];

    await runServePlatformControlPlane({
      'database-url': 'postgresql://local/spec2flow',
      host: '127.0.0.1',
      port: '4310'
    }, {
      approvePlatformControlPlaneTask: vi.fn(async () => null),
      createPlatformPool,
      fail: vi.fn(),
      getPlatformControlPlaneLocalArtifactContent: vi.fn(async () => null),
      getPlatformControlPlaneRunDetail: vi.fn(async () => null),
      getPlatformControlPlaneRunObservability: vi.fn(async () => null),
      getPlatformControlPlaneTaskArtifactCatalog: vi.fn(async () => null),
      getPlatformControlPlaneRunTasks: vi.fn(async () => null),
      listPlatformProjects: vi.fn(async () => []),
      listPlatformRuns: vi.fn(async () => []),
      pausePlatformControlPlaneRun: vi.fn(async () => null),
      rejectPlatformControlPlaneTask: vi.fn(async () => null),
      registerPlatformProject: vi.fn(async () => ({
        schema: 'spec2flow_platform',
        repository: {
          repositoryId: 'spec2flow',
          repositoryName: 'Spec2Flow',
          repositoryRootPath: '/workspace/Spec2Flow',
          defaultBranch: 'main'
        },
        project: {
          projectId: 'spec2flow-local',
          repositoryId: 'spec2flow',
          name: 'Spec2Flow',
          repositoryRootPath: '/workspace/Spec2Flow',
          workspaceRootPath: '/workspace/Spec2Flow',
          workspacePolicy: {
            allowedReadGlobs: ['**/*'],
            allowedWriteGlobs: ['**/*'],
            forbiddenWriteGlobs: []
          }
        }
      })),
      updatePlatformProjectAdapterProfile: vi.fn(async () => null),
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      resumePlatformControlPlaneRun: vi.fn(async () => null),
      retryPlatformControlPlaneTask: vi.fn(async () => null),
      submitPlatformControlPlaneRun: vi.fn(async () => runSubmissionResult),
      startPlatformControlPlaneServer,
      withPlatformTransaction: vi.fn(async (_pool, callback: (client: { query: () => Promise<{ rows: never[]; rowCount: number; }> }) => Promise<unknown>) =>
        callback({
          query: async () => ({
            rows: [],
            rowCount: 0
          })
        })) as unknown as ServePlatformControlPlaneDependencies['withPlatformTransaction']
    });

    expect(createPlatformPool).toHaveBeenCalled();
    expect(startPlatformControlPlaneServer).toHaveBeenCalledWith(expect.objectContaining({
      host: '127.0.0.1',
      port: 4310,
      eventLimit: 20
    }));
  });
});
