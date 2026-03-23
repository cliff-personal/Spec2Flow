import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claimNextTaskPayload: vi.fn(),
  loadOptionalStructuredFile: vi.fn()
}));

vi.mock('../runtime/task-claim-service.js', () => ({
  claimNextTaskPayload: mocks.claimNextTaskPayload
}));

vi.mock('../shared/fs-utils.js', () => ({
  loadOptionalStructuredFile: mocks.loadOptionalStructuredFile
}));

import { runClaimNextTask } from './claim-next-task-command.js';

describe('claim-next-task-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails when required state paths are missing', () => {
    const fail = vi.fn();

    expect(() => runClaimNextTask({}, {
      fail,
      printJson: vi.fn(),
      readStructuredFile: vi.fn(),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('claim-next-task requires --state and --task-graph');
  });

  it('writes the claimed task payload when output is requested', () => {
    const writeJson = vi.fn();
    const claimPayload = {
      taskClaim: {
        taskId: 'frontend-smoke--requirements-analysis'
      }
    };
    mocks.claimNextTaskPayload.mockReturnValue(claimPayload);

    runClaimNextTask({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      output: 'generated/task-claim.json',
      'adapter-capability': 'adapter-capability.json'
    }, {
      fail: vi.fn(),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(),
      writeJson
    });

    expect(mocks.claimNextTaskPayload).toHaveBeenCalledWith('execution-state.json', 'task-graph.json', {
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      output: 'generated/task-claim.json',
      'adapter-capability': 'adapter-capability.json'
    }, {
      readStructuredFile: expect.any(Function),
      loadOptionalStructuredFile: mocks.loadOptionalStructuredFile,
      writeJson
    });
    expect(writeJson).toHaveBeenCalledWith('generated/task-claim.json', claimPayload);
  });

  it('prints the task claim when no output path is provided', () => {
    const printJson = vi.fn();
    const claimPayload = {
      taskClaim: null,
      message: 'no ready task available for claiming'
    };
    mocks.claimNextTaskPayload.mockReturnValue(claimPayload);

    runClaimNextTask({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json'
    }, {
      fail: vi.fn(),
      printJson,
      readStructuredFile: vi.fn(),
      writeJson: vi.fn()
    });

    expect(printJson).toHaveBeenCalledWith(claimPayload);
  });
});