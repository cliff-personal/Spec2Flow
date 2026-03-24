import { describe, expect, it, vi } from 'vitest';

import { runPlatformWorkerTask, type RunPlatformWorkerTaskDependencies } from './run-platform-worker-task-command.js';
import type { PlatformWorkerMaterialization, PlatformWorkerExecutionResult, PersistPlatformWorkerResult } from '../platform/platform-worker-service.js';
import type { StartPlatformTaskResult } from '../platform/platform-scheduler-service.js';

describe('run-platform-worker-task-command', () => {
  it('starts, materializes, executes, and persists one platform worker task', async () => {
    const printJson = vi.fn();
    const createPlatformPool = vi.fn(() => ({
      end: vi.fn(async () => undefined)
    })) as unknown as RunPlatformWorkerTaskDependencies['createPlatformPool'];
    const withPlatformTransaction = vi.fn(async (_pool, callback: (client: { query: () => Promise<{ rows: never[]; rowCount: number; }> }) => Promise<unknown>) =>
      callback({
        query: async () => ({
          rows: [],
          rowCount: 0
        })
      })) as unknown as RunPlatformWorkerTaskDependencies['withPlatformTransaction'];
    const startResult: StartPlatformTaskResult = {
      status: 'started',
      runId: 'run-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      leaseTtlSeconds: 60,
      heartbeatIntervalSeconds: 20,
      lease: null
    };
    const materialization: PlatformWorkerMaterialization = {
      runId: 'run-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      stage: 'requirements-analysis',
      outputBaseDir: '/tmp/spec2flow/platform-worker',
      taskGraphPath: '/tmp/spec2flow/platform-worker/task-graph.json',
      executionStatePath: '/tmp/spec2flow/platform-worker/execution-state.json',
      claimPath: '/tmp/spec2flow/platform-worker/task-claim.json',
      taskGraphPayload: {
        taskGraph: {
          id: 'graph-1',
          workflowName: 'fixture-flow',
          tasks: []
        }
      },
      executionStatePayload: {
        executionState: {
          runId: 'run-1',
          workflowName: 'fixture-flow',
          status: 'running',
          tasks: [],
          artifacts: [],
          errors: []
        }
      },
      claimPayload: {
        taskClaim: {
          runId: 'run-1',
          workflowName: 'fixture-flow',
          taskId: 'task-1',
          title: 'Analyze requirements',
          stage: 'requirements-analysis',
          goal: 'Summarize the request',
          executorType: 'requirements-agent',
          roleProfile: {
            profileId: 'requirements-agent',
            specialistRole: 'requirements-agent',
            commandPolicy: 'none',
            canReadRepository: true,
            canEditFiles: false,
            canRunCommands: false,
            canWriteArtifacts: true,
            canOpenCollaboration: false,
            requiredAdapterSupports: [],
            expectedArtifacts: ['requirements-summary']
          },
          repositoryContext: {
            docs: [],
            changedFiles: [],
            targetFiles: [],
            verifyCommands: [],
            taskInputs: {}
          },
          runtimeContext: {
            executionStateRef: '/tmp/spec2flow/platform-worker/execution-state.json',
            taskGraphRef: '/tmp/spec2flow/platform-worker/task-graph.json',
            currentRunStatus: 'running',
            attempt: 1,
            artifactRefs: [],
            taskArtifacts: [],
            taskErrors: [],
            dependsOn: []
          },
          instructions: ['Execute the task']
        }
      },
      snapshot: {
        run: null,
        tasks: [],
        recentEvents: [],
        artifacts: []
      }
    };
    const executionResult: PlatformWorkerExecutionResult = {
      mode: 'external-adapter',
      adapterRun: {
        adapterName: 'fixture-adapter',
        provider: 'fixture-provider',
        taskId: 'task-1',
        runId: 'run-1',
        stage: 'requirements-analysis',
        status: 'completed',
        summary: 'done',
        notes: [],
        activity: {
          commands: [],
          editedFiles: [],
          artifactFiles: [],
          collaborationActions: []
        },
        artifacts: [],
        errors: []
      },
      receipt: {
        taskId: 'task-1',
        status: 'completed',
        executionStateRef: '/tmp/spec2flow/platform-worker/execution-state.json',
        notes: [],
        artifacts: [],
        artifactContract: {
          status: 'satisfied',
          expectedArtifacts: ['requirements-summary'],
          presentArtifacts: ['requirements-summary'],
          missingArtifacts: []
        },
        errors: [],
        submittedAt: '2026-03-24T10:00:00.000Z'
      },
      materialization
    };
    const persistResult: PersistPlatformWorkerResult = {
      runId: 'run-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      updatedTasks: [
        {
          taskId: 'task-1',
          previousStatus: 'in-progress',
          nextStatus: 'completed'
        }
      ],
      insertedArtifactCount: 0,
      platformRunState: {
        run: null,
        tasks: [],
        recentEvents: [],
        artifacts: []
      }
    };

    await runPlatformWorkerTask({
      'database-url': 'postgresql://local/spec2flow',
      'run-id': 'run-1',
      'task-id': 'task-1',
      'worker-id': 'worker-1'
    }, {
      createPlatformPool,
      executePlatformWorkerMaterialization: vi.fn(() => executionResult),
      fail: vi.fn(),
      getRouteNameFromTaskId: vi.fn(() => 'fixture'),
      materializePlatformWorkerClaim: vi.fn(async () => materialization),
      parseCsvOption: vi.fn(() => []),
      persistPlatformWorkerResult: vi.fn(async () => persistResult),
      printJson,
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      sanitizeStageName: vi.fn((value: string) => value),
      startPlatformTask: vi.fn(async () => startResult),
      validateAdapterRuntimePayload: vi.fn(),
      withPlatformTransaction,
      writeJson: vi.fn()
    });

    expect(createPlatformPool).toHaveBeenCalled();
    expect(withPlatformTransaction).toHaveBeenCalledTimes(3);
    expect(printJson).toHaveBeenCalledWith({
      platformWorkerRun: {
        runId: 'run-1',
        taskId: 'task-1',
        workerId: 'worker-1',
        stage: 'requirements-analysis',
        mode: 'external-adapter',
        startResult,
        claimPath: '/tmp/spec2flow/platform-worker/task-claim.json',
        executionStatePath: '/tmp/spec2flow/platform-worker/execution-state.json',
        taskGraphPath: '/tmp/spec2flow/platform-worker/task-graph.json',
        taskClaim: materialization.claimPayload.taskClaim,
        adapterRun: executionResult.adapterRun,
        taskResult: executionResult.receipt,
        updatedTasks: persistResult.updatedTasks,
        insertedArtifactCount: 0,
        platformRunState: persistResult.platformRunState
      }
    });
  });
});
