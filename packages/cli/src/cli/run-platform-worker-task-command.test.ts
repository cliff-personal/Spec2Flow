import { afterEach, describe, expect, it, vi } from 'vitest';

import { runPlatformWorkerTask, type RunPlatformWorkerTaskDependencies } from './run-platform-worker-task-command.js';
import type { PlatformWorkerMaterialization, PlatformWorkerExecutionResult, PersistPlatformWorkerResult } from '../platform/platform-worker-service.js';
import type { HeartbeatPlatformTaskResult, StartPlatformTaskResult } from '../platform/platform-scheduler-service.js';

function createMaterialization(): PlatformWorkerMaterialization {
  return {
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
}

function createExecutionResult(materialization: PlatformWorkerMaterialization): PlatformWorkerExecutionResult {
  return {
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
}

function createPersistResult(): PersistPlatformWorkerResult {
  return {
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
}

function createStartResult(): StartPlatformTaskResult {
  return {
    status: 'started',
    runId: 'run-1',
    taskId: 'task-1',
    workerId: 'worker-1',
    leaseTtlSeconds: 60,
    heartbeatIntervalSeconds: 1,
    lease: null
  };
}

function createHeartbeatRenewed(): HeartbeatPlatformTaskResult {
  return {
    status: 'renewed',
    runId: 'run-1',
    taskId: 'task-1',
    workerId: 'worker-1',
    leaseTtlSeconds: 60,
    heartbeatIntervalSeconds: 1,
    lease: null
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('run-platform-worker-task-command', () => {
  it('renews task leases while a platform worker execution is still running', async () => {
    vi.useFakeTimers();

    const printJson = vi.fn();
    const materialization = createMaterialization();
    const executionResult = createExecutionResult(materialization);
    const persistResult = createPersistResult();
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
    const heartbeatPlatformTask = vi.fn(async () => createHeartbeatRenewed());
    const executePlatformWorkerMaterialization = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return executionResult;
    });

    const runPromise = runPlatformWorkerTask({
      'database-url': 'postgresql://local/spec2flow',
      'run-id': 'run-1',
      'task-id': 'task-1',
      'worker-id': 'worker-1'
    }, {
      buildStoppedPlatformWorkerExecutionResult: vi.fn(),
      createPlatformPool,
      executePlatformWorkerMaterialization,
      fail: vi.fn(),
      getRouteNameFromTaskId: vi.fn(() => 'fixture'),
      heartbeatPlatformTask,
      materializePlatformWorkerClaim: vi.fn(async () => materialization),
      parseCsvOption: vi.fn(() => []),
      persistPlatformWorkerResult: vi.fn(async () => persistResult),
      printJson,
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      sanitizeStageName: vi.fn((value: string) => value),
      startPlatformTask: vi.fn(async () => createStartResult()),
      validateAdapterRuntimePayload: vi.fn(),
      withPlatformTransaction,
      writeJson: vi.fn()
    });

    await vi.advanceTimersByTimeAsync(3000);
    await runPromise;

    expect(heartbeatPlatformTask).toHaveBeenCalledTimes(2);
    expect(printJson).toHaveBeenCalledWith({
      platformWorkerRun: expect.objectContaining({
        runId: 'run-1',
        taskId: 'task-1',
        workerId: 'worker-1',
        leaseGuard: expect.objectContaining({
          heartbeatsAttempted: 2,
          heartbeatsSucceeded: 2,
          heartbeatErrors: 0,
          status: 'completed'
        })
      })
    });
  });

  it('stops and persists a blocked receipt after repeated heartbeat failures', async () => {
    vi.useFakeTimers();

    const printJson = vi.fn();
    const materialization = createMaterialization();
    const persistResult = createPersistResult();
    const stoppedExecutionResult: PlatformWorkerExecutionResult = {
      mode: 'stopped',
      adapterRun: {
        adapterName: 'spec2flow-platform-worker',
        provider: 'spec2flow-platform-worker',
        taskId: 'task-1',
        runId: 'run-1',
        stage: 'requirements-analysis',
        status: 'blocked',
        summary: 'platform worker stopped after 2 consecutive heartbeat errors',
        notes: ['platform-worker-stop:heartbeat-error-threshold'],
        activity: {
          commands: [],
          editedFiles: [],
          artifactFiles: [],
          collaborationActions: []
        },
        artifacts: [],
        errors: [
          {
            code: 'heartbeat-error-threshold',
            message: 'platform worker stopped after 2 consecutive heartbeat errors',
            taskId: 'task-1',
            recoverable: true
          }
        ]
      },
      receipt: {
        taskId: 'task-1',
        status: 'blocked',
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
    const heartbeatPlatformTask = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const buildStoppedPlatformWorkerExecutionResult = vi.fn(() => stoppedExecutionResult);
    const executePlatformWorkerMaterialization = vi.fn(async (options: { signal?: AbortSignal; }) =>
      new Promise<PlatformWorkerExecutionResult>((resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(options.signal?.reason ?? new Error('aborted'));
        }, { once: true });
        void resolve;
      }));

    const runPromise = runPlatformWorkerTask({
      'database-url': 'postgresql://local/spec2flow',
      'run-id': 'run-1',
      'task-id': 'task-1',
      'worker-id': 'worker-1',
      'heartbeat-error-threshold': '2'
    }, {
      buildStoppedPlatformWorkerExecutionResult,
      createPlatformPool,
      executePlatformWorkerMaterialization,
      fail: vi.fn(),
      getRouteNameFromTaskId: vi.fn(() => 'fixture'),
      heartbeatPlatformTask,
      materializePlatformWorkerClaim: vi.fn(async () => materialization),
      parseCsvOption: vi.fn(() => []),
      persistPlatformWorkerResult: vi.fn(async () => persistResult),
      printJson,
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      sanitizeStageName: vi.fn((value: string) => value),
      startPlatformTask: vi.fn(async () => createStartResult()),
      validateAdapterRuntimePayload: vi.fn(),
      withPlatformTransaction,
      writeJson: vi.fn()
    });

    await vi.advanceTimersByTimeAsync(2500);
    await runPromise;

    expect(heartbeatPlatformTask).toHaveBeenCalledTimes(2);
    expect(buildStoppedPlatformWorkerExecutionResult).toHaveBeenCalledWith(expect.objectContaining({
      materialization,
      code: 'heartbeat-error-threshold'
    }));
    expect(printJson).toHaveBeenCalledWith({
      platformWorkerRun: expect.objectContaining({
        mode: 'stopped',
        leaseGuard: expect.objectContaining({
          heartbeatsAttempted: 2,
          heartbeatsSucceeded: 0,
          heartbeatErrors: 2,
          status: 'stopped',
          stopReason: 'heartbeat-error-threshold'
        })
      })
    });
  });
});
