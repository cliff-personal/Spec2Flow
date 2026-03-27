import process from 'node:process';

import { describe, expect, it, vi } from 'vitest';

import { runRegisterPlatformProject, type RegisterPlatformProjectDependencies } from './register-platform-project-command.js';

describe('register-platform-project-command', () => {
  it('uses the current workspace as the runtime scaffold root', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/workspace/Spec2Flow');
    const registerPlatformProject = vi.fn(async () => ({
      schema: 'spec2flow_platform',
      repository: {
        repositoryId: 'synapse-network',
        repositoryName: 'Synapse-Network',
        repositoryRootPath: '/workspace/Spec2Flow/Synapse-Network',
        defaultBranch: 'main',
      },
      project: {
        projectId: 'synapse-network',
        repositoryId: 'synapse-network',
        name: 'Synapse-Network',
        repositoryRootPath: '/workspace/Spec2Flow/Synapse-Network',
        workspaceRootPath: '/workspace/Spec2Flow/Synapse-Network',
        projectPath: '/workspace/Spec2Flow/Synapse-Network/.spec2flow/project.yaml',
        topologyPath: '/workspace/Spec2Flow/Synapse-Network/.spec2flow/topology.yaml',
        riskPath: '/workspace/Spec2Flow/Synapse-Network/.spec2flow/policies/risk.yaml',
        defaultBranch: 'main',
        branchPrefix: 'spec2flow/',
        adapterProfile: {
          runtimePath: '/workspace/Spec2Flow/.spec2flow/runtime/model-adapter-runtime.json',
          capabilityPath: null,
        },
        workspacePolicy: {
          allowedReadGlobs: ['**/*'],
          allowedWriteGlobs: ['**/*'],
          forbiddenWriteGlobs: [],
        },
        metadata: {
          source: 'spec2flow-control-plane',
        },
      },
    }));
    const printJson = vi.fn();
    const pool = {
      end: vi.fn(async () => undefined),
    };
    const dependencies: RegisterPlatformProjectDependencies = {
      createPlatformPool: vi.fn(() => pool) as unknown as RegisterPlatformProjectDependencies['createPlatformPool'],
      fail: vi.fn(),
      parseCsvOption: vi.fn(() => []),
      printJson,
      registerPlatformProject: registerPlatformProject as RegisterPlatformProjectDependencies['registerPlatformProject'],
      resolvePlatformDatabaseConfig: vi.fn(() => ({
        connectionString: 'postgresql://local/spec2flow',
        schema: 'spec2flow_platform',
      })),
      withPlatformTransaction: vi.fn(async (_pool, callback) => callback({ query: vi.fn() })) as unknown as RegisterPlatformProjectDependencies['withPlatformTransaction'],
      writeJson: vi.fn(),
    };

    try {
      await runRegisterPlatformProject({
        'database-url': 'postgresql://local/spec2flow',
        'repo-root': 'Synapse-Network',
        'project-name': 'Synapse-Network',
      }, dependencies);
    } finally {
      cwdSpy.mockRestore();
    }

    expect(registerPlatformProject).toHaveBeenCalledWith(
      expect.anything(),
      'spec2flow_platform',
      expect.objectContaining({
        repositoryRootPath: '/workspace/Spec2Flow/Synapse-Network',
      }),
      undefined,
      '/workspace/Spec2Flow'
    );
    expect(printJson).toHaveBeenCalled();
  });
});