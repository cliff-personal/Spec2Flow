import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeTaskRun: vi.fn()
}));

vi.mock('../adapters/adapter-runner.js', () => ({
  executeTaskRun: mocks.executeTaskRun
}));

import { runTaskWithAdapter } from './run-task-with-adapter-command.js';

describe('run-task-with-adapter-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails when required paths are missing', () => {
    const fail = vi.fn();

    expect(() => runTaskWithAdapter({}, {
      ensureAdapterPreflight: vi.fn(),
      fail,
      getRouteNameFromTaskId: vi.fn(),
      parseCsvOption: vi.fn(),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(),
      sanitizeStageName: vi.fn(),
      validateAdapterRuntimePayload: vi.fn(),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('run-task-with-adapter requires --state, --task-graph, --claim, and --adapter-runtime');
  });

  it('validates runtime payload, runs adapter execution, and writes output when requested', () => {
    const adapterRuntimePayload = { adapterRuntime: { command: 'adapter-command' } };
    const claimPayload = { taskClaim: { taskId: 'frontend-smoke--requirements-analysis' } };
    const outputPayload = {
      adapterRun: { status: 'completed' },
      receipt: { taskId: 'frontend-smoke--requirements-analysis', status: 'completed' }
    };
    const ensureAdapterPreflight = vi.fn();
    const validateAdapterRuntimePayload = vi.fn();
    const writeJson = vi.fn();
    const getRouteNameFromTaskId = vi.fn();
    const parseCsvOption = vi.fn();
    const sanitizeStageName = vi.fn();

    mocks.executeTaskRun.mockReturnValue(outputPayload);

    runTaskWithAdapter({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      claim: 'task-claim.json',
      'adapter-runtime': 'adapter-runtime.json',
      output: 'generated/adapter-run.json'
    }, {
      ensureAdapterPreflight,
      fail: vi.fn(),
      getRouteNameFromTaskId,
      parseCsvOption,
      printJson: vi.fn(),
      readStructuredFile: vi.fn((filePath: string) => filePath === 'adapter-runtime.json' ? adapterRuntimePayload : claimPayload),
      sanitizeStageName,
      validateAdapterRuntimePayload,
      writeJson
    });

    expect(validateAdapterRuntimePayload).toHaveBeenCalledWith(adapterRuntimePayload, 'adapter-runtime.json');
    expect(ensureAdapterPreflight).toHaveBeenCalledWith({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      claim: 'task-claim.json',
      'adapter-runtime': 'adapter-runtime.json',
      output: 'generated/adapter-run.json'
    }, adapterRuntimePayload);
    expect(mocks.executeTaskRun).toHaveBeenCalledWith('execution-state.json', 'task-graph.json', claimPayload, {
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      claim: 'task-claim.json',
      'adapter-runtime': 'adapter-runtime.json',
      output: 'generated/adapter-run.json'
    }, {
      validateAdapterRuntimePayload,
      sanitizeStageName,
      getRouteNameFromTaskId,
      parseCsvOption
    });
    expect(writeJson).toHaveBeenCalledWith('generated/adapter-run.json', outputPayload);
  });

  it('prints the adapter run payload when no output path is provided', () => {
    const printJson = vi.fn();
    const adapterRuntimePayload = { adapterRuntime: { command: 'adapter-command', outputMode: 'stdout' } };
    const claimPayload = {
      taskClaim: {
        taskId: 'frontend-smoke--requirements-analysis',
        stage: 'requirements-analysis'
      }
    };
    const outputPayload = {
      adapterRun: { status: 'completed' },
      receipt: { taskId: 'frontend-smoke--requirements-analysis', status: 'completed' }
    };

    mocks.executeTaskRun.mockReturnValue(outputPayload);

    runTaskWithAdapter({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      claim: 'task-claim.json',
      'adapter-runtime': 'adapter-runtime.json'
    }, {
      ensureAdapterPreflight: vi.fn(),
      fail: vi.fn(),
      getRouteNameFromTaskId: vi.fn(),
      parseCsvOption: vi.fn(),
      printJson,
      readStructuredFile: vi.fn((filePath: string) => filePath === 'adapter-runtime.json' ? adapterRuntimePayload : claimPayload),
      sanitizeStageName: vi.fn(),
      validateAdapterRuntimePayload: vi.fn(),
      writeJson: vi.fn()
    });

    expect(printJson).toHaveBeenCalledWith(outputPayload);
  });

  it('preflights the stage-selected runtime when stage runtime refs are configured', () => {
    const rootRuntimePayload = {
      adapterRuntime: {
        command: 'root-command',
        outputMode: 'stdout',
        stageRuntimeRefs: {
          'environment-preparation': './deterministic-runtime.json'
        }
      }
    };
    const deterministicRuntimePayload = {
      adapterRuntime: {
        command: 'deterministic-command',
        provider: 'spec2flow-deterministic',
        outputMode: 'stdout'
      }
    };
    const claimPayload = {
      taskClaim: {
        taskId: 'environment-preparation',
        stage: 'environment-preparation'
      }
    };
    const ensureAdapterPreflight = vi.fn();
    const validateAdapterRuntimePayload = vi.fn();

    mocks.executeTaskRun.mockReturnValue({
      adapterRun: { status: 'completed' },
      receipt: { taskId: 'environment-preparation', status: 'completed' }
    });

    runTaskWithAdapter({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      claim: 'task-claim.json',
      'adapter-runtime': '/tmp/root-runtime.json'
    }, {
      ensureAdapterPreflight,
      fail: vi.fn(),
      getRouteNameFromTaskId: vi.fn(),
      parseCsvOption: vi.fn(),
      printJson: vi.fn(),
      readStructuredFile: vi.fn((filePath: string) => {
        if (filePath === '/tmp/root-runtime.json') {
          return rootRuntimePayload;
        }
        if (filePath === '/tmp/deterministic-runtime.json') {
          return deterministicRuntimePayload;
        }
        return claimPayload;
      }),
      sanitizeStageName: vi.fn(),
      validateAdapterRuntimePayload,
      writeJson: vi.fn()
    });

    expect(validateAdapterRuntimePayload).toHaveBeenNthCalledWith(1, rootRuntimePayload, '/tmp/root-runtime.json');
    expect(validateAdapterRuntimePayload).toHaveBeenNthCalledWith(2, deterministicRuntimePayload, '/tmp/deterministic-runtime.json');
    expect(ensureAdapterPreflight).toHaveBeenCalledWith({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      claim: 'task-claim.json',
      'adapter-runtime': '/tmp/root-runtime.json'
    }, deterministicRuntimePayload);
  });
});