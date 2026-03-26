import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { listPlatformProjects, registerPlatformProject, updatePlatformProjectAdapterProfile } from './platform-project-service.js';
import type { SqlExecutor } from './platform-database.js';

interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

type QueryStep = {
  match: string | RegExp;
  result: QueryResult;
};

class SequentialExecutor implements SqlExecutor {
  constructor(private readonly steps: QueryStep[]) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string): Promise<QueryResult<Row>> {
    const normalizedText = text.trim();
    const step = this.steps.shift();
    if (!step) {
      throw new Error(`Unexpected query: ${normalizedText}`);
    }

    const matched = typeof step.match === 'string'
      ? normalizedText.includes(step.match)
      : step.match.test(normalizedText);
    if (!matched) {
      throw new Error(`Query did not match expectation. Expected ${String(step.match)} but received ${normalizedText}`);
    }

    return {
      rows: step.result.rows as Row[],
      rowCount: step.result.rowCount
    };
  }
}

describe('platform-project-service', () => {
  it('lists registered projects with repository metadata', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".projects AS projects',
        result: {
          rows: [{
            project_id: 'spec2flow-local',
            project_name: 'Spec2Flow Local',
            repository_id: 'spec2flow',
            repository_name: 'Spec2Flow',
            repository_root_path: '/workspace/Spec2Flow',
            workspace_root_path: '/workspace/Spec2Flow',
            project_path: '/workspace/Spec2Flow/project.json',
            topology_path: '/workspace/Spec2Flow/topology.yaml',
            risk_path: '/workspace/Spec2Flow/risk.yaml',
            default_branch: 'main',
            branch_prefix: 'spec2flow/',
            adapter_profile: {
              runtimePath: '/workspace/Spec2Flow/.spec2flow/model-adapter-runtime.json',
              capabilityPath: '/workspace/Spec2Flow/.spec2flow/model-adapter-capability.json'
            },
            workspace_policy: {
              allowedReadGlobs: ['**/*'],
              allowedWriteGlobs: ['src/**'],
              forbiddenWriteGlobs: ['.git/**']
            },
            created_at: '2026-03-25T02:00:00.000Z',
            updated_at: '2026-03-25T02:10:00.000Z'
          }],
          rowCount: 1
        }
      }
    ]);

    const result = await listPlatformProjects(executor, 'spec2flow_platform');

    expect(result).toEqual([expect.objectContaining({
      projectId: 'spec2flow-local',
      repositoryName: 'Spec2Flow',
      branchPrefix: 'spec2flow/',
      adapterProfile: {
        runtimePath: '/workspace/Spec2Flow/.spec2flow/model-adapter-runtime.json',
        capabilityPath: '/workspace/Spec2Flow/.spec2flow/model-adapter-capability.json'
      }
    })]);
  });

  it('registers a project by upserting repository and project records', async () => {
    const repositoryRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-project-'));
    const adapterDir = path.join(repositoryRootPath, '.spec2flow');

    fs.mkdirSync(adapterDir, { recursive: true });
    fs.writeFileSync(path.join(adapterDir, 'model-adapter-runtime.json'), JSON.stringify({
      adapterRuntime: {
        name: 'github-copilot',
        provider: 'github',
        command: 'copilot',
        outputMode: 'stdout'
      }
    }));
    fs.writeFileSync(path.join(adapterDir, 'model-adapter-capability.json'), JSON.stringify({
      adapter: {
        name: 'github-copilot',
        provider: 'github',
        supports: {
          toolCalling: true,
          jsonMode: true,
          multiAgentDispatch: true,
          codeEditing: true
        },
        limits: {
          maxContextTokens: 128000
        }
      }
    }));

    const executor = new SequentialExecutor([
      {
        match: 'INSERT INTO "spec2flow_platform".repositories',
        result: {
          rows: [],
          rowCount: 1
        }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".projects',
        result: {
          rows: [],
          rowCount: 1
        }
      }
    ]);

    const result = await registerPlatformProject(executor, 'spec2flow_platform', {
      repositoryRootPath,
      projectName: 'Spec2Flow Local',
      workspaceRootPath: repositoryRootPath,
      repositoryName: 'Spec2Flow',
      repositoryId: 'spec2flow',
      defaultBranch: 'main',
      branchPrefix: 'spec2flow/',
      adapterProfile: {
        runtimePath: '.spec2flow/model-adapter-runtime.json',
        capabilityPath: '.spec2flow/model-adapter-capability.json'
      },
      workspacePolicy: {
        allowedReadGlobs: ['**/*'],
        allowedWriteGlobs: ['src/**'],
        forbiddenWriteGlobs: ['.git/**']
      }
    });

    expect(result).toEqual(expect.objectContaining({
      schema: 'spec2flow_platform',
      project: expect.objectContaining({
        projectId: 'spec2flow-local',
        repositoryId: 'spec2flow',
        workspaceRootPath: repositoryRootPath,
        adapterProfile: {
          runtimePath: path.join(repositoryRootPath, '.spec2flow', 'model-adapter-runtime.json'),
          capabilityPath: path.join(repositoryRootPath, '.spec2flow', 'model-adapter-capability.json')
        }
      })
    }));
  });

  it('clears a project adapter profile without changing other project fields', async () => {
    const executor = new SequentialExecutor([
      {
        match: /WHERE projects\.project_id = \$1/u,
        result: {
          rows: [{
            project_id: 'spec2flow-local',
            project_name: 'Spec2Flow Local',
            repository_id: 'spec2flow',
            repository_name: 'Spec2Flow',
            repository_root_path: '/workspace/Spec2Flow',
            workspace_root_path: '/workspace/Spec2Flow',
            project_path: '/workspace/Spec2Flow/project.json',
            topology_path: '/workspace/Spec2Flow/topology.yaml',
            risk_path: '/workspace/Spec2Flow/risk.yaml',
            default_branch: 'main',
            branch_prefix: 'spec2flow/',
            adapter_profile: {
              runtimePath: '/workspace/Spec2Flow/.spec2flow/model-adapter-runtime.json'
            },
            workspace_policy: {
              allowedReadGlobs: ['**/*'],
              allowedWriteGlobs: ['src/**'],
              forbiddenWriteGlobs: ['.git/**']
            },
            metadata: {
              source: 'spec2flow-control-plane'
            },
            created_at: '2026-03-25T02:00:00.000Z',
            updated_at: '2026-03-25T02:10:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".projects',
        result: {
          rows: [],
          rowCount: 1
        }
      }
    ]);

    const result = await updatePlatformProjectAdapterProfile(
      executor,
      'spec2flow_platform',
      'spec2flow-local',
      { adapterProfile: null }
    );

    expect(result).toEqual({
      schema: 'spec2flow_platform',
      project: expect.objectContaining({
        projectId: 'spec2flow-local',
        adapterProfile: null,
        branchPrefix: 'spec2flow/'
      })
    });
  });
});
