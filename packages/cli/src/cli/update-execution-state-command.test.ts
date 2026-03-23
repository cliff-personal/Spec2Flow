import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecutionStateDocument, Task, TaskGraphDocument, TaskState } from '../types/index.js';

const mocks = vi.hoisted(() => ({
  appendUniqueItems: vi.fn(),
  getExecutionStateTaskIndex: vi.fn(),
  getTaskGraphTaskIndex: vi.fn(),
  inferCurrentStage: vi.fn(),
  inferExecutionStateStatus: vi.fn(),
  parseArtifactOption: vi.fn(),
  parseErrorOption: vi.fn(),
  promoteReadyTasks: vi.fn(),
  setTaskTerminalTimestamp: vi.fn(),
  validateExecutionStatePayload: vi.fn()
}));

vi.mock('../runtime/execution-state-service.js', () => ({
  appendUniqueItems: mocks.appendUniqueItems,
  getExecutionStateTaskIndex: mocks.getExecutionStateTaskIndex,
  getTaskGraphTaskIndex: mocks.getTaskGraphTaskIndex,
  inferCurrentStage: mocks.inferCurrentStage,
  inferExecutionStateStatus: mocks.inferExecutionStateStatus,
  parseArtifactOption: mocks.parseArtifactOption,
  parseErrorOption: mocks.parseErrorOption,
  promoteReadyTasks: mocks.promoteReadyTasks,
  setTaskTerminalTimestamp: mocks.setTaskTerminalTimestamp,
  validateExecutionStatePayload: mocks.validateExecutionStatePayload
}));

import { runUpdateExecutionState } from './update-execution-state-command.js';

describe('update-execution-state-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendUniqueItems.mockImplementation((existing: string[] | undefined, additions: string[]) => {
      if (additions.length === 0) {
        return existing;
      }
      return [...(existing ?? []), ...additions];
    });
    mocks.parseArtifactOption.mockReturnValue([]);
    mocks.parseErrorOption.mockReturnValue([]);
    mocks.inferExecutionStateStatus.mockReturnValue('running');
    mocks.inferCurrentStage.mockReturnValue('requirements-analysis');
  });

  it('fails when required state paths are missing', () => {
    const fail = vi.fn();

    expect(() => runUpdateExecutionState({}, {
      fail,
      parseCsvOption: vi.fn(),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('update-execution-state requires --state and --task-graph');
  });

  it('fails when task id is unknown', () => {
    const fail = vi.fn();
    const executionStatePayload: ExecutionStateDocument = {
      executionState: {
        runId: 'run-1',
        workflowName: 'demo',
        status: 'running',
        tasks: []
      }
    };
    const taskGraphPayload: TaskGraphDocument = {
      taskGraph: {
        id: 'graph-1',
        workflowName: 'demo',
        tasks: []
      }
    };

    mocks.getExecutionStateTaskIndex.mockReturnValue(new Map());
    mocks.getTaskGraphTaskIndex.mockReturnValue(new Map());

    expect(() => runUpdateExecutionState({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      'task-id': 'missing-task'
    }, {
      fail,
      parseCsvOption: vi.fn(() => []),
      printJson: vi.fn(),
      readStructuredFile: vi.fn((filePath: string) => filePath === 'execution-state.json' ? executionStatePayload : taskGraphPayload),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('unknown task id: missing-task');
  });

  it('updates task state and writes the modified execution state back to the state path by default', () => {
    const taskState: TaskState = {
      taskId: 'frontend-smoke--requirements-analysis',
      status: 'ready',
      attempts: 0,
      notes: ['existing'],
      artifactRefs: ['artifact:existing']
    };
    const taskGraphTask: Task = {
      id: 'frontend-smoke--requirements-analysis',
      stage: 'requirements-analysis',
      title: 'Analyze frontend smoke requirements',
      goal: 'Summarize the route requirement set',
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
      status: 'ready'
    };
    const executionStatePayload: ExecutionStateDocument = {
      executionState: {
        runId: 'run-1',
        workflowName: 'demo',
        status: 'running',
        tasks: [taskState],
        artifacts: [],
        errors: []
      }
    };
    const taskGraphPayload: TaskGraphDocument = {
      taskGraph: {
        id: 'graph-1',
        workflowName: 'demo',
        tasks: [taskGraphTask]
      }
    };
    const writeJson = vi.fn();

    mocks.getExecutionStateTaskIndex.mockReturnValue(new Map([[taskState.taskId, taskState]]));
    mocks.getTaskGraphTaskIndex.mockReturnValue(new Map([[taskState.taskId, taskGraphTask]]));
    mocks.parseArtifactOption.mockReturnValue([{ taskId: taskState.taskId, path: 'artifact:new', kind: 'report' }]);
    mocks.parseErrorOption.mockReturnValue([{ taskId: taskState.taskId, message: 'failed step' }]);

    runUpdateExecutionState({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      'task-id': taskState.taskId,
      'task-status': 'in-progress',
      executor: 'implementation-agent',
      notes: 'note-a,note-b',
      'artifact-refs': 'artifact:new-ref',
      'add-artifacts': 'artifact:new',
      'add-errors': 'failed step'
    }, {
      fail: vi.fn(),
      parseCsvOption: vi.fn((value?: string) => value ? value.split(',') : []),
      printJson: vi.fn(),
      readStructuredFile: vi.fn((filePath: string) => filePath === 'execution-state.json' ? executionStatePayload : taskGraphPayload),
      writeJson
    });

    expect(taskState.status).toBe('in-progress');
    expect(taskState.attempts).toBe(1);
    expect(taskState.executor).toBe('implementation-agent');
    expect(taskState.notes).toEqual(['existing', 'note-a', 'note-b']);
    expect(taskState.artifactRefs).toEqual(['artifact:existing', 'artifact:new-ref']);
    expect(mocks.setTaskTerminalTimestamp).toHaveBeenCalled();
    expect(mocks.promoteReadyTasks).toHaveBeenCalledWith(taskGraphPayload, executionStatePayload);
    expect(mocks.validateExecutionStatePayload).toHaveBeenCalledWith(executionStatePayload, 'execution-state.json');
    expect(writeJson).toHaveBeenCalledWith('execution-state.json', executionStatePayload);
  });
});