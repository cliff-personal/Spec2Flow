import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  approvePlatformControlPlaneRunPublication,
  forcePublishPlatformControlPlaneRun,
  pausePlatformControlPlaneRun,
  approvePlatformControlPlaneTask,
  resumePlatformControlPlaneRun,
  resumePlatformControlPlaneRunFromTargetStage,
  retryPlatformControlPlaneTask
} from './platform-control-plane-action-service.js';
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
  public readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];

  constructor(private readonly steps: QueryStep[]) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    const normalizedText = text.trim();
    this.calls.push(values ? { text: normalizedText, values } : { text: normalizedText });
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

const tempDirs: string[] = [];
const originalPath = process.env.PATH ?? '';

function createRoleProfile(): Record<string, unknown> {
  return {
    profileId: 'collaboration-profile',
    specialistRole: 'collaboration-agent',
    commandPolicy: 'collaboration-only',
    canReadRepository: true,
    canEditFiles: false,
    canRunCommands: false,
    canWriteArtifacts: true,
    canOpenCollaboration: true,
    requiredAdapterSupports: [],
    expectedArtifacts: ['collaboration-handoff']
  };
}

function initPublicationRepo(): {
  repoRoot: string;
  implementationSummaryPath: string;
  collaborationHandoffPath: string;
} {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-force-publish-'));
  tempDirs.push(repoRoot);
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 1;\n', 'utf8');
  execFileSync('git', ['init'], { cwd: repoRoot, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.email', 'spec2flow@example.com'], { cwd: repoRoot, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Spec2Flow Tests'], { cwd: repoRoot, encoding: 'utf8' });
  execFileSync('git', ['add', 'src/app.ts'], { cwd: repoRoot, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoRoot, encoding: 'utf8' });

  const implementationSummaryPath = path.join(repoRoot, 'spec2flow', 'outputs', 'execution', 'frontend-smoke', 'implementation-summary.json');
  fs.mkdirSync(path.dirname(implementationSummaryPath), { recursive: true });
  fs.writeFileSync(implementationSummaryPath, `${JSON.stringify({
    taskId: 'frontend-smoke--code-implementation',
    stage: 'code-implementation',
    goal: 'Implement change',
    summary: 'Updated the app entrypoint.',
    changedFiles: [{ path: 'src/app.ts', changeType: 'modified' }]
  }, null, 2)}\n`, 'utf8');

  const collaborationHandoffPath = path.join(repoRoot, 'spec2flow', 'outputs', 'execution', 'frontend-smoke', 'collaboration-handoff.json');
  fs.mkdirSync(path.dirname(collaborationHandoffPath), { recursive: true });
  fs.writeFileSync(collaborationHandoffPath, `${JSON.stringify({
    taskId: 'frontend-smoke--collaboration',
    stage: 'collaboration',
    summary: 'Prepare the frontend smoke pull request.',
    handoffType: 'pull-request',
    readiness: 'ready',
    approvalRequired: true,
    artifactRefs: ['implementation-summary', 'execution-report'],
    nextActions: ['Open the pull request handoff for review.'],
    reviewPolicy: {
      required: true,
      reviewAgentCount: 1,
      requireHumanApproval: true
    }
  }, null, 2)}\n`, 'utf8');

  fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 2;\n', 'utf8');

  return {
    repoRoot,
    implementationSummaryPath,
    collaborationHandoffPath
  };
}

function enableRemotePullRequestCommands(repoRoot: string): string {
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-platform-remote-'));
  tempDirs.push(remoteRoot);
  execFileSync('git', ['init', '--bare'], { cwd: remoteRoot, encoding: 'utf8' });
  execFileSync('git', ['remote', 'add', 'origin', remoteRoot], { cwd: repoRoot, encoding: 'utf8' });
  execFileSync('git', ['push', '--set-upstream', 'origin', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });

  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-platform-gh-bin-'));
  tempDirs.push(binDir);
  const ghLogPath = path.join(binDir, 'gh.log');
  const ghPath = path.join(binDir, 'gh');
  const ghScript = [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$GH_LOG_PATH"',
    'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
    '  printf "%s\\n" "$GH_PR_URL"',
    '  exit 0',
    'fi',
    'if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then',
    '  exit 0',
    'fi',
    'exit 1',
    ''
  ].join('\n');
  fs.writeFileSync(ghPath, ghScript, 'utf8');
  fs.chmodSync(ghPath, 0o755);

  process.env.GH_LOG_PATH = ghLogPath;
  process.env.GH_PR_URL = 'https://github.com/cliff-personal/Spec2Flow/pull/654';
  process.env.PATH = `${binDir}:${originalPath}`;
  return ghLogPath;
}

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.GH_LOG_PATH;
  delete process.env.GH_PR_URL;
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('platform-control-plane-action-service', () => {
  it('requeues a blocked task for operator retry', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'task-1',
            stage: 'code-implementation',
            status: 'blocked',
            retry_count: 1,
            max_retries: 3,
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [{
            task_id: 'task-1',
            stage: 'code-implementation',
            status: 'ready',
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await retryPlatformControlPlaneTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'task-1',
      actor: 'operator-1'
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'retry',
      taskStatus: 'ready',
      runStatus: 'running',
      currentStage: 'code-implementation'
    }));
  });

  it('clears stale evaluator reroute fields when retrying an evaluation task', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'frontend-smoke--evaluation',
            stage: 'evaluation',
            status: 'blocked',
            retry_count: 0,
            max_retries: 3,
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [{
            task_id: 'frontend-smoke--evaluation',
            stage: 'evaluation',
            status: 'ready',
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    await retryPlatformControlPlaneTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'frontend-smoke--evaluation',
      actor: 'operator-1'
    });

    expect(executor.calls[1]?.values?.[4]).toBe(true);
    expect(executor.calls[1]?.text).toContain('evaluation_decision = CASE WHEN $5 THEN NULL ELSE evaluation_decision END');
  });

  it('approves a pending publication gate and completes the run', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            status: 'blocked',
            retry_count: 0,
            max_retries: 3,
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".publications',
        result: {
          rows: [{
            publication_id: 'publication-1',
            run_id: 'run-1',
            publish_mode: 'manual-handoff',
            status: 'approval-required',
            metadata: {
              taskId: 'frontend-smoke--collaboration',
              gateReason: 'human-approval-required'
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".publications',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [{
            task_id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            status: 'completed',
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await approvePlatformControlPlaneTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'frontend-smoke--collaboration',
      actor: 'operator-1',
      note: 'approved for manual handoff'
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'approve',
      taskStatus: 'completed',
      runStatus: 'completed',
      currentStage: null,
      publicationId: 'publication-1',
      publicationStatus: 'published'
    }));
  });

  it('rearms the target stage when resuming from the latest evaluator reroute', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'SELECT run_id, status, current_stage, metadata',
        result: {
          rows: [{
            run_id: 'run-1',
            status: 'blocked',
            current_stage: 'evaluation',
            metadata: {
              controlPlane: {
                paused: true
              }
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'SELECT task_id, requested_repair_target_stage',
        result: {
          rows: [{
            task_id: 'frontend-smoke--evaluation',
            requested_repair_target_stage: 'automated-execution'
          }],
          rowCount: 1
        }
      },
      {
        match: 'SELECT task_id, stage',
        result: {
          rows: [
            { task_id: 'frontend-smoke--automated-execution', stage: 'automated-execution' },
            { task_id: 'frontend-smoke--defect-feedback', stage: 'defect-feedback' },
            { task_id: 'frontend-smoke--collaboration', stage: 'collaboration' },
            { task_id: 'frontend-smoke--evaluation', stage: 'evaluation' }
          ],
          rowCount: 4
        }
      },
      {
        match: "SET status = 'ready'",
        result: { rows: [], rowCount: 1 }
      },
      {
        match: "SET status = 'pending'",
        result: { rows: [], rowCount: 3 }
      },
      {
        match: 'SET metadata = $2::jsonb',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [{
            task_id: 'frontend-smoke--automated-execution',
            stage: 'automated-execution',
            status: 'ready',
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'SET status = $2,',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await resumePlatformControlPlaneRunFromTargetStage(executor, 'spec2flow_platform', {
      runId: 'run-1',
      actor: 'operator-1',
      note: 'Resume from queue reroute button'
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'resume-from-target-stage',
      runStatus: 'running',
      currentStage: 'automated-execution',
      paused: false,
      rerouteTargetStage: 'automated-execution'
    }));
    expect(executor.calls[4]?.text).toContain('evaluation_decision = CASE WHEN stage = \'evaluation\' THEN NULL ELSE evaluation_decision END');
  });

  it('keeps the run running when approval unblocks a route but another blocked task has a ready follow-up', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'schema-contracts--collaboration',
            stage: 'collaboration',
            status: 'blocked',
            retry_count: 0,
            max_retries: 3,
            created_at: '2026-03-24T12:03:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".publications',
        result: {
          rows: [{
            publication_id: 'publication-2',
            run_id: 'run-1',
            publish_mode: 'manual-handoff',
            status: 'approval-required',
            metadata: {
              taskId: 'schema-contracts--collaboration',
              gateReason: 'human-approval-required'
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".publications',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [
            {
              task_id: 'cli-runtime--code-implementation',
              stage: 'code-implementation',
              status: 'blocked',
              created_at: '2026-03-24T12:00:00.000Z'
            },
            {
              task_id: 'cli-runtime--defect-feedback',
              stage: 'defect-feedback',
              status: 'ready',
              created_at: '2026-03-24T12:01:00.000Z'
            },
            {
              task_id: 'schema-contracts--collaboration',
              stage: 'collaboration',
              status: 'completed',
              created_at: '2026-03-24T12:03:00.000Z'
            }
          ],
          rowCount: 3
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await approvePlatformControlPlaneTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'schema-contracts--collaboration',
      actor: 'operator-1'
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'approve',
      taskStatus: 'completed',
      runStatus: 'running',
      currentStage: 'defect-feedback',
      publicationId: 'publication-2',
      publicationStatus: 'published'
    }));
  });

  it('completes the run when a previously blocked route has already finished collaboration', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'schema-contracts--collaboration',
            stage: 'collaboration',
            status: 'blocked',
            retry_count: 0,
            max_retries: 3,
            created_at: '2026-03-24T12:03:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'FROM "spec2flow_platform".publications',
        result: {
          rows: [{
            publication_id: 'publication-3',
            run_id: 'run-1',
            publish_mode: 'manual-handoff',
            status: 'approval-required',
            metadata: {
              taskId: 'schema-contracts--collaboration',
              gateReason: 'human-approval-required'
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".publications',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [
            {
              task_id: 'cli-runtime--code-implementation',
              stage: 'code-implementation',
              status: 'blocked',
              created_at: '2026-03-24T12:00:00.000Z'
            },
            {
              task_id: 'cli-runtime--defect-feedback',
              stage: 'defect-feedback',
              status: 'completed',
              created_at: '2026-03-24T12:01:00.000Z'
            },
            {
              task_id: 'cli-runtime--collaboration',
              stage: 'collaboration',
              status: 'completed',
              created_at: '2026-03-24T12:02:00.000Z'
            },
            {
              task_id: 'schema-contracts--collaboration',
              stage: 'collaboration',
              status: 'completed',
              created_at: '2026-03-24T12:03:00.000Z'
            }
          ],
          rowCount: 4
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await approvePlatformControlPlaneTask(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'schema-contracts--collaboration',
      actor: 'operator-1'
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'approve',
      taskStatus: 'completed',
      runStatus: 'completed',
      currentStage: null,
      publicationId: 'publication-3',
      publicationStatus: 'published'
    }));
  });

  it('pauses and resumes a run through metadata-backed control plane state', async () => {
    const executor = new SequentialExecutor([
      {
        match: 'FROM "spec2flow_platform".runs',
        result: {
          rows: [{
            run_id: 'run-1',
            status: 'running',
            current_stage: 'automated-execution',
            metadata: {}
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'FROM "spec2flow_platform".runs',
        result: {
          rows: [{
            run_id: 'run-1',
            status: 'running',
            current_stage: 'automated-execution',
            metadata: {
              controlPlane: {
                paused: true,
                pausedBy: 'operator-1'
              }
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const pauseResult = await pausePlatformControlPlaneRun(executor, 'spec2flow_platform', {
      runId: 'run-1',
      actor: 'operator-1',
      note: 'pause for maintenance'
    });
    const resumeResult = await resumePlatformControlPlaneRun(executor, 'spec2flow_platform', {
      runId: 'run-1',
      actor: 'operator-1',
      note: 'resume after maintenance'
    });

    expect(pauseResult).toEqual({
      action: 'pause',
      runId: 'run-1',
      runStatus: 'running',
      currentStage: 'automated-execution',
      paused: true
    });
    expect(resumeResult).toEqual({
      action: 'resume',
      runId: 'run-1',
      runStatus: 'running',
      currentStage: 'automated-execution',
      paused: false
    });
  });

  it('force-publishes by executing the real publication flow and reconciling a new publication record', async () => {
    const { repoRoot, implementationSummaryPath, collaborationHandoffPath } = initPublicationRepo();
    const executor = new SequentialExecutor([
      {
        match: 'SELECT run_id, status, current_stage, metadata',
        result: {
          rows: [{
            run_id: 'run-1',
            status: 'blocked',
            current_stage: 'collaboration',
            metadata: {}
          }],
          rowCount: 1
        }
      },
      {
        match: /FROM "spec2flow_platform"\.publications[\s\S]*status = ANY/,
        result: {
          rows: [{
            publication_id: 'publication-blocked-1',
            run_id: 'run-1',
            publish_mode: 'manual-handoff',
            status: 'blocked',
            metadata: {
              taskId: 'frontend-smoke--collaboration',
              gateReason: 'human-approval-required'
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".runs',
        result: {
          rows: [{
            run_id: 'run-1',
            repository_id: 'repo-1',
            workflow_name: 'frontend-smoke',
            request_text: 'Publish the collaboration handoff',
            status: 'blocked',
            current_stage: 'collaboration',
            risk_level: 'medium',
            request_payload: {},
            metadata: {},
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:00:00.000Z',
            started_at: '2026-03-24T12:00:00.000Z',
            completed_at: null
          }],
          rowCount: 1
        }
      },
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            title: 'Prepare handoff',
            goal: 'Prepare collaboration publish flow',
            executor_type: 'collaboration-agent',
            status: 'blocked',
            risk_level: 'medium',
            depends_on: [],
            target_files: ['src/app.ts'],
            verify_commands: [],
            inputs: {},
            role_profile: createRoleProfile(),
            review_policy: {
              required: true,
              reviewAgentCount: 1,
              requireHumanApproval: true,
              allowAutoCommit: false
            },
            artifacts_dir: null,
            attempts: 1,
            retry_count: 0,
            max_retries: 3,
            auto_repair_count: 0,
            max_auto_repair_attempts: 0,
            evaluation_decision: null,
            evaluation_summary: null,
            requested_repair_target_stage: null,
            evaluation_findings: [],
            evaluation_next_actions: [],
            current_lease_id: null,
            leased_by_worker_id: null,
            lease_expires_at: null,
            last_heartbeat_at: null,
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:00:00.000Z',
            started_at: '2026-03-24T12:00:00.000Z',
            completed_at: null
          }],
          rowCount: 1
        }
      },
      {
        match: 'LEFT JOIN "spec2flow_platform".run_workspaces',
        result: {
          rows: [{
            project_id: 'project-1',
            project_repository_id: 'repo-1',
            project_name: 'Spec2Flow',
            project_repository_root_path: repoRoot,
            project_workspace_root_path: repoRoot,
            project_path: null,
            topology_path: null,
            risk_path: null,
            project_default_branch: 'main',
            project_branch_prefix: 'spec2flow/',
            project_adapter_profile: null,
            project_workspace_policy: {
              allowedReadGlobs: ['**/*'],
              allowedWriteGlobs: ['**/*'],
              forbiddenWriteGlobs: []
            },
            project_metadata: {},
            project_created_at: '2026-03-24T12:00:00.000Z',
            project_updated_at: '2026-03-24T12:00:00.000Z',
            workspace_run_id: 'run-1',
            workspace_repository_id: 'repo-1',
            worktree_mode: 'managed',
            provisioning_status: 'provisioned',
            branch_name: 'spec2flow/frontend-smoke-run-1',
            base_branch: 'main',
            workspace_root_path: repoRoot,
            worktree_path: repoRoot,
            workspace_policy: {
              allowedReadGlobs: ['**/*'],
              allowedWriteGlobs: ['**/*'],
              forbiddenWriteGlobs: []
            },
            workspace_metadata: {},
            workspace_created_at: '2026-03-24T12:00:00.000Z',
            workspace_updated_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".events',
        result: { rows: [], rowCount: 0 }
      },
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".artifacts',
        result: {
          rows: [
            {
              artifact_id: 'artifact-implementation',
              run_id: 'run-1',
              task_id: 'frontend-smoke--code-implementation',
              kind: 'report',
              path: implementationSummaryPath,
              schema_type: null,
              metadata: { originalArtifactId: 'implementation-summary' },
              created_at: '2026-03-24T12:00:00.000Z'
            },
            {
              artifact_id: 'artifact-handoff',
              run_id: 'run-1',
              task_id: 'frontend-smoke--collaboration',
              kind: 'report',
              path: collaborationHandoffPath,
              schema_type: null,
              metadata: { originalArtifactId: 'collaboration-handoff' },
              created_at: '2026-03-24T12:00:00.000Z'
            }
          ],
          rowCount: 2
        }
      },
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".repair_attempts',
        result: { rows: [], rowCount: 0 }
      },
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".publications',
        result: {
          rows: [{
            publication_id: 'publication-blocked-1',
            run_id: 'run-1',
            branch_name: null,
            commit_sha: null,
            pr_url: null,
            publish_mode: 'manual-handoff',
            status: 'blocked',
            metadata: {
              taskId: 'frontend-smoke--collaboration',
              gateReason: 'human-approval-required'
            },
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".artifacts',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".artifacts',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".publications',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".publications',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'UPDATE "spec2flow_platform".tasks',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [{
            task_id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            status: 'completed',
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      {
        match: 'UPDATE "spec2flow_platform".runs',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await forcePublishPlatformControlPlaneRun(executor, 'spec2flow_platform', {
      runId: 'run-1',
      actor: 'operator-1',
      note: 'force the blocked publication through real execution'
    });

    const publicationInsert = executor.calls.find((call) => call.text.includes('INSERT INTO "spec2flow_platform".publications'));
    const supersedeUpdate = executor.calls.find((call) => call.text.includes('UPDATE "spec2flow_platform".publications'));
    expect(result).toEqual(expect.objectContaining({
      action: 'force-publish',
      runStatus: 'completed',
      currentStage: null,
      paused: false,
      publicationStatus: 'published'
    }));
    expect(result?.publicationId).toBe(publicationInsert?.values?.[0]);
    expect(result?.publicationId).not.toBe('publication-blocked-1');
    const supersededMetadataRaw = supersedeUpdate?.values?.[3];
    const supersededMetadata = typeof supersededMetadataRaw === 'string'
      ? JSON.parse(supersededMetadataRaw) as Record<string, unknown>
      : {};
    expect(supersededMetadata?.supersededByPublicationId).toBe(result?.publicationId);

    const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    expect(currentBranch).toMatch(/^spec2flow\//);
    expect(fs.existsSync(path.join(repoRoot, 'spec2flow', 'outputs', 'collaboration', 'frontend-smoke', 'publication-record.json'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'spec2flow', 'outputs', 'collaboration', 'frontend-smoke', 'pr-draft.md'))).toBe(true);
  });

  it('approves publication by executing real PR creation and merge orchestration', async () => {
    const { repoRoot, implementationSummaryPath, collaborationHandoffPath } = initPublicationRepo();
    const ghLogPath = enableRemotePullRequestCommands(repoRoot);
    const executor = new SequentialExecutor([
      {
        match: 'SELECT run_id, status, current_stage, metadata',
        result: {
          rows: [{
            run_id: 'run-1',
            status: 'blocked',
            current_stage: 'collaboration',
            metadata: {}
          }],
          rowCount: 1
        }
      },
      {
        match: /FROM "spec2flow_platform"\.publications[\s\S]*status = ANY/,
        result: {
          rows: [{
            publication_id: 'publication-approval-1',
            run_id: 'run-1',
            publish_mode: 'manual-handoff',
            status: 'approval-required',
            metadata: {
              taskId: 'frontend-smoke--collaboration',
              gateReason: 'human-approval-required'
            }
          }],
          rowCount: 1
        }
      },
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".runs',
        result: {
          rows: [{
            run_id: 'run-1',
            repository_id: 'repo-1',
            workflow_name: 'frontend-smoke',
            request_text: 'Publish the collaboration handoff',
            status: 'blocked',
            current_stage: 'collaboration',
            risk_level: 'medium',
            request_payload: {},
            metadata: {},
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:00:00.000Z',
            started_at: '2026-03-24T12:00:00.000Z',
            completed_at: null
          }],
          rowCount: 1
        }
      },
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".tasks',
        result: {
          rows: [{
            run_id: 'run-1',
            task_id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            title: 'Prepare handoff',
            goal: 'Prepare collaboration publish flow',
            executor_type: 'collaboration-agent',
            status: 'blocked',
            risk_level: 'medium',
            depends_on: [],
            target_files: ['src/app.ts'],
            verify_commands: [],
            inputs: {},
            role_profile: createRoleProfile(),
            review_policy: {
              required: true,
              reviewAgentCount: 1,
              requireHumanApproval: true,
              allowAutoCommit: false
            },
            artifacts_dir: null,
            attempts: 1,
            retry_count: 0,
            max_retries: 3,
            auto_repair_count: 0,
            max_auto_repair_attempts: 0,
            evaluation_decision: null,
            evaluation_summary: null,
            requested_repair_target_stage: null,
            evaluation_findings: [],
            evaluation_next_actions: [],
            current_lease_id: null,
            leased_by_worker_id: null,
            lease_expires_at: null,
            last_heartbeat_at: null,
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:00:00.000Z',
            started_at: '2026-03-24T12:00:00.000Z',
            completed_at: null
          }],
          rowCount: 1
        }
      },
      {
        match: 'LEFT JOIN "spec2flow_platform".run_workspaces',
        result: {
          rows: [{
            project_id: 'project-1',
            project_repository_id: 'repo-1',
            project_name: 'Spec2Flow',
            project_repository_root_path: repoRoot,
            project_workspace_root_path: repoRoot,
            project_path: null,
            topology_path: null,
            risk_path: null,
            project_default_branch: 'main',
            project_branch_prefix: 'spec2flow/',
            project_adapter_profile: null,
            project_workspace_policy: {
              allowedReadGlobs: ['**/*'],
              allowedWriteGlobs: ['**/*'],
              forbiddenWriteGlobs: []
            },
            project_metadata: {},
            project_created_at: '2026-03-24T12:00:00.000Z',
            project_updated_at: '2026-03-24T12:00:00.000Z',
            workspace_run_id: 'run-1',
            workspace_repository_id: 'repo-1',
            worktree_mode: 'managed',
            provisioning_status: 'provisioned',
            branch_name: 'spec2flow/frontend-smoke-run-1',
            base_branch: 'main',
            workspace_root_path: repoRoot,
            worktree_path: repoRoot,
            workspace_policy: {
              allowedReadGlobs: ['**/*'],
              allowedWriteGlobs: ['**/*'],
              forbiddenWriteGlobs: []
            },
            workspace_metadata: {},
            workspace_created_at: '2026-03-24T12:00:00.000Z',
            workspace_updated_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      { match: 'SELECT *\n      FROM "spec2flow_platform".events', result: { rows: [], rowCount: 0 } },
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".artifacts',
        result: {
          rows: [
            {
              artifact_id: 'artifact-implementation',
              run_id: 'run-1',
              task_id: 'frontend-smoke--code-implementation',
              kind: 'report',
              path: implementationSummaryPath,
              schema_type: null,
              metadata: { originalArtifactId: 'implementation-summary' },
              created_at: '2026-03-24T12:00:00.000Z'
            },
            {
              artifact_id: 'artifact-handoff',
              run_id: 'run-1',
              task_id: 'frontend-smoke--collaboration',
              kind: 'report',
              path: collaborationHandoffPath,
              schema_type: null,
              metadata: { originalArtifactId: 'collaboration-handoff' },
              created_at: '2026-03-24T12:00:00.000Z'
            }
          ],
          rowCount: 2
        }
      },
      { match: 'SELECT *\n      FROM "spec2flow_platform".repair_attempts', result: { rows: [], rowCount: 0 } },
      {
        match: 'SELECT *\n      FROM "spec2flow_platform".publications',
        result: {
          rows: [{
            publication_id: 'publication-approval-1',
            run_id: 'run-1',
            branch_name: null,
            commit_sha: null,
            pr_url: null,
            publish_mode: 'manual-handoff',
            status: 'approval-required',
            metadata: {
              taskId: 'frontend-smoke--collaboration',
              gateReason: 'human-approval-required'
            },
            created_at: '2026-03-24T12:00:00.000Z',
            updated_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      { match: 'INSERT INTO "spec2flow_platform".artifacts', result: { rows: [], rowCount: 1 } },
      { match: 'INSERT INTO "spec2flow_platform".artifacts', result: { rows: [], rowCount: 1 } },
      { match: 'INSERT INTO "spec2flow_platform".publications', result: { rows: [], rowCount: 1 } },
      { match: 'INSERT INTO "spec2flow_platform".events', result: { rows: [], rowCount: 1 } },
      { match: 'UPDATE "spec2flow_platform".publications', result: { rows: [], rowCount: 1 } },
      { match: 'UPDATE "spec2flow_platform".tasks', result: { rows: [], rowCount: 1 } },
      {
        match: 'SELECT task_id, stage, status, created_at',
        result: {
          rows: [{
            task_id: 'frontend-smoke--collaboration',
            stage: 'collaboration',
            status: 'completed',
            created_at: '2026-03-24T12:00:00.000Z'
          }],
          rowCount: 1
        }
      },
      { match: 'UPDATE "spec2flow_platform".runs', result: { rows: [], rowCount: 1 } },
      { match: 'INSERT INTO "spec2flow_platform".events', result: { rows: [], rowCount: 1 } },
      { match: 'INSERT INTO "spec2flow_platform".events', result: { rows: [], rowCount: 1 } }
    ]);

    const result = await approvePlatformControlPlaneRunPublication(executor, 'spec2flow_platform', {
      runId: 'run-1',
      actor: 'operator-1',
      note: 'approve and publish for merge orchestration'
    });

    const publicationInsert = executor.calls.find((call) => call.text.includes('INSERT INTO "spec2flow_platform".publications'));
    const insertedPrUrl = publicationInsert?.values?.[4];
    expect(result).toEqual(expect.objectContaining({
      action: 'approve-publication',
      runStatus: 'completed',
      currentStage: null,
      paused: false,
      publicationStatus: 'published'
    }));
    expect(result?.publicationId).toBe(publicationInsert?.values?.[0]);
    expect(insertedPrUrl).toBe('https://github.com/cliff-personal/Spec2Flow/pull/654');

    const ghLog = fs.readFileSync(ghLogPath, 'utf8');
    expect(ghLog).toContain('pr create');
    expect(ghLog).toContain('pr merge --auto --squash https://github.com/cliff-personal/Spec2Flow/pull/654');
  });
});
