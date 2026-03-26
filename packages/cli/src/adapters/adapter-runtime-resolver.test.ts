import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectAdapterRuntimeVariants, resolveAdapterRuntimeForStage } from './adapter-runtime-resolver.js';
import type { AdapterRuntimeDocument } from '../types/index.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-runtime-resolver-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('adapter-runtime-resolver', () => {
  it('resolves stage runtime refs relative to the root runtime path', () => {
    const tempDir = createTempDir();
    const rootRuntimePath = path.join(tempDir, 'root-runtime.json');
    const deterministicRuntimePath = path.join(tempDir, 'deterministic-runtime.json');
    const rootRuntimePayload: AdapterRuntimeDocument = {
      adapterRuntime: {
        name: 'root-runtime',
        provider: 'github-copilot-cli',
        command: 'root-command',
        outputMode: 'stdout',
        stageRuntimeRefs: {
          'environment-preparation': './deterministic-runtime.json',
          'evaluation': './deterministic-runtime.json'
        }
      }
    };
    const deterministicRuntimePayload: AdapterRuntimeDocument = {
      adapterRuntime: {
        name: 'deterministic-runtime',
        provider: 'spec2flow-deterministic',
        command: 'deterministic-command',
        outputMode: 'stdout'
      }
    };
    const validateAdapterRuntimePayload = vi.fn();

    fs.writeFileSync(rootRuntimePath, `${JSON.stringify(rootRuntimePayload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(deterministicRuntimePath, `${JSON.stringify(deterministicRuntimePayload, null, 2)}\n`, 'utf8');

    const resolvedRuntime = resolveAdapterRuntimeForStage(rootRuntimePath, rootRuntimePayload, 'environment-preparation', {
      readStructuredFile: (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')) as AdapterRuntimeDocument,
      validateAdapterRuntimePayload
    });

    expect(resolvedRuntime.runtimePath).toBe(deterministicRuntimePath);
    expect(resolvedRuntime.runtimePayload).toEqual(deterministicRuntimePayload);
    expect(validateAdapterRuntimePayload).toHaveBeenCalledWith(deterministicRuntimePayload, deterministicRuntimePath);
  });

  it('collects unique runtime variants across stage refs', () => {
    const tempDir = createTempDir();
    const rootRuntimePath = path.join(tempDir, 'root-runtime.json');
    const deterministicRuntimePath = path.join(tempDir, 'deterministic-runtime.json');
    const rootRuntimePayload: AdapterRuntimeDocument = {
      adapterRuntime: {
        name: 'root-runtime',
        provider: 'github-copilot-cli',
        command: 'root-command',
        outputMode: 'stdout',
        stageRuntimeRefs: {
          'environment-preparation': './deterministic-runtime.json',
          'automated-execution': './deterministic-runtime.json',
          'evaluation': './deterministic-runtime.json'
        }
      }
    };
    const deterministicRuntimePayload: AdapterRuntimeDocument = {
      adapterRuntime: {
        name: 'deterministic-runtime',
        provider: 'spec2flow-deterministic',
        command: 'deterministic-command',
        outputMode: 'stdout'
      }
    };
    const validateAdapterRuntimePayload = vi.fn();

    fs.writeFileSync(rootRuntimePath, `${JSON.stringify(rootRuntimePayload, null, 2)}\n`, 'utf8');
    fs.writeFileSync(deterministicRuntimePath, `${JSON.stringify(deterministicRuntimePayload, null, 2)}\n`, 'utf8');

    const variants = collectAdapterRuntimeVariants(rootRuntimePath, rootRuntimePayload, {
      readStructuredFile: (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')) as AdapterRuntimeDocument,
      validateAdapterRuntimePayload
    });

    expect(variants.map((variant) => variant.runtimePath)).toEqual([
      rootRuntimePath,
      deterministicRuntimePath
    ]);
    expect(validateAdapterRuntimePayload).toHaveBeenCalledTimes(1);
  });
});