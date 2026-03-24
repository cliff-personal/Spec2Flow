import { describe, expect, it } from 'vitest';

import { createPlatformRunInitializationPlan } from './platform-repository.js';
import type { TaskGraphDocument } from '../types/index.js';

function buildTaskGraphFixture(): TaskGraphDocument {
  return {
    taskGraph: {
      id: 'platform-graph',
      workflowName: 'platform-workflow',
      source: {
        requirementText: 'Add PostgreSQL-backed runtime truth.',
        selectedRoutes: ['platform-runtime']
      },
      tasks: [
        {
          id: 'platform-runtime--requirements-analysis',
          stage: 'requirements-analysis',
          title: 'Analyze platform runtime requirements',
          goal: 'Summarize the runtime storage scope',
          executorType: 'requirements-agent',
          roleProfile: {
            profileId: 'requirements-agent',
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
          status: 'ready',
          riskLevel: 'medium'
        },
        {
          id: 'platform-runtime--code-implementation',
          stage: 'code-implementation',
          title: 'Implement platform runtime persistence',
          goal: 'Add persistence modules',
          executorType: 'implementation-agent',
          roleProfile: {
            profileId: 'implementation-agent',
            specialistRole: 'implementation-agent',
            commandPolicy: 'safe-repo-commands',
            canReadRepository: true,
            canEditFiles: true,
            canRunCommands: true,
            canWriteArtifacts: true,
            canOpenCollaboration: false,
            requiredAdapterSupports: [],
            expectedArtifacts: ['implementation-summary']
          },
          status: 'pending',
          riskLevel: 'high',
          dependsOn: ['platform-runtime--requirements-analysis'],
          targetFiles: ['packages/cli/src/platform/platform-repository.ts']
        }
      ]
    }
  };
}

describe('platform-repository', () => {
  it('builds a DB-backed run initialization plan from a task graph', () => {
    const plan = createPlatformRunInitializationPlan(buildTaskGraphFixture(), {
      repositoryRoot: '/workspace/Spec2Flow',
      repositoryName: 'Spec2Flow',
      defaultBranch: 'main',
      taskGraphRef: '/workspace/Spec2Flow/.spec2flow/task-graph.json'
    });

    expect(plan.repository.repositoryId).toBe('spec2flow');
    expect(plan.run.workflowName).toBe('platform-workflow');
    expect(plan.run.currentStage).toBe('requirements-analysis');
    expect(plan.run.riskLevel).toBe('high');
    expect(plan.tasks).toHaveLength(2);
    expect(plan.events.map((event) => event.eventType)).toEqual([
      'run.created',
      'planning.completed',
      'tasks.persisted',
      'artifact.attached'
    ]);
    expect(plan.artifacts[0]?.schemaType).toBe('task-graph');
  });
});
