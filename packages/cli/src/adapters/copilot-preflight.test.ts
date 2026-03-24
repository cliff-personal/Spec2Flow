import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { execFileSync as execFileSyncType } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCopilotPreflightCachePath,
  defaultCopilotPreflightCacheTtlMs,
  ensureAdapterPreflight,
  resolveCopilotPreflightReport
} from './copilot-preflight.js';
import type { AdapterRuntimeDocument } from '../types/index.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-preflight-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function createRuntimePayload(cwd: string): AdapterRuntimeDocument {
  return {
    adapterRuntime: {
      name: 'github-copilot-cli-adapter',
      provider: 'github-copilot-cli',
      model: 'gpt-5.4',
      command: 'node',
      args: ['adapter.mjs'],
      cwd,
      outputMode: 'stdout'
    }
  };
}

function createExecFileSyncStub(): typeof execFileSyncType {
  return vi.fn((command: string, args: readonly string[]) => {
    if (command !== 'gh') {
      throw new Error(`unexpected command: ${command}`);
    }

    if (args[0] === 'copilot' && args.includes('--help')) {
      return 'usage: gh copilot';
    }

    if (args[0] === 'auth' && args[1] === 'status') {
      return 'Logged in to github.com';
    }

    if (args[0] === 'copilot') {
      return JSON.stringify({
        status: 'completed',
        summary: 'ok',
        notes: [],
        deliverable: {
          cwd: '/tmp/probe'
        },
        errors: []
      });
    }

    throw new Error(`unexpected gh args: ${args.join(' ')}`);
  }) as unknown as typeof execFileSyncType;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('copilot-preflight', () => {
  it('reuses a cached passed preflight report for the same runtime fingerprint', () => {
    const tempDir = createTempDir();
    const adapterRuntimePath = path.join(tempDir, 'adapter-runtime.json');
    const adapterRuntimePayload = createRuntimePayload(tempDir);
    const execFileSync = createExecFileSyncStub();

    const first = resolveCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload, {
      execFileSync,
      now: () => Date.parse('2026-03-24T06:00:00.000Z')
    });
    const second = resolveCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload, {
      execFileSync,
      now: () => Date.parse('2026-03-24T06:05:00.000Z')
    });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(execFileSync).toHaveBeenCalledTimes(3);
    expect(fs.existsSync(buildCopilotPreflightCachePath(adapterRuntimePath, adapterRuntimePayload))).toBe(true);
  });

  it('refreshes the cached preflight report after the cache ttl expires', () => {
    const tempDir = createTempDir();
    const adapterRuntimePath = path.join(tempDir, 'adapter-runtime.json');
    const adapterRuntimePayload = createRuntimePayload(tempDir);
    const execFileSync = createExecFileSyncStub();

    resolveCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload, {
      execFileSync,
      now: () => Date.parse('2026-03-24T06:00:00.000Z')
    });
    const refreshed = resolveCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload, {
      execFileSync,
      now: () => Date.parse('2026-03-24T06:00:00.000Z') + defaultCopilotPreflightCacheTtlMs + 1
    });

    expect(refreshed.cacheHit).toBe(false);
    expect(execFileSync).toHaveBeenCalledTimes(6);
  });

  it('writes the cached report to the requested output path without rerunning the probe', () => {
    const tempDir = createTempDir();
    const adapterRuntimePath = path.join(tempDir, 'adapter-runtime.json');
    const adapterRuntimePayload = createRuntimePayload(tempDir);
    const execFileSync = createExecFileSyncStub();
    const outputPath = path.join(tempDir, 'copilot-preflight.json');

    resolveCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload, {
      execFileSync,
      now: () => Date.parse('2026-03-24T06:00:00.000Z')
    });

    ensureAdapterPreflight({
      'adapter-runtime': adapterRuntimePath,
      'preflight-output': outputPath
    }, adapterRuntimePayload, {
      execFileSync,
      now: () => Date.parse('2026-03-24T06:05:00.000Z')
    });

    expect(execFileSync).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toMatchObject({
      preflight: {
        status: 'passed'
      }
    });
  });
});