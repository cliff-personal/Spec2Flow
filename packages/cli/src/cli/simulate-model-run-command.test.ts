import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeTaskRun: vi.fn()
}));

vi.mock('../adapters/adapter-runner.js', () => ({
  executeTaskRun: mocks.executeTaskRun
}));

import { runSimulateModelRun } from './simulate-model-run-command.js';

describe('simulate-model-run-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails when required paths are missing', () => {
    const fail = vi.fn();

    expect(() => runSimulateModelRun({}, {
      fail,
      getRouteNameFromTaskId: vi.fn(),
      parseCsvOption: vi.fn(),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(),
      sanitizeStageName: vi.fn(),
      validateAdapterRuntimePayload: vi.fn(),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('simulate-model-run requires --state, --task-graph, and --claim');
  });

  it('writes the simulated run payload when output is requested', () => {
    const claimPayload = { taskClaim: { taskId: 'frontend-smoke--requirements-analysis' } };
    const result = {
      adapterRun: { status: 'completed' },
      receipt: { taskId: 'frontend-smoke--requirements-analysis', status: 'completed' }
    };
    const writeJson = vi.fn();
    const validateAdapterRuntimePayload = vi.fn();
    const sanitizeStageName = vi.fn();
    const getRouteNameFromTaskId = vi.fn();
    const parseCsvOption = vi.fn();

    mocks.executeTaskRun.mockReturnValue(result);

    runSimulateModelRun({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      claim: 'task-claim.json',
      output: 'generated/simulated-model-run.json'
    }, {
      fail: vi.fn(),
      getRouteNameFromTaskId,
      parseCsvOption,
      printJson: vi.fn(),
      readStructuredFile: vi.fn(() => claimPayload),
      sanitizeStageName,
      validateAdapterRuntimePayload,
      writeJson
    });

    expect(mocks.executeTaskRun).toHaveBeenCalledWith('execution-state.json', 'task-graph.json', claimPayload, {
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      claim: 'task-claim.json',
      output: 'generated/simulated-model-run.json'
    }, {
      validateAdapterRuntimePayload,
      sanitizeStageName,
      getRouteNameFromTaskId,
      parseCsvOption
    });
    expect(writeJson).toHaveBeenCalledWith('generated/simulated-model-run.json', {
      simulatedRun: result.adapterRun,
      receipt: result.receipt
    });
  });

  it('prints the simulated run payload when no output path is provided', () => {
    const printJson = vi.fn();
    const result = {
      adapterRun: { status: 'completed' },
      receipt: { taskId: 'frontend-smoke--requirements-analysis', status: 'completed' }
    };

    mocks.executeTaskRun.mockReturnValue(result);

    runSimulateModelRun({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      claim: 'task-claim.json'
    }, {
      fail: vi.fn(),
      getRouteNameFromTaskId: vi.fn(),
      parseCsvOption: vi.fn(),
      printJson,
      readStructuredFile: vi.fn(() => ({})),
      sanitizeStageName: vi.fn(),
      validateAdapterRuntimePayload: vi.fn(),
      writeJson: vi.fn()
    });

    expect(printJson).toHaveBeenCalledWith({
      simulatedRun: result.adapterRun,
      receipt: result.receipt
    });
  });
});