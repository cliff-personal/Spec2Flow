import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runClaimNextTask } from './claim-next-task-command.js';
import { runSubmitTaskResult } from './submit-task-result-command.js';
import { runUpdateExecutionState } from './update-execution-state-command.js';
import { buildExecutionState } from '../runtime/execution-state-service.js';
import { parseCsvOption, readStructuredFile, writeJson } from '../shared/fs-utils.js';
import type {
  ExecutionStateDocument,
  Task,
  TaskClaimPayload,
  TaskGraphDocument,
  TaskResultDocument
} from '../types/index.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-command-chain-'));
  tempDirs.push(dir);
  return dir;
}

function createFail(): (message: string) => never {
  return (message: string): never => {
    throw new Error(message);
  };
}

function buildTaskGraphFixture(taskGraphPath: string): TaskGraphDocument {
  const requirementsTask: Task = {
    id: 'frontend-smoke--requirements-analysis',
    stage: 'requirements-analysis',
    title: 'Analyze frontend smoke requirements',
    goal: 'Summarize the frontend smoke route requirements',
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
    status: 'ready',
    targetFiles: ['apps/frontend/src/App.tsx']
  };

  const implementationTask: Task = {
    id: 'frontend-smoke--code-implementation',
    stage: 'code-implementation',
    title: 'Implement frontend smoke change',
    goal: 'Apply the approved frontend smoke update',
    executorType: 'implementation-agent',
    roleProfile: {
      profileId: 'implementation-agent',
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
    status: 'pending',
    dependsOn: [requirementsTask.id],
    targetFiles: ['apps/frontend/src/App.tsx'],
    verifyCommands: ['npm run test:unit']
  };

  return {
    taskGraph: {
      id: 'graph-fixture',
      workflowName: 'fixture-flow',
      source: {
        projectAdapterRef: null,
        topologyRef: null,
        riskPolicyRef: null,
        selectedRoutes: ['frontend-smoke'],
        routeSelectionMode: 'requirements',
        changeSet: ['apps/frontend/src/App.tsx'],
        requirementText: 'Update the frontend smoke flow.'
      },
      tasks: [requirementsTask, implementationTask]
    }
  };
}

function writeFixtureState(taskGraphPath: string, statePath: string): void {
  const taskGraphPayload = buildTaskGraphFixture(taskGraphPath);
  writeJson(taskGraphPath, taskGraphPayload);
  const executionStatePayload = buildExecutionState(taskGraphPayload, {
    'run-id': 'fixture-run',
    adapter: 'github-copilot-cli',
    model: 'gpt-5.4',
    'session-id': 'fixture-session'
  }, {
    taskGraph: taskGraphPath
  });
  writeJson(statePath, executionStatePayload);
}

function readExecutionState(statePath: string): ExecutionStateDocument {
  return readStructuredFile(statePath) as ExecutionStateDocument;
}

function readStateOrTaskGraph(filePath: string): ExecutionStateDocument | TaskGraphDocument {
  return readStructuredFile(filePath) as ExecutionStateDocument | TaskGraphDocument;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('command chain integration', () => {
  it('runs claim-next-task -> submit-task-result -> update-execution-state across persisted fixture files', () => {
    const tempDir = createTempDir();
    const taskGraphPath = path.join(tempDir, 'task-graph.json');
    const statePath = path.join(tempDir, 'execution-state.json');
    const claimPath = path.join(tempDir, 'task-claim.json');
    const receiptPath = path.join(tempDir, 'task-result.json');
    const requirementsArtifactPath = path.join(tempDir, 'requirements-summary.json');
    const implementationArtifactPath = path.join(tempDir, 'implementation-summary.json');

    writeFixtureState(taskGraphPath, statePath);
    fs.writeFileSync(requirementsArtifactPath, '{"summary":true}\n', 'utf8');
    fs.writeFileSync(implementationArtifactPath, '{"implementation":true}\n', 'utf8');

    runClaimNextTask({
      state: statePath,
      'task-graph': taskGraphPath,
      output: claimPath
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    const claimPayload = readStructuredFile(claimPath) as TaskClaimPayload;
    expect(claimPayload.taskClaim?.taskId).toBe('frontend-smoke--requirements-analysis');

    const stateAfterClaim = readExecutionState(statePath);
    const claimedTaskState = stateAfterClaim.executionState.tasks.find((task) => task.taskId === 'frontend-smoke--requirements-analysis');
    expect(claimedTaskState?.status).toBe('in-progress');
    expect(claimedTaskState?.attempts).toBe(1);
    expect(stateAfterClaim.executionState.status).toBe('running');
    expect(stateAfterClaim.executionState.currentStage).toBe('requirements-analysis');

    runSubmitTaskResult({
      state: statePath,
      'task-graph': taskGraphPath,
      claim: claimPath,
      'result-status': 'completed',
      summary: 'requirements captured',
      notes: 'handoff-ready',
      'add-artifacts': `requirements-summary|report|${requirementsArtifactPath}`,
      output: receiptPath
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    const receipt = readStructuredFile(receiptPath) as TaskResultDocument;
    expect(receipt.taskResult.taskId).toBe('frontend-smoke--requirements-analysis');
    expect(receipt.taskResult.status).toBe('completed');
    expect(receipt.taskResult.artifactContract.status).toBe('satisfied');

    const stateAfterSubmit = readExecutionState(statePath);
    const completedTask = stateAfterSubmit.executionState.tasks.find((task) => task.taskId === 'frontend-smoke--requirements-analysis');
    const nextTask = stateAfterSubmit.executionState.tasks.find((task) => task.taskId === 'frontend-smoke--code-implementation');
    expect(completedTask?.status).toBe('completed');
    expect(nextTask?.status).toBe('ready');
    expect(stateAfterSubmit.executionState.currentStage).toBe('code-implementation');

    runUpdateExecutionState({
      state: statePath,
      'task-graph': taskGraphPath,
      'task-id': 'frontend-smoke--code-implementation',
      'task-status': 'in-progress',
      executor: 'implementation-agent',
      notes: 'picked-up-for-edit',
      'artifact-refs': 'implementation-summary',
      'add-artifacts': `implementation-summary|report|${implementationArtifactPath}`
    }, {
      fail: createFail(),
      parseCsvOption,
      printJson: vi.fn(),
      readStructuredFile: readStateOrTaskGraph,
      writeJson
    });

    const finalState = readExecutionState(statePath);
    const implementationTaskState = finalState.executionState.tasks.find((task) => task.taskId === 'frontend-smoke--code-implementation');
    expect(implementationTaskState?.status).toBe('in-progress');
    expect(implementationTaskState?.attempts).toBe(1);
    expect(implementationTaskState?.executor).toBe('implementation-agent');
    expect(implementationTaskState?.notes).toContain('picked-up-for-edit');
    expect(implementationTaskState?.artifactRefs).toContain('implementation-summary');
    expect(finalState.executionState.status).toBe('running');
    expect(finalState.executionState.currentStage).toBe('code-implementation');
  });

  it('allows the downstream task to be re-claimed with allow-resume-in-progress after the chain advances', () => {
    const tempDir = createTempDir();
    const taskGraphPath = path.join(tempDir, 'task-graph.json');
    const statePath = path.join(tempDir, 'execution-state.json');
    const claimPath = path.join(tempDir, 'task-claim.json');
    const requirementsArtifactPath = path.join(tempDir, 'requirements-summary.json');
    const resumedClaimPath = path.join(tempDir, 'resumed-task-claim.json');

    writeFixtureState(taskGraphPath, statePath);
    fs.writeFileSync(requirementsArtifactPath, '{"summary":true}\n', 'utf8');

    runClaimNextTask({
      state: statePath,
      'task-graph': taskGraphPath,
      output: claimPath
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    runSubmitTaskResult({
      state: statePath,
      'task-graph': taskGraphPath,
      claim: claimPath,
      'result-status': 'completed',
      'add-artifacts': `requirements-summary|report|${requirementsArtifactPath}`
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    runUpdateExecutionState({
      state: statePath,
      'task-graph': taskGraphPath,
      'task-id': 'frontend-smoke--code-implementation',
      'task-status': 'in-progress',
      executor: 'implementation-agent'
    }, {
      fail: createFail(),
      parseCsvOption,
      printJson: vi.fn(),
      readStructuredFile: readStateOrTaskGraph,
      writeJson
    });

    runClaimNextTask({
      state: statePath,
      'task-graph': taskGraphPath,
      'allow-resume-in-progress': true,
      output: resumedClaimPath
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    const resumedClaim = readStructuredFile(resumedClaimPath) as TaskClaimPayload;
    expect(resumedClaim.taskClaim?.taskId).toBe('frontend-smoke--code-implementation');
    expect(resumedClaim.taskClaim?.runtimeContext.attempt).toBe(1);
    expect(resumedClaim.taskClaim?.stage).toBe('code-implementation');
  });
});