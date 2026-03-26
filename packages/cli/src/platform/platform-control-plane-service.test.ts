import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getPlatformControlPlaneLocalArtifactContent,
  getPlatformControlPlaneTaskArtifactCatalog,
  getPlatformControlPlaneRunDetail,
  listPlatformRuns
} from './platform-control-plane-service.js';
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

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-control-plane-service-'));
}

describe('platform-control-plane-service', () => {
  it('lists recent runs with repository metadata', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".runs AS runs',
        result: {
          rows: [{
            run_id: 'run-1',
            repository_id: 'spec2flow',
            repository_name: 'Spec2Flow',
            repository_root_path: '/workspace/Spec2Flow',
            project_id: 'spec2flow-local',
            project_name: 'Spec2Flow Local',
            workspace_root_path: '/workspace/Spec2Flow',
            workflow_name: 'platform-flow',
            status: 'running',
            metadata: {
              controlPlane: {
                paused: true,
              },
            },
            current_stage: 'collaboration',
            risk_level: 'high',
            branch_name: 'spec2flow/run-1',
            base_branch: 'main',
            worktree_mode: 'managed',
            worktree_path: '/workspace/Spec2Flow/.spec2flow/worktrees/run-1',
            provisioning_status: 'provisioned',
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:05:00.000Z',
            started_at: '2026-03-24T12:00:10.000Z',
            completed_at: null
          }],
          rowCount: 1
        }
      }
    ]);

    const result = await listPlatformRuns(executor, 'spec2flow_platform', {
      limit: 10
    });

    expect(result).toEqual([expect.objectContaining({
      runId: 'run-1',
      projectId: 'spec2flow-local',
      projectName: 'Spec2Flow Local',
      repositoryName: 'Spec2Flow',
      branchName: 'spec2flow/run-1',
      status: 'running',
      paused: true,
    })]);
  });

  it('builds a run detail view from the DB-backed snapshot', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".runs',
        result: {
          rows: [{
            run_id: 'run-1',
            repository_id: 'spec2flow',
            workflow_name: 'platform-flow',
            request_text: 'Ship the control plane backend.',
            status: 'running',
            current_stage: 'collaboration',
            risk_level: 'high',
            request_payload: {},
            metadata: {},
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:05:00.000Z',
            started_at: '2026-03-24T12:00:10.000Z',
            completed_at: null
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            title: 'Publish handoff',
            goal: 'Publish the collaboration handoff',
            executor_type: 'collaboration-agent',
            status: 'blocked',
            risk_level: 'high',
            depends_on: [],
            target_files: [],
            verify_commands: [],
            inputs: {},
            role_profile: {
              profileId: 'collaboration',
              specialistRole: 'collaboration-agent',
              commandPolicy: 'none',
              canReadRepository: true,
              canEditFiles: false,
              canRunCommands: false,
              canWriteArtifacts: true,
              canOpenCollaboration: true,
              requiredAdapterSupports: [],
              expectedArtifacts: ['publication-record']
            },
            review_policy: null,
            artifacts_dir: null,
            attempts: 1,
            retry_count: 0,
            max_retries: 3,
            auto_repair_count: 0,
            max_auto_repair_attempts: 0,
            current_lease_id: null,
            leased_by_worker_id: null,
            lease_expires_at: null,
            last_heartbeat_at: null,
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:05:00.000Z',
            started_at: '2026-03-24T12:00:20.000Z',
            completed_at: null
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".runs AS runs',
        result: {
          rows: [{
            project_id: 'spec2flow-local',
            project_repository_id: 'spec2flow',
            project_name: 'Spec2Flow Local',
            project_repository_root_path: '/workspace/Spec2Flow',
            project_workspace_root_path: '/workspace/Spec2Flow',
            project_path: '/workspace/Spec2Flow/project.json',
            topology_path: '/workspace/Spec2Flow/topology.yaml',
            risk_path: '/workspace/Spec2Flow/risk.yaml',
            project_default_branch: 'main',
            project_branch_prefix: 'spec2flow/',
            project_workspace_policy: {
              allowedReadGlobs: ['**/*'],
              allowedWriteGlobs: ['src/**'],
              forbiddenWriteGlobs: ['.git/**']
            },
            project_metadata: {},
            project_created_at: '2026-03-24T11:59:00.000Z',
            project_updated_at: '2026-03-24T11:59:00.000Z',
            workspace_run_id: 'run-1',
            workspace_repository_id: 'spec2flow',
            worktree_mode: 'managed',
            provisioning_status: 'provisioned',
            branch_name: 'spec2flow/run-1',
            base_branch: 'main',
            workspace_root_path: '/workspace/Spec2Flow',
            worktree_path: '/workspace/Spec2Flow/.spec2flow/worktrees/run-1',
            workspace_policy: {
              allowedReadGlobs: ['**/*'],
              allowedWriteGlobs: ['src/**'],
              forbiddenWriteGlobs: ['.git/**']
            },
            workspace_metadata: {},
            workspace_created_at: '2026-03-24T12:00:00.000Z',
            workspace_updated_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".events',
        result: {
          rows: [{
            event_id: 'event-1',
            run_id: 'run-1',
            task_id: 'frontend-smoke--collaboration',
            event_type: 'approval.requested',
            payload: {
              publicationId: 'publication-1',
              gateReason: 'human-approval-required'
            },
            created_at: '2026-03-24T12:05:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".artifacts',
        result: { rows: [], rowCount: 0 }
      },
      {
        match: 'FROM "spec2flow_platform".repair_attempts',
        result: { rows: [], rowCount: 0 }
      },
      {
        match: 'FROM "spec2flow_platform".publications',
        result: {
          rows: [{
            publication_id: 'publication-1',
            run_id: 'run-1',
            branch_name: null,
            commit_sha: null,
            pr_url: null,
            publish_mode: 'manual-handoff',
            status: 'approval-required',
            metadata: {
              taskId: 'frontend-smoke--collaboration',
              approvalRequired: true,
              gateReason: 'human-approval-required'
            },
            created_at: '2026-03-24T12:04:00.000Z',
            updated_at: '2026-03-24T12:05:00.000Z'
          }],
          rowCount: 1
        }
      }
    ]);

    const result = await getPlatformControlPlaneRunDetail(executor, 'spec2flow_platform', {
      runId: 'run-1',
      eventLimit: 20
    });

    expect(result).toEqual(expect.objectContaining({
      runState: expect.objectContaining({
        run: expect.objectContaining({ runId: 'run-1' }),
        project: expect.objectContaining({ projectId: 'spec2flow-local' }),
        workspace: expect.objectContaining({ branchName: 'spec2flow/run-1' })
      }),
      platformObservability: expect.objectContaining({
        approvals: expect.arrayContaining([
          expect.objectContaining({ publicationId: 'publication-1' })
        ])
      })
    }));
  });

  it('loads an execution artifact catalog for one task', async () => {
    const tempDir = createTempDir();
    const artifactPath = path.join('spec2flow', 'outputs', 'execution', 'frontend-smoke', 'execution-artifact-catalog.json');
    fs.mkdirSync(path.join(tempDir, 'spec2flow', 'outputs', 'execution', 'frontend-smoke'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, artifactPath), JSON.stringify({
      generatedAt: '2026-03-25T01:00:00.000Z',
      taskId: 'frontend-smoke--automated-execution',
      stage: 'automated-execution',
      summary: 'catalog',
      store: {
        mode: 'remote-catalog',
        provider: 'generic-http',
        publicBaseUrl: 'https://artifacts.example.com/spec2flow/',
        keyPrefix: 'frontend-smoke/',
        uploadConfigured: true,
        uploadMethod: 'PUT'
      },
      artifacts: [
        {
          id: 'execution-report',
          path: 'spec2flow/outputs/execution/frontend-smoke/execution-report.json',
          kind: 'report',
          category: 'other',
          upload: {
            status: 'uploaded',
            httpStatus: 201
          },
          storage: {
            mode: 'remote-catalog',
            provider: 'generic-http',
            objectKey: 'frontend-smoke/spec2flow/outputs/execution/frontend-smoke/execution-report.json',
            remoteUrl: 'https://artifacts.example.com/spec2flow/frontend-smoke/spec2flow/outputs/execution/frontend-smoke/execution-report.json'
          }
        }
      ]
    }, null, 2));

    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".runs',
        result: {
          rows: [{
            run_id: 'run-1',
            repository_id: 'spec2flow',
            workflow_name: 'platform-flow',
            request_text: 'Run execution',
            status: 'running',
            current_stage: 'automated-execution',
            risk_level: 'medium',
            request_payload: {},
            metadata: {},
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:05:00.000Z',
            started_at: '2026-03-24T12:00:10.000Z',
            completed_at: null
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'frontend-smoke--automated-execution',
            stage: 'automated-execution',
            title: 'Execute frontend-smoke validation',
            goal: 'Run validation',
            executor_type: 'execution-agent',
            status: 'completed',
            risk_level: 'medium',
            depends_on: [],
            target_files: [],
            verify_commands: [],
            inputs: {},
            role_profile: {
              profileId: 'automated-execution-specialist',
              specialistRole: 'execution-agent',
              commandPolicy: 'verification-only',
              canReadRepository: true,
              canEditFiles: false,
              canRunCommands: true,
              canWriteArtifacts: true,
              canOpenCollaboration: false,
              requiredAdapterSupports: [],
              expectedArtifacts: ['execution-report']
            },
            review_policy: null,
            artifacts_dir: null,
            attempts: 1,
            retry_count: 0,
            max_retries: 3,
            auto_repair_count: 0,
            max_auto_repair_attempts: 0,
            current_lease_id: null,
            leased_by_worker_id: null,
            lease_expires_at: null,
            last_heartbeat_at: null,
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:05:00.000Z',
            started_at: '2026-03-24T12:00:20.000Z',
            completed_at: '2026-03-24T12:05:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".runs AS runs',
        result: { rows: [], rowCount: 0 }
      },
      {
        match: 'FROM "spec2flow_platform".events',
        result: { rows: [], rowCount: 0 }
      },
      {
        match: 'FROM "spec2flow_platform".artifacts',
        result: {
          rows: [{
            artifact_id: 'artifact-1',
            run_id: 'run-1',
            task_id: 'frontend-smoke--automated-execution',
            kind: 'report',
            path: artifactPath,
            schema_type: null,
            metadata: {
              originalArtifactId: 'execution-artifact-catalog'
            },
            created_at: '2026-03-25T01:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".repair_attempts',
        result: { rows: [], rowCount: 0 }
      },
      {
        match: 'FROM "spec2flow_platform".publications',
        result: { rows: [], rowCount: 0 }
      },
      {
        match: 'SELECT repositories.root_path',
        result: {
          rows: [{
            root_path: tempDir
          }],
          rowCount: 1
        }
      }
    ]);

    const result = await getPlatformControlPlaneTaskArtifactCatalog(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'frontend-smoke--automated-execution',
      eventLimit: 20
    });

    expect(result).toEqual(expect.objectContaining({
      runId: 'run-1',
      taskId: 'frontend-smoke--automated-execution',
      artifactId: 'artifact-1',
      catalog: expect.objectContaining({
        stage: 'automated-execution',
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            id: 'execution-report',
            upload: expect.objectContaining({
              status: 'uploaded'
            })
          })
        ])
      })
    }));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves local-fs artifact content by object key', async () => {
    const tempDir = createTempDir();
    const reportPath = path.join('spec2flow', 'outputs', 'execution', 'frontend-smoke', 'execution-report.json');
    const catalogPath = path.join('spec2flow', 'outputs', 'execution', 'frontend-smoke', 'execution-artifact-catalog.json');
    fs.mkdirSync(path.join(tempDir, 'spec2flow', 'outputs', 'execution', 'frontend-smoke'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, reportPath), JSON.stringify({ status: 'ok' }, null, 2));
    fs.writeFileSync(path.join(tempDir, catalogPath), JSON.stringify({
      generatedAt: '2026-03-25T01:00:00.000Z',
      taskId: 'frontend-smoke--automated-execution',
      stage: 'automated-execution',
      summary: 'catalog',
      store: {
        mode: 'local',
        provider: 'local-fs',
        publicBaseUrl: 'http://127.0.0.1:4310/artifacts/',
        keyPrefix: 'frontend-smoke/'
      },
      artifacts: [
        {
          id: 'execution-report',
          path: reportPath,
          kind: 'report',
          category: 'other',
          contentType: 'application/json; charset=utf-8',
          storage: {
            mode: 'local',
            provider: 'local-fs',
            objectKey: 'frontend-smoke/spec2flow/outputs/execution/frontend-smoke/execution-report.json',
            remoteUrl: 'http://127.0.0.1:4310/artifacts/frontend-smoke/spec2flow/outputs/execution/frontend-smoke/execution-report.json'
          }
        }
      ]
    }, null, 2));

    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".artifacts AS artifacts',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'frontend-smoke--automated-execution',
            artifact_id: 'artifact-catalog-1',
            path: catalogPath,
            root_path: tempDir
          }],
          rowCount: 1
        }
      }
    ]);

    const result = await getPlatformControlPlaneLocalArtifactContent(executor, 'spec2flow_platform', {
      objectKey: 'frontend-smoke/spec2flow/outputs/execution/frontend-smoke/execution-report.json'
    });

    expect(result).toEqual({
      objectKey: 'frontend-smoke/spec2flow/outputs/execution/frontend-smoke/execution-report.json',
      artifactId: 'execution-report',
      runId: 'run-1',
      taskId: 'frontend-smoke--automated-execution',
      localPath: path.join(tempDir, reportPath),
      contentType: 'application/json; charset=utf-8'
    });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
