import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeJson, readStructuredFile, loadOptionalStructuredFile } from '../shared/fs-utils.js';
import { buildExecutionState } from './execution-state-service.js';
import { claimNextTaskPayload } from './task-claim-service.js';
import { applyTaskResult } from './task-result-service.js';
import { runWorkflowLoopWithExecutor } from './workflow-loop-service.js';
import type {
  AdapterRun,
  AdapterRuntimeDocument,
  ArtifactRef,
  ExecutionStateDocument,
  Task,
  TaskClaimPayload,
  TaskExecutionResult,
  TaskGraphDocument,
  WorkflowLoopSummaryDocument
} from '../types/index.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-workflow-loop-'));
  tempDirs.push(dir);
  return dir;
}

function createFail(): (message: string) => never {
  return (message: string): never => {
    throw new Error(message);
  };
}

function createRoleProfile(profileId: Task['roleProfile']['profileId'], specialistRole: Task['roleProfile']['specialistRole'], commandPolicy: Task['roleProfile']['commandPolicy'], expectedArtifacts: string[]): Task['roleProfile'] {
  return {
    profileId,
    specialistRole,
    commandPolicy,
    canReadRepository: true,
    canEditFiles: specialistRole === 'implementation-agent',
    canRunCommands: commandPolicy !== 'none',
    canWriteArtifacts: true,
    canOpenCollaboration: false,
    requiredAdapterSupports: [],
    expectedArtifacts
  };
}

function buildTaskGraphFixture(taskGraphPath: string): TaskGraphDocument {
  const requirementsTask: Task = {
    id: 'frontend-smoke--requirements-analysis',
    stage: 'requirements-analysis',
    title: 'Analyze frontend smoke requirements',
    goal: 'Summarize the route requirements',
    executorType: 'requirements-agent',
    roleProfile: createRoleProfile('requirements-agent', 'requirements-agent', 'none', ['requirements-summary']),
    status: 'ready',
    targetFiles: ['apps/frontend/src/App.tsx']
  };
  const implementationTask: Task = {
    id: 'frontend-smoke--code-implementation',
    stage: 'code-implementation',
    title: 'Implement frontend smoke update',
    goal: 'Apply the approved change',
    executorType: 'implementation-agent',
    roleProfile: createRoleProfile('implementation-agent', 'implementation-agent', 'safe-repo-commands', ['implementation-summary']),
    status: 'pending',
    dependsOn: [requirementsTask.id],
    targetFiles: ['apps/frontend/src/App.tsx'],
    verifyCommands: ['npm run test:unit']
  };

  return {
    taskGraph: {
      id: 'workflow-loop-graph',
      workflowName: 'workflow-loop-fixture',
      source: {
        projectAdapterRef: null,
        topologyRef: null,
        riskPolicyRef: null,
        selectedRoutes: ['frontend-smoke'],
        routeSelectionMode: 'requirements',
        requirementText: 'Update the frontend smoke route.',
        changeSet: ['apps/frontend/src/App.tsx']
      },
      tasks: [requirementsTask, implementationTask]
    }
  };
}

function buildNoReadyTaskGraph(): TaskGraphDocument {
  const blockedTask: Task = {
    id: 'frontend-smoke--code-implementation',
    stage: 'code-implementation',
    title: 'Implement frontend smoke update',
    goal: 'Apply the approved change',
    executorType: 'implementation-agent',
    roleProfile: createRoleProfile('implementation-agent', 'implementation-agent', 'safe-repo-commands', ['implementation-summary']),
    status: 'pending',
    dependsOn: ['frontend-smoke--requirements-analysis']
  };

  return {
    taskGraph: {
      id: 'workflow-loop-no-ready',
      workflowName: 'workflow-loop-no-ready',
      tasks: [blockedTask]
    }
  };
}

function writeFixtureState(taskGraphPath: string, statePath: string, taskGraphPayload: TaskGraphDocument): void {
  writeJson(taskGraphPath, taskGraphPayload);
  const executionStatePayload = buildExecutionState(taskGraphPayload, {
    'run-id': 'workflow-loop-run',
    adapter: 'github-copilot-cli',
    model: 'gpt-5.4',
    'session-id': 'workflow-loop-session'
  }, {
    taskGraph: taskGraphPath
  });
  writeJson(statePath, executionStatePayload);
}

function buildRequirementSummaryArtifact(taskId: string): Record<string, unknown> {
  return {
    taskId,
    stage: 'requirements-analysis',
    goal: 'Summarize the route requirements',
    summary: 'The route needs a requirements handoff before code changes.',
    sources: ['docs/architecture.md']
  };
}

function buildImplementationSummaryArtifact(taskId: string): Record<string, unknown> {
  return {
    taskId,
    stage: 'code-implementation',
    goal: 'Apply the approved change',
    summary: 'Updated the target frontend file for the smoke route.',
    changedFiles: [
      {
        path: 'apps/frontend/src/App.tsx',
        changeType: 'modified'
      }
    ]
  };
}

function createExecuteTaskRun(tempDir: string): (statePath: string, taskGraphPath: string, claimPayload: TaskClaimPayload, options: Record<string, string | boolean | undefined>) => TaskExecutionResult {
  return (statePath, taskGraphPath, claimPayload, options) => {
    const taskId = claimPayload.taskClaim?.taskId;
    if (!taskId || !claimPayload.taskClaim) {
      throw new Error('missing task claim');
    }

    const stage = claimPayload.taskClaim.stage;
    const executionStatePayload = readStructuredFile(statePath) as ExecutionStateDocument;
    const taskGraphPayload = readStructuredFile(taskGraphPath) as TaskGraphDocument;
    const artifactId = stage === 'requirements-analysis' ? 'requirements-summary' : 'implementation-summary';
    const artifactPath = path.join(tempDir, `${taskId}-${artifactId}.json`);
    const artifactPayload = stage === 'requirements-analysis'
      ? buildRequirementSummaryArtifact(taskId)
      : buildImplementationSummaryArtifact(taskId);
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifactPayload, null, 2)}\n`, 'utf8');

    const artifact: ArtifactRef = {
      id: artifactId,
      kind: 'report',
      path: artifactPath,
      taskId
    };

    const receiptDocument = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId,
      taskStatus: 'completed',
      notes: [`summary:${artifactId}`],
      artifacts: [artifact],
      errors: [],
      executor: claimPayload.taskClaim.executorType,
      ...(stage === 'requirements-analysis' ? { currentStage: 'code-implementation' } : {})
    });

    const adapterRun: AdapterRun = {
      adapterName: typeof options['adapter-runtime'] === 'string' ? 'fixture-adapter' : 'fixture-simulator',
      provider: typeof options['adapter-runtime'] === 'string' ? 'fixture-provider' : 'simulation',
      taskId,
      runId: claimPayload.taskClaim.runId,
      stage,
      status: 'completed',
      summary: `completed ${taskId}`,
      notes: [`artifact:${artifactId}`],
      activity: {
        commands: [],
        editedFiles: [],
        artifactFiles: [artifactPath],
        collaborationActions: []
      },
      artifacts: [artifact],
      errors: []
    };

    return {
      adapterRun,
      receipt: receiptDocument.taskResult,
      mode: typeof options['adapter-runtime'] === 'string' ? 'external-adapter' : 'simulation'
    };
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('workflow-loop-service', () => {
  it('completes the workflow using fixture files and writes per-step claim and adapter outputs', () => {
    const tempDir = createTempDir();
    const outputBase = path.join(tempDir, 'outputs');
    const taskGraphPath = path.join(tempDir, 'task-graph.json');
    const statePath = path.join(tempDir, 'execution-state.json');

    writeFixtureState(taskGraphPath, statePath, buildTaskGraphFixture(taskGraphPath));

    const summary = runWorkflowLoopWithExecutor({
      state: statePath,
      'task-graph': taskGraphPath,
      'max-steps': '5',
      'output-base': outputBase
    }, {
      fail: createFail(),
      readStructuredFile,
      writeJson,
      claimNextTaskPayload: (nextStatePath, nextTaskGraphPath, options) => claimNextTaskPayload(nextStatePath, nextTaskGraphPath, options, {
        readStructuredFile,
        loadOptionalStructuredFile,
        writeJson
      }),
      executeTaskRun: createExecuteTaskRun(tempDir),
      validateAdapterRuntimePayload: () => undefined,
      ensureAdapterPreflight: () => undefined
    });

    expect(summary.workflowLoop.stopReason).toBe('completed');
    expect(summary.workflowLoop.stepsExecuted).toBe(2);
    expect(summary.workflowLoop.claimedTaskIds).toEqual([
      'frontend-smoke--requirements-analysis',
      'frontend-smoke--code-implementation'
    ]);
    expect(summary.workflowLoop.receipts.map((receipt) => receipt.executionMode)).toEqual(['simulation', 'simulation']);

    expect(fs.existsSync(path.join(outputBase, 'task-claim-step-1.json'))).toBe(true);
    expect(fs.existsSync(path.join(outputBase, 'task-claim-step-2.json'))).toBe(true);
    expect(fs.existsSync(path.join(outputBase, 'simulated-model-run-step-1.json'))).toBe(true);
    expect(fs.existsSync(path.join(outputBase, 'simulated-model-run-step-2.json'))).toBe(true);

    const finalState = readStructuredFile(statePath) as ExecutionStateDocument;
    expect(finalState.executionState.status).toBe('completed');
    expect(finalState.executionState.tasks.every((task) => task.status === 'completed')).toBe(true);
  });

  it('stops immediately when there is no ready task and preserves zero executed steps', () => {
    const tempDir = createTempDir();
    const taskGraphPath = path.join(tempDir, 'task-graph.json');
    const statePath = path.join(tempDir, 'execution-state.json');

    writeFixtureState(taskGraphPath, statePath, buildNoReadyTaskGraph());

    const summary = runWorkflowLoopWithExecutor({
      state: statePath,
      'task-graph': taskGraphPath,
      'max-steps': '3',
      'output-base': path.join(tempDir, 'outputs')
    }, {
      fail: createFail(),
      readStructuredFile,
      writeJson,
      claimNextTaskPayload: (nextStatePath, nextTaskGraphPath, options) => claimNextTaskPayload(nextStatePath, nextTaskGraphPath, options, {
        readStructuredFile,
        loadOptionalStructuredFile,
        writeJson
      }),
      executeTaskRun: createExecuteTaskRun(tempDir),
      validateAdapterRuntimePayload: () => undefined,
      ensureAdapterPreflight: () => undefined
    });

    expect(summary.workflowLoop.stepsExecuted).toBe(0);
    expect(summary.workflowLoop.claimedTaskIds).toEqual([]);
    expect(summary.workflowLoop.stopReason).toBe('pending');
  });

  it('validates adapter runtime and uses external-adapter output naming when adapter runtime is provided', () => {
    const tempDir = createTempDir();
    const outputBase = path.join(tempDir, 'outputs');
    const taskGraphPath = path.join(tempDir, 'task-graph.json');
    const statePath = path.join(tempDir, 'execution-state.json');
    const adapterRuntimePath = path.join(tempDir, 'adapter-runtime.json');
    const adapterRuntimePayload: AdapterRuntimeDocument = {
      adapterRuntime: {
        name: 'fixture-adapter',
        provider: 'fixture-provider',
        command: 'fixture-command',
        outputMode: 'file'
      }
    };
    let validateCallCount = 0;
    let preflightCallCount = 0;

    writeFixtureState(taskGraphPath, statePath, buildTaskGraphFixture(taskGraphPath));
    writeJson(adapterRuntimePath, adapterRuntimePayload);

    const summary: WorkflowLoopSummaryDocument = runWorkflowLoopWithExecutor({
      state: statePath,
      'task-graph': taskGraphPath,
      'adapter-runtime': adapterRuntimePath,
      'max-steps': '1',
      'output-base': outputBase
    }, {
      fail: createFail(),
      readStructuredFile,
      writeJson,
      claimNextTaskPayload: (nextStatePath, nextTaskGraphPath, options) => claimNextTaskPayload(nextStatePath, nextTaskGraphPath, options, {
        readStructuredFile,
        loadOptionalStructuredFile,
        writeJson
      }),
      executeTaskRun: createExecuteTaskRun(tempDir),
      validateAdapterRuntimePayload: (payload, runtimePath) => {
        validateCallCount += 1;
        expect(payload).toEqual(adapterRuntimePayload);
        expect(runtimePath).toBe(adapterRuntimePath);
      },
      ensureAdapterPreflight: (options, payload) => {
        preflightCallCount += 1;
        expect(options['adapter-runtime']).toBe(adapterRuntimePath);
        expect(payload).toEqual(adapterRuntimePayload);
      }
    });

    expect(validateCallCount).toBe(1);
    expect(preflightCallCount).toBe(1);
    expect(summary.workflowLoop.stepsExecuted).toBe(1);
    expect(summary.workflowLoop.receipts[0]?.executionMode).toBe('external-adapter');
    expect(fs.existsSync(path.join(outputBase, 'adapter-run-step-1.json'))).toBe(true);
  });

  it('preflights unique stage runtime variants when the runtime config is stage-aware', () => {
    const tempDir = createTempDir();
    const taskGraphPath = path.join(tempDir, 'task-graph.json');
    const statePath = path.join(tempDir, 'execution-state.json');
    const adapterRuntimePath = path.join(tempDir, 'adapter-runtime.json');
    const deterministicRuntimePath = path.join(tempDir, 'deterministic-runtime.json');
    const adapterRuntimePayload: AdapterRuntimeDocument = {
      adapterRuntime: {
        name: 'fixture-adapter',
        provider: 'github-copilot-cli',
        command: 'fixture-command',
        outputMode: 'stdout',
        stageRuntimeRefs: {
          'environment-preparation': './deterministic-runtime.json',
          'automated-execution': './deterministic-runtime.json'
        }
      }
    };
    const deterministicRuntimePayload: AdapterRuntimeDocument = {
      adapterRuntime: {
        name: 'deterministic-adapter',
        provider: 'spec2flow-deterministic',
        command: 'deterministic-command',
        outputMode: 'stdout'
      }
    };
    const validatedPaths: string[] = [];
    const preflightProviders: string[] = [];

    writeFixtureState(taskGraphPath, statePath, buildTaskGraphFixture(taskGraphPath));
    writeJson(adapterRuntimePath, adapterRuntimePayload);
    writeJson(deterministicRuntimePath, deterministicRuntimePayload);

    runWorkflowLoopWithExecutor({
      state: statePath,
      'task-graph': taskGraphPath,
      'adapter-runtime': adapterRuntimePath,
      'max-steps': '1',
      'output-base': path.join(tempDir, 'outputs')
    }, {
      fail: createFail(),
      readStructuredFile,
      writeJson,
      claimNextTaskPayload: (nextStatePath, nextTaskGraphPath, options) => claimNextTaskPayload(nextStatePath, nextTaskGraphPath, options, {
        readStructuredFile,
        loadOptionalStructuredFile,
        writeJson
      }),
      executeTaskRun: createExecuteTaskRun(tempDir),
      validateAdapterRuntimePayload: (_payload, runtimePath) => {
        validatedPaths.push(runtimePath);
      },
      ensureAdapterPreflight: (_options, payload) => {
        preflightProviders.push(payload.adapterRuntime.provider ?? 'unknown');
      }
    });

    expect(validatedPaths).toEqual([
      adapterRuntimePath,
      deterministicRuntimePath
    ]);
    expect(preflightProviders).toEqual([
      'github-copilot-cli',
      'spec2flow-deterministic'
    ]);
  });
});