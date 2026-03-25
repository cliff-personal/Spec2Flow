import { describe, expect, it } from 'vitest';

import { listPlatformProjects, registerPlatformProject } from './platform-project-service.js';
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
      branchPrefix: 'spec2flow/'
    })]);
  });

  it('registers a project by upserting repository and project records', async () => {
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
      repositoryRootPath: '/workspace/Spec2Flow',
      projectName: 'Spec2Flow Local',
      workspaceRootPath: '/workspace/Spec2Flow',
      repositoryName: 'Spec2Flow',
      repositoryId: 'spec2flow',
      defaultBranch: 'main',
      branchPrefix: 'spec2flow/',
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
        workspaceRootPath: '/workspace/Spec2Flow'
      })
    }));
  });
});
