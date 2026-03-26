import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
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
       expectedArtifacts: ['implementation-summary', 'code-diff']
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

function buildDefectLoopTaskGraphFixture(): TaskGraphDocument {
  const executionTask: Task = {
    id: 'frontend-smoke--automated-execution',
    stage: 'automated-execution',
    title: 'Run frontend smoke automation',
    goal: 'Execute the frontend smoke validation path',
    executorType: 'execution-agent',
    roleProfile: {
      profileId: 'execution-agent',
      specialistRole: 'execution-agent',
      commandPolicy: 'verification-only',
      canReadRepository: true,
      canEditFiles: false,
      canRunCommands: true,
       canWriteArtifacts: true,
       canOpenCollaboration: false,
       requiredAdapterSupports: [],
       expectedArtifacts: ['execution-report', 'verification-evidence']
     },
    status: 'ready',
    verifyCommands: ['npm run test:unit']
  };

  const defectTask: Task = {
    id: 'frontend-smoke--defect-feedback',
    stage: 'defect-feedback',
    title: 'Analyze frontend smoke failure',
    goal: 'Draft defect feedback from automation evidence',
    executorType: 'defect-agent',
    roleProfile: {
      profileId: 'defect-agent',
      specialistRole: 'defect-agent',
      commandPolicy: 'none',
      canReadRepository: true,
      canEditFiles: false,
      canRunCommands: false,
      canWriteArtifacts: true,
      canOpenCollaboration: false,
      requiredAdapterSupports: [],
      expectedArtifacts: ['defect-summary', 'bug-draft']
    },
    status: 'pending',
    dependsOn: [executionTask.id]
  };

  const collaborationTask: Task = {
    id: 'frontend-smoke--collaboration',
    stage: 'collaboration',
    title: 'Prepare collaboration handoff',
    goal: 'Prepare issue or PR handoff after defect handling',
    executorType: 'collaboration-agent',
    roleProfile: {
      profileId: 'collaboration-agent',
      specialistRole: 'collaboration-agent',
      commandPolicy: 'collaboration-only',
      canReadRepository: true,
      canEditFiles: false,
      canRunCommands: false,
      canWriteArtifacts: true,
      canOpenCollaboration: true,
      requiredAdapterSupports: [],
      expectedArtifacts: ['collaboration-handoff']
    },
    status: 'pending',
    dependsOn: [defectTask.id]
  };

  return {
    taskGraph: {
      id: 'graph-defect-loop',
      workflowName: 'defect-loop-fixture',
      source: {
        selectedRoutes: ['frontend-smoke'],
        routeSelectionMode: 'requirements',
        requirementText: 'Validate defect routing after failed execution artifacts.'
      },
      tasks: [executionTask, defectTask, collaborationTask]
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

function buildRequirementSummaryArtifact(taskId: string): Record<string, unknown> {
  return {
    taskId,
    stage: 'requirements-analysis',
    goal: 'Summarize the frontend smoke route requirements',
    summary: 'The route needs a scoped requirements handoff.',
    sources: ['docs/architecture.md']
  };
}

function buildImplementationSummaryArtifact(taskId: string): Record<string, unknown> {
  return {
    taskId,
    stage: 'code-implementation',
    goal: 'Apply the approved frontend smoke update',
    summary: 'Updated the frontend smoke entrypoint and touched one target file.',
    changedFiles: [
      {
        path: 'apps/frontend/src/App.tsx',
        changeType: 'modified'
      }
    ]
  };
}

function buildDefectSummaryArtifact(taskId: string): Record<string, unknown> {
  return {
    taskId,
    stage: 'defect-feedback',
    summary: 'The failed smoke run points to a route-guard regression in the implementation stage.',
    failureType: 'implementation',
    severity: 'high',
    evidenceRefs: ['execution-report', 'execution-log'],
    recommendedAction: 'fix-implementation'
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
    fs.writeFileSync(requirementsArtifactPath, `${JSON.stringify(buildRequirementSummaryArtifact('frontend-smoke--requirements-analysis'), null, 2)}\n`, 'utf8');
    fs.writeFileSync(implementationArtifactPath, `${JSON.stringify(buildImplementationSummaryArtifact('frontend-smoke--code-implementation'), null, 2)}\n`, 'utf8');

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
    fs.writeFileSync(requirementsArtifactPath, `${JSON.stringify(buildRequirementSummaryArtifact('frontend-smoke--requirements-analysis'), null, 2)}\n`, 'utf8');

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

  it('rejects invalid schema-backed artifacts before update-execution-state persists them', () => {
    const tempDir = createTempDir();
    const taskGraphPath = path.join(tempDir, 'task-graph.json');
    const statePath = path.join(tempDir, 'execution-state.json');
    const invalidImplementationArtifactPath = path.join(tempDir, 'implementation-summary.invalid.json');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    writeFixtureState(taskGraphPath, statePath);
    fs.writeFileSync(invalidImplementationArtifactPath, `${JSON.stringify({
      taskId: 'frontend-smoke--code-implementation',
      stage: 'code-implementation',
      goal: 'Apply the approved frontend smoke update',
      summary: 'This payload is invalid because changedFiles is missing.'
    }, null, 2)}\n`, 'utf8');

    expect(() => runUpdateExecutionState({
      state: statePath,
      'task-graph': taskGraphPath,
      'task-id': 'frontend-smoke--code-implementation',
      'task-status': 'in-progress',
      executor: 'implementation-agent',
      'add-artifacts': `implementation-summary|report|${invalidImplementationArtifactPath}`
    }, {
      fail: createFail(),
      parseCsvOption,
      printJson: vi.fn(),
      readStructuredFile: readStateOrTaskGraph,
      writeJson
    })).toThrow('artifact schema validation failed');

    const persistedState = readExecutionState(statePath);
    const implementationTaskState = persistedState.executionState.tasks.find((task) => task.taskId === 'frontend-smoke--code-implementation');
    const implementationArtifacts = (persistedState.executionState.artifacts ?? []).filter((artifact) => artifact.id === 'implementation-summary');

    expect(implementationTaskState?.status).toBe('pending');
    expect(implementationTaskState?.attempts).toBe(0);
    expect(implementationArtifacts).toHaveLength(0);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('routes automated-execution into defect-feedback when the artifact contract is missing', () => {
    const tempDir = createTempDir();
    const taskGraphPath = path.join(tempDir, 'task-graph.json');
    const statePath = path.join(tempDir, 'execution-state.json');
    const executionClaimPath = path.join(tempDir, 'execution-task-claim.json');
    const defectClaimPath = path.join(tempDir, 'defect-task-claim.json');
    const logArtifactPath = path.join(tempDir, 'execution-log.txt');

    const taskGraphPayload = buildDefectLoopTaskGraphFixture();
    writeJson(taskGraphPath, taskGraphPayload);
    const executionStatePayload = buildExecutionState(taskGraphPayload, {
      'run-id': 'defect-loop-run',
      adapter: 'github-copilot-cli',
      model: 'gpt-5.4',
      'session-id': 'defect-loop-session'
    }, {
      taskGraph: taskGraphPath
    });
    writeJson(statePath, executionStatePayload);
    fs.writeFileSync(logArtifactPath, 'execution log\n', 'utf8');

    runClaimNextTask({
      state: statePath,
      'task-graph': taskGraphPath,
      output: executionClaimPath
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    const executionClaim = readStructuredFile(executionClaimPath) as TaskClaimPayload;
    expect(executionClaim.taskClaim?.taskId).toBe('frontend-smoke--automated-execution');

    runSubmitTaskResult({
      state: statePath,
      'task-graph': taskGraphPath,
      claim: executionClaimPath,
      'result-status': 'completed',
      summary: 'execution finished without required report',
      'add-artifacts': `execution-log|log|${logArtifactPath}`
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    const stateAfterExecution = readExecutionState(statePath);
    const automatedExecutionTask = stateAfterExecution.executionState.tasks.find((task) => task.taskId === 'frontend-smoke--automated-execution');
    const defectTask = stateAfterExecution.executionState.tasks.find((task) => task.taskId === 'frontend-smoke--defect-feedback');
    const collaborationTask = stateAfterExecution.executionState.tasks.find((task) => task.taskId === 'frontend-smoke--collaboration');

    expect(automatedExecutionTask?.status).toBe('completed');
    expect(automatedExecutionTask?.notes).toContain('artifact-contract:missing');
    expect(automatedExecutionTask?.notes).toContain('artifact-contract-missing:execution-report,verification-evidence');
    expect(defectTask?.status).toBe('ready');
    expect(defectTask?.notes).toContain('route-trigger:automated-execution');
    expect(defectTask?.notes).toContain('route-reason:artifact-contract-missing');
    expect(collaborationTask?.status).toBe('pending');
    expect(stateAfterExecution.executionState.currentStage).toBe('defect-feedback');

    runClaimNextTask({
      state: statePath,
      'task-graph': taskGraphPath,
      output: defectClaimPath
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    const defectClaim = readStructuredFile(defectClaimPath) as TaskClaimPayload;
    expect(defectClaim.taskClaim?.taskId).toBe('frontend-smoke--defect-feedback');
    expect(defectClaim.taskClaim?.stage).toBe('defect-feedback');
  });

  it('advances defect-feedback into collaboration after defect handling completes', () => {
    const tempDir = createTempDir();
    const taskGraphPath = path.join(tempDir, 'task-graph.json');
    const statePath = path.join(tempDir, 'execution-state.json');
    const executionClaimPath = path.join(tempDir, 'execution-task-claim.json');
    const defectClaimPath = path.join(tempDir, 'defect-task-claim.json');
    const collaborationClaimPath = path.join(tempDir, 'collaboration-task-claim.json');
    const logArtifactPath = path.join(tempDir, 'execution-log.txt');
    const defectSummaryPath = path.join(tempDir, 'defect-summary.json');
    const bugDraftPath = path.join(tempDir, 'bug-draft.md');

    const taskGraphPayload = buildDefectLoopTaskGraphFixture();
    writeJson(taskGraphPath, taskGraphPayload);
    const executionStatePayload = buildExecutionState(taskGraphPayload, {
      'run-id': 'defect-collaboration-run',
      adapter: 'github-copilot-cli',
      model: 'gpt-5.4',
      'session-id': 'defect-collaboration-session'
    }, {
      taskGraph: taskGraphPath
    });
    writeJson(statePath, executionStatePayload);
    fs.writeFileSync(logArtifactPath, 'execution log\n', 'utf8');
    fs.writeFileSync(defectSummaryPath, `${JSON.stringify(buildDefectSummaryArtifact('frontend-smoke--defect-feedback'), null, 2)}\n`, 'utf8');
    fs.writeFileSync(bugDraftPath, '# Bug draft\n', 'utf8');

    runClaimNextTask({
      state: statePath,
      'task-graph': taskGraphPath,
      output: executionClaimPath
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    runSubmitTaskResult({
      state: statePath,
      'task-graph': taskGraphPath,
      claim: executionClaimPath,
      'result-status': 'completed',
      summary: 'execution finished without required report',
      'add-artifacts': `execution-log|log|${logArtifactPath}`
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    runClaimNextTask({
      state: statePath,
      'task-graph': taskGraphPath,
      output: defectClaimPath
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    const claimedDefectTask = readExecutionState(statePath).executionState.tasks.find((task) => task.taskId === 'frontend-smoke--defect-feedback');
    expect(claimedDefectTask?.status).toBe('in-progress');
    expect(claimedDefectTask?.attempts).toBe(1);

    runSubmitTaskResult({
      state: statePath,
      'task-graph': taskGraphPath,
      claim: defectClaimPath,
      'result-status': 'completed',
      summary: 'defect analysis completed',
      notes: 'bug-draft-ready',
      'add-artifacts': `defect-summary|report|${defectSummaryPath},bug-draft|report|${bugDraftPath}`
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    const stateAfterDefect = readExecutionState(statePath);
    const defectTask = stateAfterDefect.executionState.tasks.find((task) => task.taskId === 'frontend-smoke--defect-feedback');
    const collaborationTask = stateAfterDefect.executionState.tasks.find((task) => task.taskId === 'frontend-smoke--collaboration');

    expect(defectTask?.status).toBe('completed');
    expect(defectTask?.notes).toContain('route-trigger:automated-execution');
    expect(defectTask?.notes).toContain('route-reason:artifact-contract-missing');
    expect(defectTask?.notes).toContain('bug-draft-ready');
    expect(defectTask?.artifactRefs).toContain('defect-summary');
    expect(defectTask?.artifactRefs).toContain('bug-draft');
    expect(collaborationTask?.status).toBe('ready');
    expect(stateAfterDefect.executionState.currentStage).toBe('collaboration');
    expect(stateAfterDefect.executionState.status).toBe('running');

    runClaimNextTask({
      state: statePath,
      'task-graph': taskGraphPath,
      output: collaborationClaimPath
    }, {
      fail: createFail(),
      printJson: vi.fn(),
      readStructuredFile,
      writeJson
    });

    const collaborationClaim = readStructuredFile(collaborationClaimPath) as TaskClaimPayload;
    expect(collaborationClaim.taskClaim?.taskId).toBe('frontend-smoke--collaboration');
    expect(collaborationClaim.taskClaim?.stage).toBe('collaboration');
  });
});
