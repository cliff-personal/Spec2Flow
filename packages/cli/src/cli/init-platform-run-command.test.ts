import { describe, expect, it, vi } from 'vitest';

import { runInitPlatformRun, type InitPlatformRunDependencies } from './init-platform-run-command.js';
import type { PlatformRunInitializationPlan } from '../platform/platform-repository.js';
import type { TaskGraphDocument } from '../types/index.js';

const taskGraphFixture: TaskGraphDocument = {
  taskGraph: {
    id: 'platform-run-graph',
    workflowName: 'platform-run',
    tasks: []
  }
};

describe('init-platform-run-command', () => {
  it('persists the platform run plan and prints the receipt', async () => {
    const printJson = vi.fn();
    const createPlatformPool = vi.fn(() => ({
      end: vi.fn(async () => undefined)
    })) as unknown as InitPlatformRunDependencies['createPlatformPool'];
    const withPlatformTransaction = vi.fn(async (_pool, callback: (client: { query: () => Promise<{ rows: never[]; rowCount: number; }> }) => Promise<unknown>) =>
      callback({
        query: async () => ({
          rows: [],
          rowCount: 0
        })
      })) as unknown as InitPlatformRunDependencies['withPlatformTransaction'];
    const initializationPlan: PlatformRunInitializationPlan = {
      repository: {
        repositoryId: 'spec2flow',
        name: 'Spec2Flow',
        rootPath: '/repo'
      },
      run: {
        runId: 'run-1',
        repositoryId: 'spec2flow',
        workflowName: 'platform-run',
        status: 'pending',
        currentStage: 'requirements-analysis',
        riskLevel: 'medium'
      },
      tasks: [
        {
          runId: 'run-1',
          taskId: 'task-1',
          stage: 'requirements-analysis',
          title: 'Analyze',
          goal: 'Analyze',
          executorType: 'requirements-agent',
          status: 'ready',
          dependsOn: [],
          targetFiles: [],
          verifyCommands: [],
          inputs: {},
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
          }
        }
      ],
      events: [
        {
          eventId: 'event-1',
          runId: 'run-1',
          eventType: 'run.created',
          payload: {}
        }
      ],
      artifacts: []
    };

    await runInitPlatformRun({
      'database-url': 'postgresql://local/spec2flow',
      'task-graph': 'docs/examples/synapse-network/generated/task-graph.json'
    }, {
      createPlatformPool,
      createPlatformRunInitializationPlan: vi.fn(() => initializationPlan),
      fail: vi.fn(),
      persistPlatformRunPlan: vi.fn(async () => undefined),
      printJson,
      readStructuredFile: vi.fn(() => taskGraphFixture),
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform'
      })),
      withPlatformTransaction,
      writeJson: vi.fn()
    });

    expect(createPlatformPool).toHaveBeenCalled();
    expect(withPlatformTransaction).toHaveBeenCalled();
    expect(printJson).toHaveBeenCalledWith({
      platformRun: {
        schema: 'spec2flow_platform',
        repositoryId: 'spec2flow',
        runId: 'run-1',
        workflowName: 'platform-run',
        taskCount: 1,
        eventCount: 1,
        artifactCount: 0,
        status: 'pending',
        currentStage: 'requirements-analysis'
      }
    });
  });
});
