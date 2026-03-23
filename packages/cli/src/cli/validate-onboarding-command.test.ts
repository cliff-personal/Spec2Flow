import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildValidatorResult: vi.fn()
}));

vi.mock('../onboarding/validator-service.js', () => ({
  buildValidatorResult: mocks.buildValidatorResult
}));

import { runValidateOnboarding } from './validate-onboarding-command.js';

describe('validate-onboarding-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails when required paths are missing', () => {
    const fail = vi.fn();

    expect(() => runValidateOnboarding({}, {
      fail,
      printJson: vi.fn(),
      readStructuredFile: vi.fn(),
      setExitCode: vi.fn(),
      writeJson: vi.fn()
    })).toThrow('unreachable');

    expect(fail).toHaveBeenCalledWith('validate-onboarding requires --project, --topology, and --risk');
  });

  it('prints the validator result and sets exit code on failure', () => {
    const printJson = vi.fn();
    const setExitCode = vi.fn();
    const result = {
      validatorResult: {
        status: 'failed',
        checks: []
      }
    };

    mocks.buildValidatorResult.mockReturnValue(result);

    runValidateOnboarding({
      project: 'project.yaml',
      topology: 'topology.yaml',
      risk: 'risk.yaml'
    }, {
      fail: vi.fn(),
      printJson,
      readStructuredFile: vi.fn(() => ({})),
      setExitCode,
      writeJson: vi.fn()
    });

    expect(mocks.buildValidatorResult).toHaveBeenCalledWith({}, {}, {}, {
      project: 'project.yaml',
      topology: 'topology.yaml',
      risk: 'risk.yaml'
    });
    expect(printJson).toHaveBeenCalledWith(result);
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it('writes the validator result when output is requested', () => {
    const writeJson = vi.fn();
    const result = {
      validatorResult: {
        status: 'passed',
        checks: []
      }
    };

    mocks.buildValidatorResult.mockReturnValue(result);

    runValidateOnboarding({
      project: 'project.yaml',
      topology: 'topology.yaml',
      risk: 'risk.yaml',
      output: 'generated/onboarding-validator-result.json'
    }, {
      fail: vi.fn(),
      printJson: vi.fn(),
      readStructuredFile: vi.fn(() => ({})),
      setExitCode: vi.fn(),
      writeJson
    });

    expect(writeJson).toHaveBeenCalledWith('generated/onboarding-validator-result.json', result);
  });
});