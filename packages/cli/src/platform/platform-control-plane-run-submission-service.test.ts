import { describe, expect, it, vi } from 'vitest';

import {
  PlatformControlPlaneRunSubmissionError,
  submitPlatformControlPlaneRun,
  type SubmitPlatformControlPlaneRunDependencies
} from './platform-control-plane-run-submission-service.js';
import type { PlatformRunInitializationPlan } from './platform-repository.js';

function buildPlanFixture(): PlatformRunInitializationPlan {
  return {
    repository: {
      repositoryId: 'synapse-network',
      name: 'Synapse-Network',
      rootPath: '/workspace/Synapse-Network',
      defaultBranch: 'main',
      metadata: {
        source: 'spec2flow-cli'
      }
    },
    run: {
      runId: 'web3-sentiment-index-1',
      repositoryId: 'synapse-network',
      workflowName: 'web3-sentiment-index',
      requestText: 'Implement the API doc task',
      status: 'pending',
      currentStage: 'requirements-analysis',
      riskLevel: 'high',
      requestPayload: {},
      metadata: {}
    },
    project: null,
    runWorkspace: null,
    tasks: [],
    events: [],
    artifacts: []
  };
}

describe('platform-control-plane-run-submission-service', () => {
  it('builds and persists a run from onboarding files and request context', async () => {
    const persistPlatformRunPlan = vi.fn(async () => undefined);
    const buildTaskGraph = vi.fn(() => ({
      taskGraph: {
        id: 'graph-1',
        workflowName: 'web3-sentiment-index',
        source: {
          routeSelectionMode: 'requirement',
          selectedRoutes: ['provider-service-api'],
          requirementText: 'Implement the API doc task'
        },
        tasks: []
      }
    }));
    const createPlatformRunInitializationPlan = vi.fn((_taskGraph, options?: { taskGraphRef?: string }) => {
      const plan = buildPlanFixture();
      return {
        ...plan,
        artifacts: options?.taskGraphRef
          ? [{
              artifactId: 'task-graph-artifact',
              runId: plan.run.runId,
              kind: 'report' as const,
              path: options.taskGraphRef,
              schemaType: 'task-graph',
              metadata: {}
            }]
          : []
      };
    });
    const dependencies: SubmitPlatformControlPlaneRunDependencies = {
      buildTaskGraph,
      buildValidatorResult: vi.fn(() => ({
        validatorResult: {
          status: 'passed',
          summary: {
            passed: 3,
            warnings: 0,
            failed: 0
          },
          projectAdapterRef: '.spec2flow/project.yaml',
          topologyRef: '.spec2flow/topology.yaml',
          riskPolicyRef: '.spec2flow/policies/risk.yaml',
          checks: []
        }
      })) as SubmitPlatformControlPlaneRunDependencies['buildValidatorResult'],
      createPlatformRunInitializationPlan,
      persistPlatformRunPlan,
      provisionPlatformRunWorkspace: vi.fn(() => ({
        runId: 'web3-sentiment-index-1',
        projectId: 'synapse-network',
        repositoryId: 'synapse-network',
        worktreeMode: 'managed' as const,
        provisioningStatus: 'provisioned' as const,
        branchName: 'spec2flow/web3-sentiment-index-1',
        baseBranch: 'main',
        workspaceRootPath: '/workspace/Synapse-Network',
        worktreePath: '/workspace/Synapse-Network/.spec2flow/worktrees/web3-sentiment-index-1',
        workspacePolicy: {
          allowedReadGlobs: ['**/*'],
          allowedWriteGlobs: ['**/*'],
          forbiddenWriteGlobs: []
        },
        metadata: {}
      })),
      readRequirementFile: vi.fn(() => 'Implement the API doc task'),
      readStructuredFileFrom: vi.fn((repositoryRoot: string, filePath: string) => ({
        repositoryRoot,
        filePath
      })) as SubmitPlatformControlPlaneRunDependencies['readStructuredFileFrom'],
      writeJson: vi.fn()
    };

    const result = await submitPlatformControlPlaneRun(
      { query: vi.fn() },
      'spec2flow_platform',
      {
        repositoryRootPath: '/workspace/Synapse-Network',
        requirementPath: 'docs/provider_service/api/web3-sentiment-index.md',
        changedFiles: ['./docs/provider_service/api/web3-sentiment-index.md', 'src/index.ts', 'src/index.ts']
      },
      dependencies
    );

    expect(buildTaskGraph).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        project: '.spec2flow/project.yaml',
        topology: '.spec2flow/topology.yaml',
        risk: '.spec2flow/policies/risk.yaml',
        requirement: 'docs/provider_service/api/web3-sentiment-index.md'
      }),
      expect.objectContaining({
        changedFiles: ['docs/provider_service/api/web3-sentiment-index.md', 'src/index.ts'],
        requirementText: 'Implement the API doc task'
      })
    );
    expect(createPlatformRunInitializationPlan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repositoryRoot: '/workspace/Synapse-Network' })
    );
    expect(dependencies.writeJson).toHaveBeenCalledWith(
      '/workspace/Synapse-Network/.spec2flow/worktrees/web3-sentiment-index-1/.spec2flow/runtime/platform-runs/web3-sentiment-index-1/task-graph.json',
      expect.anything()
    );
    expect(persistPlatformRunPlan).toHaveBeenCalled();
    expect(result).toEqual({
      platformRun: {
        schema: 'spec2flow_platform',
        projectId: 'synapse-network',
        projectName: 'Synapse-Network',
        repositoryId: 'synapse-network',
        repositoryName: 'Synapse-Network',
        repositoryRootPath: '/workspace/Synapse-Network',
        workspaceRootPath: '/workspace/Synapse-Network',
        runId: 'web3-sentiment-index-1',
        workflowName: 'web3-sentiment-index',
        taskCount: 0,
        eventCount: 4,
        artifactCount: 1,
        status: 'pending',
        currentStage: null,
        riskLevel: null,
        branchName: 'spec2flow/web3-sentiment-index-1',
        baseBranch: 'main',
        worktreeMode: 'managed',
        worktreePath: '/workspace/Synapse-Network/.spec2flow/worktrees/web3-sentiment-index-1',
        provisioningStatus: 'provisioned'
      },
      taskGraph: {
        graphId: 'graph-1',
        routeSelectionMode: 'requirement',
        selectedRoutes: ['provider-service-api'],
        changedFiles: ['docs/provider_service/api/web3-sentiment-index.md', 'src/index.ts'],
        requirementPath: 'docs/provider_service/api/web3-sentiment-index.md'
      },
      validatorResult: {
        status: 'passed',
        summary: {
          passed: 3,
          warnings: 0,
          failed: 0
        }
      }
    });
  });

  it('rejects requests when onboarding validation fails', async () => {
    await expect(submitPlatformControlPlaneRun(
      { query: vi.fn() },
      'spec2flow_platform',
      {
        repositoryRootPath: '/workspace/Synapse-Network'
      },
      {
        buildTaskGraph: vi.fn(),
        buildValidatorResult: vi.fn(() => ({
          validatorResult: {
            status: 'failed',
            summary: {
              passed: 1,
              warnings: 0,
              failed: 2
            },
            projectAdapterRef: '.spec2flow/project.yaml',
            topologyRef: '.spec2flow/topology.yaml',
            riskPolicyRef: '.spec2flow/policies/risk.yaml',
            checks: []
          }
        })) as SubmitPlatformControlPlaneRunDependencies['buildValidatorResult'],
        createPlatformRunInitializationPlan: vi.fn(),
        persistPlatformRunPlan: vi.fn(async () => undefined),
        provisionPlatformRunWorkspace: vi.fn(() => {
          throw new Error('unreachable');
        }),
        readRequirementFile: vi.fn(() => ''),
        readStructuredFileFrom: vi.fn(() => ({})) as SubmitPlatformControlPlaneRunDependencies['readStructuredFileFrom'],
        writeJson: vi.fn()
      }
    )).rejects.toEqual(expect.objectContaining<Partial<PlatformControlPlaneRunSubmissionError>>({
      code: 'onboarding-validation-failed',
      statusCode: 422
    }));
  });
});
