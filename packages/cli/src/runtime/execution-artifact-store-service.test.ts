import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createExecutionArtifactStore } from './execution-artifact-store-service.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-artifact-store-'));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('execution-artifact-store-service', () => {
  it('writes and registers artifacts through one store abstraction', () => {
    const tempDir = createTempDir();
    const store = createExecutionArtifactStore(tempDir, {
      mode: 'remote-catalog',
      provider: 'generic-http',
      publicBaseUrl: 'https://artifacts.example.com/spec2flow/',
      keyPrefix: 'frontend-smoke/'
    });

    store.writeJsonArtifact({
      id: 'report',
      path: 'spec2flow/outputs/execution/report.json',
      kind: 'report',
      category: 'other',
      contentType: 'application/json',
      payload: { ok: true }
    });
    store.writeTextArtifact({
      id: 'log',
      path: 'spec2flow/outputs/execution/report.log',
      kind: 'log',
      category: 'verification-command',
      contentType: 'text/plain',
      content: 'ok\n'
    });

    expect(fs.existsSync(path.join(tempDir, 'spec2flow/outputs/execution/report.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'spec2flow/outputs/execution/report.log'))).toBe(true);
    expect(store.listArtifacts()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'report',
        category: 'other',
        storage: expect.objectContaining({
          mode: 'remote-catalog',
          objectKey: 'frontend-smoke/spec2flow/outputs/execution/report.json'
        })
      }),
      expect.objectContaining({ id: 'log', category: 'verification-command' })
    ]));
  });
});
