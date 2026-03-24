import { describe, expect, it, vi } from 'vitest';
import {
  claimNextTaskPayload,
  flattenProjectDocRefs,
  getRouteNameFromTaskId
} from './task-claim-service.js';
import type { ExecutionStateDocument } from '../types/execution-state.js';
import type { TaskGraphDocument, TaskRoleProfile } from '../types/task-graph.js';

function createRoleProfile(): TaskRoleProfile {
  return {
    profileId: 'requirements-analysis-specialist',
    specialistRole: 'requirements-agent',
    commandPolicy: 'none',
    canReadRepository: true,
    canEditFiles: false,
    canRunCommands: false,
    canWriteArtifacts: true,
    canOpenCollaboration: false,
    requiredAdapterSupports: ['toolCalling'],
    expectedArtifacts: ['requirements-summary']
  };
}

describe('task-claim-service', () => {
  it('flattens project docs into a deduplicated ordered list', () => {
    expect(
      flattenProjectDocRefs({
        spec2flow: {
          docs: {
            product: ['docs/vision.md', null],
            architecture: ['docs/architecture.md', 'docs/vision.md']
          }
        }
      })
    ).toEqual(['AGENTS.md', '.github/copilot-instructions.md', 'docs/vision.md', 'docs/architecture.md']);
  });

  it('marks the next ready task in progress and returns a structured task claim', () => {
    const executionStatePayload: ExecutionStateDocument = {
      executionState: {
        runId: 'run-1',
        workflowName: 'workflow',
        status: 'pending',
        currentStage: 'environment-preparation',
        provider: {
          adapter: 'spec2flow-cli',
          model: 'gpt-5.4',
          sessionId: 'session-1'
        },
        tasks: [
          {
            taskId: 'provider-registration-flow--requirements-analysis',
            status: 'ready',
            executor: 'requirements-agent',
            attempts: 0,
            artifactRefs: ['task-graph'],
            notes: []
          }
        ],
        artifacts: [
          {
            id: 'requirements-summary',
            kind: 'report',
            path: 'spec2flow/outputs/execution/provider-registration-flow/requirements-summary.json',
            taskId: 'provider-registration-flow--requirements-analysis'
          }
        ],
        errors: []
      }
    };
    const taskGraphPayload: TaskGraphDocument = {
      taskGraph: {
        id: 'workflow',
        workflowName: 'workflow',
        source: {
          requirementRef: 'requirements/provider-registration.md',
          requirementText: 'Implement provider registration with KYC.',
          routeSelectionMode: 'requirement',
          selectedRoutes: ['provider-registration-flow'],
          projectAdapterRef: 'project.yaml',
          topologyRef: 'topology.yaml',
          riskPolicyRef: 'risk.yaml',
          changeSet: ['services/provider-service/app.ts']
        },
        tasks: [
          {
            id: 'provider-registration-flow--requirements-analysis',
            stage: 'requirements-analysis',
            title: 'Analyze provider registration requirements',
            goal: 'Summarize scope',
            executorType: 'requirements-agent',
            roleProfile: createRoleProfile(),
            status: 'ready',
            riskLevel: 'low',
            targetFiles: ['services/provider-service'],
            verifyCommands: ['npm run validate:synapse-example'],
            artifactsDir: 'spec2flow/outputs/execution/provider-registration-flow',
            reviewPolicy: {
              required: false,
              reviewAgentCount: 0,
              requireHumanApproval: false
            }
          }
        ]
      }
    };

    const writeJson = vi.fn();
    const readStructuredFile = vi.fn((filePath: string) => {
      if (filePath === 'state.json') {
        return executionStatePayload;
      }
      if (filePath === 'task-graph.json') {
        return taskGraphPayload;
      }
      throw new Error(`unexpected file: ${filePath}`);
    });
    const loadOptionalStructuredFile = (<T = unknown>(filePath?: string): T | null => {
      if (filePath === 'project.yaml') {
        return {
          spec2flow: {
            docs: {
              product: ['docs/vision.md'],
              architecture: ['docs/architecture.md']
            }
          }
        } as T;
      }
      if (filePath === 'adapter-capability.json') {
        return {
          adapter: {
            name: 'copilot',
            provider: 'github-copilot-cli',
            supports: {
              toolCalling: true
            }
          }
        } as T;
      }
      return null;
    });

    const claimPayload = claimNextTaskPayload(
      'state.json',
      'task-graph.json',
      {
        'adapter-capability': 'adapter-capability.json'
      },
      {
        readStructuredFile,
        loadOptionalStructuredFile,
        writeJson
      }
    );

    expect(claimPayload.taskClaim).not.toBeNull();
    expect(claimPayload.taskClaim?.repositoryContext).toMatchObject({
      requirementRef: 'requirements/provider-registration.md',
      routeSelectionMode: 'requirement',
      selectedRoutes: ['provider-registration-flow'],
      docs: ['AGENTS.md', '.github/copilot-instructions.md', 'docs/vision.md', 'docs/architecture.md'],
      changedFiles: ['services/provider-service/app.ts']
    });
    expect(claimPayload.taskClaim?.runtimeContext.attempt).toBe(1);
    expect(writeJson).toHaveBeenCalledTimes(1);
    expect(executionStatePayload.executionState.tasks[0]?.status).toBe('in-progress');
  });

  it('can resume an in-progress task without rewriting state', () => {
    const executionStatePayload: ExecutionStateDocument = {
      executionState: {
        runId: 'run-1',
        workflowName: 'workflow',
        status: 'running',
        tasks: [
          {
            taskId: 'frontend-smoke--requirements-analysis',
            status: 'in-progress',
            executor: 'requirements-agent',
            attempts: 2,
            artifactRefs: [],
            notes: []
          }
        ],
        artifacts: [],
        errors: []
      }
    };
    const taskGraphPayload: TaskGraphDocument = {
      taskGraph: {
        id: 'workflow',
        workflowName: 'workflow',
        tasks: [
          {
            id: 'frontend-smoke--requirements-analysis',
            stage: 'requirements-analysis',
            title: 'Analyze',
            goal: 'Analyze',
            executorType: 'requirements-agent',
            roleProfile: createRoleProfile(),
            status: 'pending'
          }
        ]
      }
    };
    const writeJson = vi.fn();

    const claimPayload = claimNextTaskPayload(
      'state.json',
      'task-graph.json',
      {
        'allow-resume-in-progress': true
      },
      {
        readStructuredFile: (filePath: string) => filePath === 'state.json' ? executionStatePayload : taskGraphPayload,
        loadOptionalStructuredFile: () => null,
        writeJson
      }
    );

    expect(claimPayload.taskClaim?.taskId).toBe('frontend-smoke--requirements-analysis');
    expect(claimPayload.taskClaim?.runtimeContext.attempt).toBe(2);
    expect(writeJson).not.toHaveBeenCalled();
  });

  it('extracts route names from task ids', () => {
    expect(getRouteNameFromTaskId('frontend-smoke--requirements-analysis')).toBe('frontend-smoke');
    expect(getRouteNameFromTaskId('environment-preparation')).toBe('environment-preparation');
    expect(getRouteNameFromTaskId(null)).toBe('');
  });
});