import { describe, expect, it } from 'vitest';
import {
  buildInitialTaskState,
  inferExecutionStateStatus,
  promoteReadyTasks
} from './execution-state-service.js';
import type { ExecutionStateDocument } from '../types/execution-state.js';
import type { Task, TaskGraphDocument } from '../types/task-graph.js';

function createTask(overrides: Partial<Task> & Pick<Task, 'id' | 'stage' | 'title' | 'goal' | 'executorType' | 'roleProfile' | 'status'>): Task {
  return {
    riskLevel: 'low',
    ...overrides
  };
}

describe('execution-state-service', () => {
  it('builds initial task notes from role profile and risk metadata', () => {
    const task = createTask({
      id: 'route--requirements-analysis',
      stage: 'requirements-analysis',
      title: 'Analyze scope',
      goal: 'Summarize requirements',
      executorType: 'requirements-agent',
      status: 'ready',
      roleProfile: {
        profileId: 'requirements-analysis-specialist',
        specialistRole: 'requirements-agent',
        commandPolicy: 'none',
        canReadRepository: true,
        canEditFiles: false,
        canRunCommands: false,
        canWriteArtifacts: true,
        canOpenCollaboration: false,
        requiredAdapterSupports: ['toolCalling'],
        expectedArtifacts: ['requirements-summary']
      }
    });

    expect(buildInitialTaskState(task)).toMatchObject({
      taskId: 'route--requirements-analysis',
      status: 'ready',
      executor: 'requirements-agent',
      notes: [
        'stage:requirements-analysis',
        'role-profile:requirements-analysis-specialist',
        'risk:low'
      ]
    });
  });

  it('promotes pending tasks once dependencies are completed or skipped', () => {
    const taskGraphPayload: TaskGraphDocument = {
      taskGraph: {
        id: 'workflow',
        workflowName: 'workflow',
        tasks: [
          createTask({
            id: 'route--requirements-analysis',
            stage: 'requirements-analysis',
            title: 'Analyze',
            goal: 'Analyze',
            executorType: 'requirements-agent',
            status: 'ready',
            roleProfile: {
              profileId: 'requirements-analysis-specialist',
              specialistRole: 'requirements-agent',
              commandPolicy: 'none',
              canReadRepository: true,
              canEditFiles: false,
              canRunCommands: false,
              canWriteArtifacts: true,
              canOpenCollaboration: false,
              requiredAdapterSupports: [],
              expectedArtifacts: ['requirements-summary']
            }
          }),
          createTask({
            id: 'route--code-implementation',
            stage: 'code-implementation',
            title: 'Implement',
            goal: 'Implement',
            executorType: 'implementation-agent',
            status: 'pending',
            dependsOn: ['route--requirements-analysis'],
            roleProfile: {
              profileId: 'code-implementation-specialist',
              specialistRole: 'implementation-agent',
              commandPolicy: 'safe-repo-commands',
              canReadRepository: true,
              canEditFiles: true,
              canRunCommands: true,
              canWriteArtifacts: true,
              canOpenCollaboration: false,
              requiredAdapterSupports: [],
              expectedArtifacts: ['implementation-summary']
            }
          })
        ]
      }
    };
    const executionStatePayload: ExecutionStateDocument = {
      executionState: {
        runId: 'run-1',
        workflowName: 'workflow',
        status: 'running',
        tasks: [
          {
            taskId: 'route--requirements-analysis',
            status: 'completed',
            executor: 'requirements-agent'
          },
          {
            taskId: 'route--code-implementation',
            status: 'pending',
            executor: 'implementation-agent'
          }
        ]
      }
    };

    promoteReadyTasks(taskGraphPayload, executionStatePayload);

    expect(executionStatePayload.executionState.tasks[1]?.status).toBe('ready');
  });

  it('infers failed workflow status before completed', () => {
    expect(
      inferExecutionStateStatus([
        { taskId: 'a', status: 'completed' },
        { taskId: 'b', status: 'failed' }
      ])
    ).toBe('failed');
  });
});