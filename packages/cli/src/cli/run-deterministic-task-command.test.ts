import { describe, expect, it, vi } from 'vitest';
import { runDeterministicTaskCommand } from './run-deterministic-task-command.js';
import type { TaskClaimPayload } from '../types/index.js';

describe('run-deterministic-task-command', () => {
  it('writes deterministic adapter output when requested', async () => {
    const writeJson = vi.fn();
    const printJson = vi.fn();
    const claimPayload: TaskClaimPayload = {
      taskClaim: {
        runId: 'run-1',
        workflowName: 'workflow',
        taskId: 'frontend-smoke--requirements-analysis',
        title: 'Analyze',
        stage: 'requirements-analysis',
        goal: 'Analyze',
        executorType: 'requirements-agent',
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
        },
        repositoryContext: {
          docs: [],
          changedFiles: [],
          targetFiles: [],
          verifyCommands: [],
          taskInputs: {}
        },
        runtimeContext: {
          executionStateRef: 'state.json',
          taskGraphRef: 'task-graph.json',
          currentRunStatus: 'running',
          attempt: 1,
          artifactRefs: [],
          taskArtifacts: [],
          taskErrors: [],
          dependsOn: []
        },
        instructions: []
      }
    };

    await runDeterministicTaskCommand({
      claim: 'claim.json',
      output: 'result.json'
    }, {
      fail: (message) => {
        throw new Error(message);
      },
      printJson,
      readStructuredFile: () => claimPayload,
      writeJson
    });

    expect(writeJson).toHaveBeenCalledWith('result.json', expect.objectContaining({
      adapterRun: expect.objectContaining({
        status: 'blocked'
      })
    }));
    expect(printJson).not.toHaveBeenCalled();
  });
});
