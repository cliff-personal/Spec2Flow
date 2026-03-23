import { describe, expect, it } from 'vitest';
import { buildTaskGraph } from './task-graph-service.js';

function createProjectPayload() {
  return {
    spec2flow: {
      project: {
        name: 'spec2flow-demo'
      },
      infrastructure: {
        bootstrap: 'npm run bootstrap'
      },
      artifacts: {
        executionDir: 'spec2flow/outputs/execution'
      },
      services: {
        frontend: { path: 'apps/frontend', type: 'frontend' },
        provider_service: { path: 'services/provider-service', type: 'provider' },
        gateway: { path: 'services/gateway', type: 'backend' }
      }
    }
  };
}

function createTopologyPayload() {
  return {
    topology: {
      services: [
        { name: 'frontend', kind: 'frontend' },
        { name: 'provider_service', kind: 'provider' },
        { name: 'gateway', kind: 'backend' }
      ],
      workflowRoutes: [
        {
          name: 'frontend-smoke',
          entryServices: ['frontend'],
          verifyCommands: ['npm run ci:frontend'],
          requirementSignals: {
            phrases: ['frontend smoke'],
            keywords: ['ui', 'frontend']
          }
        },
        {
          name: 'provider-registration-flow',
          entryServices: ['provider_service', 'gateway'],
          verifyCommands: ['npm run ci:provider'],
          requirementSignals: {
            phrases: ['provider registration'],
            keywords: ['provider', 'kyc', 'registration']
          }
        }
      ]
    }
  };
}

function createRiskPayload() {
  return {
    riskPolicy: {
      rules: []
    }
  };
}

describe('task-graph-service route selection', () => {
  it('selects requirement-matched routes and records requirement metadata on tasks', () => {
    const taskGraph = buildTaskGraph(
      createProjectPayload(),
      createTopologyPayload(),
      createRiskPayload(),
      {
        project: 'project.yaml',
        topology: 'topology.yaml',
        risk: 'risk.yaml',
        requirement: 'requirements/provider-registration.md'
      },
      {
        requirementText: 'Add KYC validation to the provider registration workflow handled by gateway and provider services.'
      }
    );

    expect(taskGraph.taskGraph.source?.routeSelectionMode).toBe('requirement');
    expect(taskGraph.taskGraph.source?.selectedRoutes).toEqual(['provider-registration-flow']);

    const requirementsTask = taskGraph.taskGraph.tasks.find((task) => task.id === 'provider-registration-flow--requirements-analysis');
    expect(requirementsTask?.inputs).toMatchObject({
      routeSelectionMode: 'requirement'
    });
    expect((requirementsTask?.inputs?.matchedRequirementKeywords as string[]) ?? []).toEqual(
      expect.arrayContaining(['provider', 'kyc', 'registration'])
    );
  });

  it('selects changed-file routes when no requirement text is provided', () => {
    const taskGraph = buildTaskGraph(
      createProjectPayload(),
      createTopologyPayload(),
      createRiskPayload(),
      {
        project: 'project.yaml',
        topology: 'topology.yaml',
        risk: 'risk.yaml'
      },
      {
        changedFiles: ['apps/frontend/src/app.tsx']
      }
    );

    expect(taskGraph.taskGraph.source?.routeSelectionMode).toBe('changed-files');
    expect(taskGraph.taskGraph.source?.selectedRoutes).toEqual(['frontend-smoke']);
    expect(taskGraph.taskGraph.tasks.map((task) => task.id)).toContain('frontend-smoke--requirements-analysis');
    expect(taskGraph.taskGraph.tasks.map((task) => task.id)).not.toContain('provider-registration-flow--requirements-analysis');
  });
});