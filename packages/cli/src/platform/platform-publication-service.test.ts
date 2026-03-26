import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { reconcilePlatformPublications } from './platform-publication-service.js';
import type { SqlExecutor } from './platform-database.js';

interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

type QueryStep = {
  match: string | RegExp;
  result: QueryResult | ((text: string, values?: readonly unknown[]) => QueryResult | Promise<QueryResult>);
};

class SequentialExecutor implements SqlExecutor {
  public readonly calls: Array<{ text: string; values?: readonly unknown[]; }> = [];

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
      throw new Error(`Query did not match expectation.\nExpected: ${String(step.match)}\nReceived: ${normalizedText}`);
    }

    const result = typeof step.result === 'function'
      ? await step.result(normalizedText, values)
      : step.result;

    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount
    };
  }
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('platform-publication-service', () => {
  it('persists publication records and events from publication artifacts', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-platform-publication-'));
    tempDirs.push(tempDir);
    const publicationRecordPath = path.join(tempDir, 'publication-record.json');
    fs.writeFileSync(publicationRecordPath, `${JSON.stringify({
      publicationId: 'publication-1',
      taskId: 'frontend-smoke--collaboration',
      stage: 'collaboration',
      status: 'published',
      publishMode: 'auto-commit',
      summary: 'Published the collaboration handoff.',
      handoffType: 'pull-request',
      approvalRequired: false,
      autoCommitEnabled: true,
      branchName: 'spec2flow/frontend-smoke-20260324',
      commitSha: 'abc123',
      commitMessage: 'spec2flow: publish frontend-smoke handoff',
      prTitle: 'Frontend smoke collaboration handoff',
      prDraftPath: 'spec2flow/outputs/collaboration/frontend-smoke/pr-draft.md',
      prUrl: 'https://github.com/cliff-personal/Spec2Flow/pull/88',
      mergeStatus: 'requested',
      artifactRefs: ['implementation-summary', 'execution-report'],
      nextActions: ['Open the pull request handoff for review.']
    }, null, 2)}\n`, 'utf8');

    const executor = new SequentialExecutor([
      {
        match: 'INSERT INTO "spec2flow_platform".publications',
        result: { rows: [], rowCount: 1 }
      },
      {
        match: 'INSERT INTO "spec2flow_platform".events',
        result: { rows: [], rowCount: 1 }
      }
    ]);

    const result = await reconcilePlatformPublications(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'frontend-smoke--collaboration',
      artifactBaseDir: tempDir,
      newArtifacts: [
        {
          id: 'publication-record',
          kind: 'report',
          path: publicationRecordPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ]
    });

    expect(result.publicationsInserted).toBe(1);
    expect(result.eventsWritten).toBe(1);
    expect(executor.calls[0]?.values?.[4]).toBe('https://github.com/cliff-personal/Spec2Flow/pull/88');
  });

  it('emits approval-requested events for approval-gated publication records', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-platform-publication-'));
    tempDirs.push(tempDir);
    const publicationRecordPath = path.join(tempDir, 'publication-record.json');
    fs.writeFileSync(publicationRecordPath, `${JSON.stringify({
      publicationId: 'publication-2',
      taskId: 'frontend-smoke--collaboration',
      stage: 'collaboration',
      status: 'approval-required',
      publishMode: 'manual-handoff',
      summary: 'Prepared the collaboration handoff and waiting for approval.',
      handoffType: 'pull-request',
      approvalRequired: true,
      autoCommitEnabled: false,
      gateReason: 'human-approval-required',
      artifactRefs: ['implementation-summary'],
      nextActions: ['Request human approval for the collaboration handoff.']
    }, null, 2)}\n`, 'utf8');

    const executor = new SequentialExecutor([
      {
        match: 'INSERT INTO "spec2flow_platform".publications',
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

    const result = await reconcilePlatformPublications(executor, 'spec2flow_platform', {
      runId: 'run-1',
      taskId: 'frontend-smoke--collaboration',
      artifactBaseDir: tempDir,
      newArtifacts: [
        {
          id: 'publication-record',
          kind: 'report',
          path: publicationRecordPath,
          taskId: 'frontend-smoke--collaboration'
        }
      ]
    });

    expect(result.publicationsInserted).toBe(1);
    expect(result.eventsWritten).toBe(3);
  });
});
