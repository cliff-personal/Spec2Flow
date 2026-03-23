import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeTaskRun } from './adapter-runner.js';
import type { TaskClaimPayload } from '../types/task-claim.js';
import type { ExecutionStateDocument } from '../types/execution-state.js';
import type { TaskGraphDocument, TaskRoleProfile } from '../types/task-graph.js';

const tempDirs: string[] = [];

function createRoleProfile(commandPolicy: TaskRoleProfile['commandPolicy'], canRunCommands: boolean, canEditFiles: boolean): TaskRoleProfile {
  return {
    profileId: 'requirements-analysis-specialist',
    specialistRole: 'requirements-agent',
    commandPolicy,
    canReadRepository: true,
    canEditFiles,
    canRunCommands,
    canWriteArtifacts: true,
    canOpenCollaboration: false,
    requiredAdapterSupports: [],
    expectedArtifacts: ['requirements-summary']
  };
}

function createTestFiles(commandPolicy: TaskRoleProfile['commandPolicy'], canRunCommands: boolean): {
  statePath: string;
  taskGraphPath: string;
  claimPayload: TaskClaimPayload;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-adapter-runner-'));
  tempDirs.push(tempDir);

  const executionStatePayload: ExecutionStateDocument = {
    executionState: {
      runId: 'run-1',
      workflowName: 'workflow',
      status: 'running',
      tasks: [
        {
          taskId: 'frontend-smoke--requirements-analysis',
          status: 'ready',
          executor: 'requirements-agent',
          artifactRefs: [],
          notes: []
        }
      ],
      artifacts: [],
      errors: []
    }
  };
  const taskGraphPayload: TaskGraphDocument = {
    taskGraph: {
      id: 'workflow',
      workflowName: 'workflow',
      tasks: [
        {
          id: 'frontend-smoke--requirements-analysis',
          stage: 'requirements-analysis',
          title: 'Analyze',
          goal: 'Analyze',
          executorType: 'requirements-agent',
          roleProfile: createRoleProfile(commandPolicy, canRunCommands, false),
          status: 'ready'
        }
      ]
    }
  };
  const statePath = path.join(tempDir, 'execution-state.json');
  const taskGraphPath = path.join(tempDir, 'task-graph.json');

  fs.writeFileSync(statePath, `${JSON.stringify(executionStatePayload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(taskGraphPath, `${JSON.stringify(taskGraphPayload, null, 2)}\n`, 'utf8');

  return {
    statePath,
    taskGraphPath,
    claimPayload: {
      taskClaim: {
        runId: 'run-1',
        workflowName: 'workflow',
        taskId: 'frontend-smoke--requirements-analysis',
        title: 'Analyze',
        stage: 'requirements-analysis',
        goal: 'Analyze',
        executorType: 'requirements-agent',
        roleProfile: createRoleProfile(commandPolicy, canRunCommands, false),
        repositoryContext: {
          docs: [],
          changedFiles: [],
          targetFiles: [],
          verifyCommands: ['npm run validate:synapse-example'],
          taskInputs: {}
        },
        runtimeContext: {
          executionStateRef: statePath,
          taskGraphRef: taskGraphPath,
          currentRunStatus: 'running',
          attempt: 1,
          artifactRefs: [],
          taskArtifacts: [],
          taskErrors: [],
          dependsOn: []
        },
        instructions: []
      }
    }
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('adapter-runner', () => {
  it('keeps simulated requirements-analysis output completed when no forbidden activity is reported', () => {
    const { statePath, taskGraphPath, claimPayload } = createTestFiles('none', false);

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      summary: 'requirements-ready',
      'add-artifacts': 'requirements-summary|report|tmp/requirements-summary.json'
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    expect(result.adapterRun.status).toBe('completed');
  });

  it('fails external adapter output that violates the role policy', () => {
    const { statePath, taskGraphPath, claimPayload } = createTestFiles('none', false);
    const tempDir = path.dirname(statePath);
    const runtimePath = path.join(tempDir, 'adapter-runtime.json');
    fs.writeFileSync(runtimePath, `${JSON.stringify({
      adapterRuntime: {
        name: 'policy-test-adapter',
        provider: 'test-adapter',
        command: 'node',
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({adapterRun:{status:"completed",summary:"requirements-ready",notes:[],activity:{commands:["npm test"],editedFiles:[],artifactFiles:["tmp/requirements-summary.json"],collaborationActions:[]},artifacts:[{id:"requirements-summary",kind:"report",path:"tmp/requirements-summary.json"}],errors:[]}}))'
        ],
        outputMode: 'stdout'
      }
    }, null, 2)}\n`, 'utf8');

    const result = executeTaskRun(statePath, taskGraphPath, claimPayload, {
      'adapter-runtime': runtimePath
    }, {
      validateAdapterRuntimePayload: () => undefined,
      sanitizeStageName: (stage) => stage,
      getRouteNameFromTaskId: (taskId) => taskId?.split('--')[0] ?? '',
      parseCsvOption: (value) => value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : []
    });

    expect(result.adapterRun.status).toBe('failed');
    expect(result.adapterRun.errors.map((error) => error.code)).toContain('role-policy-violation');
  });
});