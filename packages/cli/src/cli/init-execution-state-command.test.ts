import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildExecutionState: vi.fn(),
  validateExecutionStatePayload: vi.fn()
}));

vi.mock('../runtime/execution-state-service.js', () => ({
  buildExecutionState: mocks.buildExecutionState,
  validateExecutionStatePayload: mocks.validateExecutionStatePayload
}));

import { runInitExecutionState } from './init-execution-state-command.js';

describe('init-execution-state-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails when task graph path is missing', () => {
    const fail = vi.fn();

    expect(() => runInitExecutionState({}, {
      fail,
      printJson: vi.fn(),
      readStructuredFile: vi.fn(),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('init-execution-state requires --task-graph');
  });

  it('writes execution state when output is requested', () => {
    const taskGraphPayload = {
      taskGraph: {
        id: 'graph-1',
        workflowName: 'demo',
        tasks: []
      }
    };
    const executionStatePayload = {
      executionState: {
        runId: 'run-1',
        tasks: []
      }
    };
    const writeJson = vi.fn();

    mocks.buildExecutionState.mockReturnValue(executionStatePayload);

    runInitExecutionState({
      'task-graph': 'task-graph.json',
      output: 'generated/execution-state.json',
      'run-id': 'run-1',
      adapter: 'github-copilot-cli',
      model: 'gpt-5.4'
    }, {
      fail: vi.fn(),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(() => taskGraphPayload),
      writeJson
    });

    expect(mocks.buildExecutionState).toHaveBeenCalledWith(taskGraphPayload, {
      'task-graph': 'task-graph.json',
      output: 'generated/execution-state.json',
      'run-id': 'run-1',
      adapter: 'github-copilot-cli',
      model: 'gpt-5.4'
    }, {
      taskGraph: 'task-graph.json'
    });
    expect(mocks.validateExecutionStatePayload).toHaveBeenCalledWith(executionStatePayload, 'task-graph.json');
    expect(writeJson).toHaveBeenCalledWith('generated/execution-state.json', executionStatePayload);
  });

  it('prints execution state when no output path is provided', () => {
    const printJson = vi.fn();
    const executionStatePayload = {
      executionState: {
        runId: 'run-1',
        tasks: []
      }
    };

    mocks.buildExecutionState.mockReturnValue(executionStatePayload);

    runInitExecutionState({
      'task-graph': 'task-graph.json'
    }, {
      fail: vi.fn(),
      printJson,
      readStructuredFile: vi.fn(() => ({
        taskGraph: {
          id: 'graph-1',
          workflowName: 'demo',
          tasks: []
        }
      })),
      writeJson: vi.fn()
    });

    expect(printJson).toHaveBeenCalledWith(executionStatePayload);
  });
});