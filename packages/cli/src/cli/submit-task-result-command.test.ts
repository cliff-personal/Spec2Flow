import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadOptionalStructuredFile: vi.fn(),
  parseCsvOption: vi.fn(),
  parseArtifactOption: vi.fn(),
  parseErrorOption: vi.fn(),
  getTaskIdFromClaim: vi.fn(),
  applyTaskResult: vi.fn()
}));

vi.mock('../shared/fs-utils.js', () => ({
  loadOptionalStructuredFile: mocks.loadOptionalStructuredFile,
  parseCsvOption: mocks.parseCsvOption
}));

vi.mock('../runtime/execution-state-service.js', () => ({
  parseArtifactOption: mocks.parseArtifactOption,
  parseErrorOption: mocks.parseErrorOption
}));

vi.mock('../runtime/task-claim-service.js', () => ({
  getTaskIdFromClaim: mocks.getTaskIdFromClaim
}));

vi.mock('../runtime/task-result-service.js', () => ({
  applyTaskResult: mocks.applyTaskResult
}));

import { runSubmitTaskResult } from './submit-task-result-command.js';

describe('submit-task-result-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseCsvOption.mockReturnValue([]);
    mocks.parseArtifactOption.mockReturnValue([]);
    mocks.parseErrorOption.mockReturnValue([]);
  });

  it('fails when required state paths are missing', () => {
    const fail = vi.fn();

    expect(() => runSubmitTaskResult({}, {
      fail,
      printJson: vi.fn(),
      readStructuredFile: vi.fn(),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('submit-task-result requires --state and --task-graph');
  });

  it('fails when neither task id nor claim resolves a task', () => {
    const fail = vi.fn();

    mocks.loadOptionalStructuredFile.mockReturnValue(undefined);
    mocks.getTaskIdFromClaim.mockReturnValue(undefined);

    expect(() => runSubmitTaskResult({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json'
    }, {
      fail,
      printJson: vi.fn(),
      readStructuredFile: vi.fn(() => ({})),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('submit-task-result requires --task-id or --claim');
  });

  it('writes the task result receipt when output is requested', () => {
    const executionStatePayload = { executionState: { tasks: [] } };
    const taskGraphPayload = { taskGraph: { id: 'graph-1', workflowName: 'demo', tasks: [] } };
    const receipt = { taskResult: { taskId: 'frontend-smoke--requirements-analysis', taskStatus: 'failed' } };
    const writeJson = vi.fn();

    mocks.parseCsvOption.mockReturnValue(['note-a', 'note-b']);
    mocks.parseArtifactOption.mockReturnValue([{ taskId: 'frontend-smoke--requirements-analysis', path: 'artifact:1', kind: 'report' }]);
    mocks.parseErrorOption.mockReturnValue([{ taskId: 'frontend-smoke--requirements-analysis', message: 'boom' }]);
    mocks.applyTaskResult.mockReturnValue(receipt);

    runSubmitTaskResult({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      'task-id': 'frontend-smoke--requirements-analysis',
      'result-status': 'failed',
      status: 'failed',
      stage: 'defect-feedback',
      executor: 'defect-agent',
      summary: 'needs triage',
      notes: 'note-a,note-b',
      'add-artifacts': 'artifact:1',
      'add-errors': 'boom',
      output: 'generated/task-result.json'
    }, {
      fail: vi.fn(),
      printJson: vi.fn(),
      readStructuredFile: vi.fn((filePath: string) => filePath === 'execution-state.json' ? executionStatePayload : taskGraphPayload),
      writeJson
    });

    expect(mocks.applyTaskResult).toHaveBeenCalledWith(executionStatePayload, taskGraphPayload, 'execution-state.json', {
      taskId: 'frontend-smoke--requirements-analysis',
      taskStatus: 'failed',
      notes: ['summary:needs triage', 'note-a', 'note-b'],
      artifacts: [{ taskId: 'frontend-smoke--requirements-analysis', path: 'artifact:1', kind: 'report' }],
      errors: [{ taskId: 'frontend-smoke--requirements-analysis', message: 'boom' }],
      executor: 'defect-agent',
      workflowStatus: 'failed',
      currentStage: 'defect-feedback'
    });
    expect(writeJson).toHaveBeenCalledWith('generated/task-result.json', receipt);
  });

  it('falls back to task id from claim and prints receipt when no output is provided', () => {
    const receipt = { taskResult: { taskId: 'claimed-task', taskStatus: 'completed' } };
    const printJson = vi.fn();

    mocks.loadOptionalStructuredFile.mockReturnValue({ taskClaim: { taskId: 'claimed-task' } });
    mocks.getTaskIdFromClaim.mockReturnValue('claimed-task');
    mocks.applyTaskResult.mockReturnValue(receipt);

    runSubmitTaskResult({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      claim: 'task-claim.json'
    }, {
      fail: vi.fn(),
      printJson,
      readStructuredFile: vi.fn(() => ({})),
      writeJson: vi.fn()
    });

    expect(printJson).toHaveBeenCalledWith(receipt);
    expect(mocks.applyTaskResult).toHaveBeenCalledWith({}, {}, 'execution-state.json', {
      taskId: 'claimed-task',
      taskStatus: 'completed',
      notes: [],
      artifacts: [],
      errors: []
    });
  });
});