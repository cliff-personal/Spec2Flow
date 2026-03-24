import { describe, expect, it } from 'vitest';

import {
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
            workflow_name: 'platform-flow',
            status: 'running',
            current_stage: 'collaboration',
            risk_level: 'high',
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
      repositoryName: 'Spec2Flow',
      status: 'running'
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
        run: expect.objectContaining({ runId: 'run-1' })
      }),
      platformObservability: expect.objectContaining({
        approvals: expect.arrayContaining([
          expect.objectContaining({ publicationId: 'publication-1' })
        ])
      })
    }));
  });
});