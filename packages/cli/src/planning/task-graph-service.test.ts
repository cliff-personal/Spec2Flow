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
          browserChecks: [
            {
              id: 'frontend-home',
              service: 'frontend',
              path: '/',
              expectText: 'Smoke'
            }
          ],
          executionPolicy: {
            maxDurationSeconds: 180,
            teardownPolicy: 'on-failure',
            teardownTimeoutSeconds: 20
          },
          artifactStore: {
            mode: 'remote-catalog',
            provider: 'generic-http',
            publicBaseUrl: 'https://artifacts.example.com/spec2flow/',
            keyPrefix: 'frontend-smoke/'
          },
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

  it('keeps collaboration executor fixed to collaboration-agent even when human approval is required', () => {
    const taskGraph = buildTaskGraph(
      createProjectPayload(),
      createTopologyPayload(),
      {
        riskPolicy: {
          rules: [
            {
              name: 'provider-high-risk',
              level: 'high',
              match: {
                workflowNames: ['provider-registration-flow']
              },
              requires: {
                humanApproval: true,
                reviewAgents: 1,
                maxAutoRepairAttempts: 2,
                maxExecutionRetries: 4,
                allowAutoCommit: false,
                blockedRiskLevels: ['critical']
              }
            }
          ]
        }
      },
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

    const collaborationTask = taskGraph.taskGraph.tasks.find((task) => task.id === 'provider-registration-flow--collaboration');
    expect(collaborationTask?.executorType).toBe('collaboration-agent');
    expect(collaborationTask?.roleProfile.specialistRole).toBe('collaboration-agent');
    expect(collaborationTask?.reviewPolicy).toMatchObject({
      requireHumanApproval: true,
      required: true,
      maxAutoRepairAttempts: 2,
      maxExecutionRetries: 4,
      blockedRiskLevels: ['critical']
    });
  });

  it('adds execution-time service and browser metadata for frontend routes', () => {
    const taskGraph = buildTaskGraph(
      createProjectPayload(),
      createTopologyPayload(),
      createRiskPayload(),
      {
        project: 'project.yaml',
        topology: 'topology.yaml',
        risk: 'risk.yaml'
      }
    );

    const executionTask = taskGraph.taskGraph.tasks.find((task) => task.id === 'frontend-smoke--automated-execution');
    expect(executionTask?.inputs).toMatchObject({
      routeName: 'frontend-smoke',
      entryServices: ['frontend'],
      browserAutomationRequired: true,
      executionPolicy: {
        maxDurationSeconds: 180,
        teardownPolicy: 'on-failure',
        teardownTimeoutSeconds: 20
      },
      artifactStore: {
        mode: 'remote-catalog',
        provider: 'generic-http',
        publicBaseUrl: 'https://artifacts.example.com/spec2flow/',
        keyPrefix: 'frontend-smoke/'
      },
      browserChecks: [
        expect.objectContaining({
          id: 'frontend-home',
          service: 'frontend',
          path: '/'
        })
      ]
    });
  });
});
