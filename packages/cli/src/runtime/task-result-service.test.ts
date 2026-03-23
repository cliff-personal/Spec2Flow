import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTaskResult } from './task-result-service.js';
import type { ExecutionStateDocument } from '../types/execution-state.js';
import type { TaskGraphDocument, TaskRoleProfile } from '../types/task-graph.js';

const tempDirs: string[] = [];

function createRoleProfile(stage: TaskRoleProfile['specialistRole'], profileId: string, expectedArtifacts: string[], commandPolicy: TaskRoleProfile['commandPolicy']): TaskRoleProfile {
  return {
    profileId,
    specialistRole: stage,
    commandPolicy,
    canReadRepository: true,
    canEditFiles: false,
    canRunCommands: false,
    canWriteArtifacts: true,
    canOpenCollaboration: false,
    requiredAdapterSupports: [],
    expectedArtifacts
  };
}

function createWorkflowDocuments(): { taskGraphPayload: TaskGraphDocument; executionStatePayload: ExecutionStateDocument; statePath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-task-result-'));
  tempDirs.push(tempDir);
  const statePath = path.join(tempDir, 'execution-state.json');

  return {
    statePath,
    taskGraphPayload: {
      taskGraph: {
        id: 'workflow',
        workflowName: 'workflow',
        tasks: [
          {
            id: 'frontend-smoke--automated-execution',
            stage: 'automated-execution',
            title: 'Run checks',
            goal: 'Run checks',
            executorType: 'execution-agent',
            roleProfile: createRoleProfile('execution-agent', 'automated-execution-specialist', ['execution-report', 'verification-evidence'], 'verification-only'),
            status: 'ready'
          },
          {
            id: 'frontend-smoke--defect-feedback',
            stage: 'defect-feedback',
            title: 'Analyze defects',
            goal: 'Analyze defects',
            executorType: 'defect-agent',
            roleProfile: createRoleProfile('defect-agent', 'defect-feedback-specialist', ['defect-summary'], 'none'),
            status: 'pending',
            dependsOn: ['frontend-smoke--automated-execution']
          },
          {
            id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            title: 'Collaborate',
            goal: 'Collaborate',
            executorType: 'collaboration-agent',
            roleProfile: createRoleProfile('collaboration-agent', 'collaboration-specialist', ['collaboration-handoff'], 'collaboration-only'),
            status: 'pending',
            dependsOn: ['frontend-smoke--defect-feedback']
          }
        ]
      }
    },
    executionStatePayload: {
      executionState: {
        runId: 'run-1',
        workflowName: 'workflow',
        status: 'running',
        tasks: [
          {
            taskId: 'frontend-smoke--automated-execution',
            status: 'ready',
            executor: 'execution-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--defect-feedback',
            status: 'pending',
            executor: 'defect-agent',
            artifactRefs: [],
            notes: []
          },
          {
            taskId: 'frontend-smoke--collaboration',
            status: 'pending',
            executor: 'collaboration-agent',
            artifactRefs: [],
            notes: []
          }
        ],
        artifacts: [],
        errors: []
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

describe('task-result-service', () => {
  it('routes to defect feedback when automated execution artifacts are missing', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createWorkflowDocuments();

    applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--automated-execution',
      taskStatus: 'completed',
      notes: ['summary:execution-finished'],
      artifacts: [
        {
          id: 'execution-report',
          kind: 'report',
          path: 'tmp/execution-report.json',
          taskId: 'frontend-smoke--automated-execution'
        }
      ],
      errors: []
    });

    expect(executionStatePayload.executionState.tasks[1]?.status).toBe('ready');
    expect(executionStatePayload.executionState.tasks[1]?.notes).toContain('route-trigger:automated-execution');
    expect(executionStatePayload.executionState.tasks[2]?.status).toBe('pending');
  });

  it('auto-skips defect feedback when automated execution artifact contract is satisfied', () => {
    const { executionStatePayload, taskGraphPayload, statePath } = createWorkflowDocuments();

    applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
      taskId: 'frontend-smoke--automated-execution',
      taskStatus: 'completed',
      notes: ['summary:execution-finished'],
      artifacts: [
        {
          id: 'execution-report',
          kind: 'report',
          path: 'tmp/execution-report.json',
          taskId: 'frontend-smoke--automated-execution'
        },
        {
          id: 'verification-evidence',
          kind: 'report',
          path: 'tmp/verification-evidence.json',
          taskId: 'frontend-smoke--automated-execution'
        }
      ],
      errors: []
    });

    expect(executionStatePayload.executionState.tasks[1]?.status).toBe('skipped');
    expect(executionStatePayload.executionState.tasks[1]?.notes).toContain('route-auto-skip:defect-feedback');
    expect(executionStatePayload.executionState.tasks[2]?.status).toBe('ready');
  });
});