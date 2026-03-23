import { describe, expect, it } from 'vitest';
import { getSchemaValidators } from './schema-registry.js';

describe('schema-registry', () => {
  it('accepts a valid adapter-run payload', () => {
    const validators = getSchemaValidators();

    const valid = validators.adapterRun({
      adapterRun: {
        adapterName: 'test-adapter',
        provider: 'test-provider',
        taskId: 'frontend-smoke--requirements-analysis',
        runId: 'run-1',
        stage: 'requirements-analysis',
        status: 'completed',
        summary: 'done',
        notes: [],
        activity: {
          commands: [],
          editedFiles: [],
          artifactFiles: ['tmp/requirements-summary.json'],
          collaborationActions: []
        },
        artifacts: [
          {
            id: 'requirements-summary',
            kind: 'report',
            path: 'tmp/requirements-summary.json',
            taskId: 'frontend-smoke--requirements-analysis'
          }
        ],
        errors: []
      }
    });

    expect(valid).toBe(true);
  });

  it('rejects adapter-run payloads that omit required activity', () => {
    const validators = getSchemaValidators();

    const valid = validators.adapterRun({
      adapterRun: {
        adapterName: 'test-adapter',
        provider: 'test-provider',
        taskId: 'frontend-smoke--requirements-analysis',
        runId: 'run-1',
        stage: 'requirements-analysis',
        status: 'completed',
        summary: 'done',
        notes: [],
        artifacts: [],
        errors: []
      }
    });

    expect(valid).toBe(false);
    expect(validators.adapterRun.errors?.some((error) => error.instancePath === '/adapterRun' && error.params.missingProperty === 'activity')).toBe(true);
  });

  it('rejects task-result payloads that omit artifact contracts', () => {
    const validators = getSchemaValidators();

    const valid = validators.taskResult({
      taskResult: {
        taskId: 'frontend-smoke--requirements-analysis',
        status: 'completed',
        executionStateRef: 'execution-state.json',
        notes: [],
        artifacts: [],
        errors: [],
        submittedAt: new Date().toISOString()
      }
    });

    expect(valid).toBe(false);
    expect(validators.taskResult.errors?.some((error) => error.instancePath === '/taskResult' && error.params.missingProperty === 'artifactContract')).toBe(true);
  });
});