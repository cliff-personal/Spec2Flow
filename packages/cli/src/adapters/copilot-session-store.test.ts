import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// @ts-ignore plain .mjs helper shared with the example adapter
import * as sessionStore from '../../../../docs/examples/synapse-network/copilot-session-store.mjs';

const {
  applySessionStoreMigration,
  buildSessionRecordPath,
  loadSessionStoreRecords,
  planSessionStoreMigration,
  resolveCopilotSession
} = sessionStore;

const tempDirs: string[] = [];

function createTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-session-store-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeRecord(dir: string, sessionKey: string, sessionId: string, updatedAt: string) {
  const filePath = buildSessionRecordPath(dir, sessionKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({
      sessionKey,
      sessionId,
      createdAt: updatedAt,
      updatedAt
    }, null, 2)}\n`,
    'utf8'
  );
  return filePath;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('copilot session store', () => {
  it('persists stable specialist sessions in auto mode', () => {
    const tempDir = createTempDir();

    const first = resolveCopilotSession({
      sessionKey: 'requirements-agent',
      sessionStoreDir: tempDir,
      persistMode: 'auto'
    });

    const second = resolveCopilotSession({
      sessionKey: 'requirements-agent',
      sessionStoreDir: tempDir,
      persistMode: 'auto'
    });

    expect(first?.persistence).toBe('persistent');
    expect(second?.sessionId).toBe(first?.sessionId);
    expect(fs.existsSync(buildSessionRecordPath(tempDir, 'requirements-agent'))).toBe(true);
  });

  it('treats dynamic keys as ephemeral in auto mode and removes stale legacy records', () => {
    const tempDir = createTempDir();
    const legacyPath = writeRecord(
      tempDir,
      'run-1::schema-contracts::requirements-agent',
      'legacy-session',
      '2026-03-24T05:00:00.000Z'
    );

    const session = resolveCopilotSession({
      sessionKey: 'run-1::schema-contracts::requirements-agent',
      sessionStoreDir: tempDir,
      persistMode: 'auto'
    });

    expect(session?.persistence).toBe('ephemeral');
    expect(session?.sessionId).not.toBe('legacy-session');
    expect(session?.legacyRecordRemoved).toBe(true);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it('migrates run-scoped records into stable specialist keys and deletes legacy files', () => {
    const tempDir = createTempDir();
    writeRecord(tempDir, 'run-a::schema-contracts::requirements-agent', 'session-a', '2026-03-24T04:00:00.000Z');
    writeRecord(tempDir, 'run-b::cli-runtime::requirements-agent', 'session-b', '2026-03-24T05:00:00.000Z');
    writeRecord(tempDir, 'implementation-agent', 'stable-implementation', '2026-03-24T03:00:00.000Z');
    writeRecord(tempDir, 'run-c::schema-contracts::implementation-agent', 'legacy-implementation', '2026-03-24T06:00:00.000Z');

    const plan = planSessionStoreMigration(loadSessionStoreRecords(tempDir), {
      now: '2026-03-24T07:00:00.000Z',
      sessionStoreDir: tempDir
    });
    applySessionStoreMigration(plan);

    const requirementsRecord = JSON.parse(fs.readFileSync(buildSessionRecordPath(tempDir, 'requirements-agent'), 'utf8'));
    const implementationRecord = JSON.parse(fs.readFileSync(buildSessionRecordPath(tempDir, 'implementation-agent'), 'utf8'));

    expect(requirementsRecord.sessionId).toBe('session-b');
    expect(requirementsRecord.migratedFrom).toBe('run-b::cli-runtime::requirements-agent');
    expect(implementationRecord.sessionId).toBe('stable-implementation');
    expect(fs.existsSync(buildSessionRecordPath(tempDir, 'run-a::schema-contracts::requirements-agent'))).toBe(false);
    expect(fs.existsSync(buildSessionRecordPath(tempDir, 'run-b::cli-runtime::requirements-agent'))).toBe(false);
    expect(fs.existsSync(buildSessionRecordPath(tempDir, 'run-c::schema-contracts::implementation-agent'))).toBe(false);
  });
});