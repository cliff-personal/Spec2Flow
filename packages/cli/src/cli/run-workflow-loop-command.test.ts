import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadOptionalStructuredFile: vi.fn(),
  claimNextTaskPayload: vi.fn(),
  executeTaskRun: vi.fn(),
  runWorkflowLoopWithExecutor: vi.fn()
}));

vi.mock('../shared/fs-utils.js', () => ({
  loadOptionalStructuredFile: mocks.loadOptionalStructuredFile
}));

vi.mock('../runtime/task-claim-service.js', () => ({
  claimNextTaskPayload: mocks.claimNextTaskPayload
}));

vi.mock('../adapters/adapter-runner.js', () => ({
  executeTaskRun: mocks.executeTaskRun
}));

vi.mock('../runtime/workflow-loop-service.js', () => ({
  runWorkflowLoopWithExecutor: mocks.runWorkflowLoopWithExecutor
}));

import { runWorkflowLoop } from './run-workflow-loop-command.js';

describe('run-workflow-loop-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the workflow loop summary when output is requested', () => {
    const summary = {
      workflowLoop: {
        runId: 'run-1',
        workflowName: 'demo',
        maxSteps: 2,
        stepsExecuted: 1,
        stopReason: 'completed',
        claimedTaskIds: ['task-1'],
        receipts: []
      }
    };
    const writeJson = vi.fn();

    mocks.runWorkflowLoopWithExecutor.mockReturnValue(summary);

    runWorkflowLoop({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json',
      output: 'generated/workflow-loop-summary.json'
    }, {
      ensureAdapterPreflight: vi.fn(),
      fail: vi.fn(),
      getRouteNameFromTaskId: vi.fn(),
      parseCsvOption: vi.fn(),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(),
      sanitizeStageName: vi.fn(),
      validateAdapterRuntimePayload: vi.fn(),
      writeJson
    });

    expect(writeJson).toHaveBeenCalledWith('generated/workflow-loop-summary.json', summary);
  });

  it('passes claim and execute wiring into the workflow loop service', () => {
    const ensureAdapterPreflight = vi.fn();
    const fail = vi.fn();
    const getRouteNameFromTaskId = vi.fn();
    const parseCsvOption = vi.fn();
    const printJson = vi.fn();
    const readStructuredFile = vi.fn();
    const sanitizeStageName = vi.fn();
    const validateAdapterRuntimePayload = vi.fn();
    const writeJson = vi.fn();
    const claimPayload = { taskClaim: { taskId: 'task-1' } };
    const executeResult = {
      adapterRun: { status: 'completed' },
      receipt: { taskId: 'task-1', status: 'completed' },
      mode: 'adapter'
    };

    mocks.claimNextTaskPayload.mockReturnValue(claimPayload);
    mocks.executeTaskRun.mockReturnValue(executeResult);
    mocks.runWorkflowLoopWithExecutor.mockImplementation((options, deps) => {
      const claimed = deps.claimNextTaskPayload('execution-state.json', 'task-graph.json', { output: 'ignored.json' });
      deps.executeTaskRun('execution-state.json', 'task-graph.json', claimed, { claim: 'task-claim.json' });
      return {
        workflowLoop: {
          runId: 'run-1',
          workflowName: 'demo',
          maxSteps: 1,
          stepsExecuted: 1,
          stopReason: 'completed',
          claimedTaskIds: ['task-1'],
          receipts: []
        }
      };
    });

    runWorkflowLoop({
      state: 'execution-state.json',
      'task-graph': 'task-graph.json'
    }, {
      ensureAdapterPreflight,
      fail,
      getRouteNameFromTaskId,
      parseCsvOption,
      printJson,
      readStructuredFile,
      sanitizeStageName,
      validateAdapterRuntimePayload,
      writeJson
    });

    expect(mocks.runWorkflowLoopWithExecutor).toHaveBeenCalled();
    expect(mocks.claimNextTaskPayload).toHaveBeenCalledWith('execution-state.json', 'task-graph.json', { output: 'ignored.json' }, {
      readStructuredFile,
      loadOptionalStructuredFile: mocks.loadOptionalStructuredFile,
      writeJson
    });
    expect(mocks.executeTaskRun).toHaveBeenCalledWith('execution-state.json', 'task-graph.json', claimPayload, { claim: 'task-claim.json' }, {
      validateAdapterRuntimePayload,
      sanitizeStageName,
      getRouteNameFromTaskId,
      parseCsvOption
    });
    expect(printJson).toHaveBeenCalledWith({
      workflowLoop: {
        runId: 'run-1',
        workflowName: 'demo',
        maxSteps: 1,
        stepsExecuted: 1,
        stopReason: 'completed',
        claimedTaskIds: ['task-1'],
        receipts: []
      }
    });
    expect(fail).not.toHaveBeenCalled();
    expect(ensureAdapterPreflight).not.toHaveBeenCalled();
  });
});