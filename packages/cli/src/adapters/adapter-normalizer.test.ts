import { describe, expect, it } from 'vitest';

import { buildAdapterTemplateContext } from './adapter-normalizer.js';
import type { TaskClaimPayload } from '../types/task-claim.js';

function createClaimPayload(): TaskClaimPayload {
  return {
    taskClaim: {
      runId: 'run-1',
      workflowName: 'workflow',
      taskId: 'schema-contracts--requirements-analysis',
      title: 'Analyze requirements',
      stage: 'requirements-analysis',
      goal: 'Summarize the claimed route',
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
        executionStateRef: 'execution-state.json',
        taskGraphRef: 'task-graph.json',
        currentRunStatus: 'running',
        provider: {
          adapter: 'github-copilot-cli',
          sessionId: 'workflow-session'
        },
        attempt: 1,
        artifactRefs: [],
        taskArtifacts: [],
        taskErrors: [],
        dependsOn: []
      },
      instructions: []
    }
  };
}

describe('adapter-normalizer', () => {
  it('builds a stable specialist session key that does not depend on the run namespace', () => {
    const context = buildAdapterTemplateContext(
      createClaimPayload(),
      'execution-state.json',
      'task-graph.json',
      {
        getRouteNameFromTaskId: (taskId: string) => taskId.split('--')[0] ?? ''
      }
    );

    expect(context.specialistSessionId).toBe('requirements-agent');
    expect(context.specialistSessionKey).toBe('requirements-agent');
    expect(context.executorSessionKey).toBe('workflow-session::requirements-agent');
    expect(context.routeExecutorSessionKey).toBe('workflow-session::schema-contracts::requirements-agent');
  });
});