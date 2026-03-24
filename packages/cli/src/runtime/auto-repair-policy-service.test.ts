import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { applyAutoRepairPolicy } from './auto-repair-policy-service.js';
import type { TaskState } from '../types/execution-state.js';
import type { Task, TaskRoleProfile } from '../types/task-graph.js';

const tempDirs: string[] = [];

function createRoleProfile(stage: TaskRoleProfile['specialistRole']): TaskRoleProfile {
  return {
    profileId: `${stage}-profile`,
    specialistRole: stage,
    commandPolicy: 'none',
    canReadRepository: true,
    canEditFiles: false,
    canRunCommands: false,
    canWriteArtifacts: true,
    canOpenCollaboration: false,
    requiredAdapterSupports: [],
    expectedArtifacts: []
  };
}

function createDefectSummary(baseDir: string, recommendedAction: 'fix-implementation' | 'clarify-requirements' | 'expand-tests' | 'rerun-execution' = 'fix-implementation'): string {
  const filePath = path.join(baseDir, 'defect-summary.json');
  fs.writeFileSync(filePath, `${JSON.stringify({
    taskId: 'frontend-smoke--defect-feedback',
    stage: 'defect-feedback',
    summary: 'Repairable defect.',
    failureType: recommendedAction === 'clarify-requirements'
      ? 'requirements'
      : recommendedAction === 'expand-tests'
        ? 'test-design'
        : recommendedAction === 'rerun-execution'
          ? 'execution'
          : 'implementation',
    severity: 'medium',
    evidenceRefs: ['execution-report'],
    recommendedAction
  }, null, 2)}\n`, 'utf8');
  return filePath;
}

function createRouteTasks(reviewPolicy: Partial<NonNullable<Task['reviewPolicy']>> = {}): { taskGraphTaskIndex: Map<string, Task>; taskStateIndex: Map<string, TaskState>; } {
  const tasks: Task[] = [
    {
      id: 'frontend-smoke--code-implementation',
      stage: 'code-implementation',
      title: 'Implement',
      goal: 'Implement',
      executorType: 'implementation-agent',
      roleProfile: createRoleProfile('implementation-agent'),
      status: 'blocked',
      riskLevel: 'medium',
      reviewPolicy: {
        maxAutoRepairAttempts: 2,
        blockedRiskLevels: [],
        ...reviewPolicy
      }
    },
    {
      id: 'frontend-smoke--test-design',
      stage: 'test-design',
      title: 'Test',
      goal: 'Test',
      executorType: 'test-design-agent',
      roleProfile: createRoleProfile('test-design-agent'),
      status: 'skipped'
    },
    {
      id: 'frontend-smoke--automated-execution',
      stage: 'automated-execution',
      title: 'Execute',
      goal: 'Execute',
      executorType: 'execution-agent',
      roleProfile: createRoleProfile('execution-agent'),
      status: 'skipped'
    },
    {
      id: 'frontend-smoke--defect-feedback',
      stage: 'defect-feedback',
      title: 'Defect',
      goal: 'Defect',
      executorType: 'defect-agent',
      roleProfile: createRoleProfile('defect-agent'),
      status: 'completed'
    },
    {
      id: 'frontend-smoke--collaboration',
      stage: 'collaboration',
      title: 'Collaborate',
      goal: 'Collaborate',
      executorType: 'collaboration-agent',
      roleProfile: createRoleProfile('collaboration-agent'),
      status: 'pending'
    }
  ];

  const states: TaskState[] = [
    {
      taskId: 'frontend-smoke--code-implementation',
      status: 'blocked',
      notes: []
    },
    {
      taskId: 'frontend-smoke--test-design',
      status: 'skipped',
      notes: []
    },
    {
      taskId: 'frontend-smoke--automated-execution',
      status: 'skipped',
      notes: []
    },
    {
      taskId: 'frontend-smoke--defect-feedback',
      status: 'completed',
      notes: ['route-class:implementation-defect']
    },
    {
      taskId: 'frontend-smoke--collaboration',
      status: 'pending',
      notes: []
    }
  ];

  return {
    taskGraphTaskIndex: new Map(tasks.map((task) => [task.id, task])),
    taskStateIndex: new Map(states.map((task) => [task.taskId, task]))
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

describe('auto-repair-policy-service', () => {
  it('triggers rerun invalidation for the owning stage when repair policy allows it', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-auto-repair-'));
    tempDirs.push(tempDir);
    const defectSummaryPath = createDefectSummary(tempDir, 'fix-implementation');
    const { taskGraphTaskIndex, taskStateIndex } = createRouteTasks();
    const defectTask = taskGraphTaskIndex.get('frontend-smoke--defect-feedback');
    const defectState = taskStateIndex.get('frontend-smoke--defect-feedback');
    if (!defectTask || !defectState) {
      throw new Error('missing defect task fixture');
    }

    const decision = applyAutoRepairPolicy({
      taskGraphTaskIndex,
      taskStateIndex,
      taskGraphTask: defectTask,
      taskState: defectState,
      artifacts: [
        {
          id: 'defect-summary',
          kind: 'report',
          path: defectSummaryPath
        }
      ],
      artifactContract: {
        status: 'satisfied',
        expectedArtifacts: ['defect-summary'],
        presentArtifacts: ['defect-summary'],
        missingArtifacts: []
      },
      artifactBaseDir: tempDir
    });

    expect(decision).toEqual({
      status: 'triggered',
      targetTaskId: 'frontend-smoke--code-implementation',
      attemptNumber: 1
    });
    expect(taskStateIndex.get('frontend-smoke--code-implementation')?.status).toBe('ready');
    expect(taskStateIndex.get('frontend-smoke--test-design')?.status).toBe('pending');
    expect(taskStateIndex.get('frontend-smoke--defect-feedback')?.status).toBe('pending');
    expect(taskStateIndex.get('frontend-smoke--collaboration')?.status).toBe('pending');
  });

  it('escalates when the auto-repair budget is exhausted', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-auto-repair-'));
    tempDirs.push(tempDir);
    const defectSummaryPath = createDefectSummary(tempDir, 'fix-implementation');
    const { taskGraphTaskIndex, taskStateIndex } = createRouteTasks();
    const implementationState = taskStateIndex.get('frontend-smoke--code-implementation');
    const defectState = taskStateIndex.get('frontend-smoke--defect-feedback');
    const collaborationState = taskStateIndex.get('frontend-smoke--collaboration');
    const defectTask = taskGraphTaskIndex.get('frontend-smoke--defect-feedback');
    if (!implementationState || !defectState || !collaborationState || !defectTask) {
      throw new Error('missing fixture');
    }

    implementationState.notes = ['auto-repair-attempt:2'];

    const decision = applyAutoRepairPolicy({
      taskGraphTaskIndex,
      taskStateIndex,
      taskGraphTask: defectTask,
      taskState: defectState,
      artifacts: [
        {
          id: 'defect-summary',
          kind: 'report',
          path: defectSummaryPath
        }
      ],
      artifactContract: {
        status: 'satisfied',
        expectedArtifacts: ['defect-summary'],
        presentArtifacts: ['defect-summary'],
        missingArtifacts: []
      },
      artifactBaseDir: tempDir
    });

    expect(decision).toEqual({
      status: 'escalated',
      reason: 'budget-exhausted',
      targetTaskId: 'frontend-smoke--code-implementation',
      attemptNumber: 3
    });
    expect(defectState.notes).toContain('auto-repair-escalated:budget-exhausted');
    expect(collaborationState.notes).toContain('auto-repair-escalated:budget-exhausted');
    expect(taskStateIndex.get('frontend-smoke--code-implementation')?.status).toBe('blocked');
  });
});
