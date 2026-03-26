import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveAutoRunnerAdapterProfile } from './platform-auto-runner-service.js';

describe('platform-auto-runner-service', () => {
  it('prefers the registered project adapter profile over fallback discovery', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-auto-runner-'));
    const runtimePath = path.join(root, 'registered-runtime.json');
    const capabilityPath = path.join(root, 'registered-capability.json');
    const fallbackDir = path.join(root, '.spec2flow');

    fs.writeFileSync(runtimePath, '{}');
    fs.writeFileSync(capabilityPath, '{}');
    fs.mkdirSync(fallbackDir, { recursive: true });
    fs.writeFileSync(path.join(fallbackDir, 'model-adapter-runtime.json'), '{}');

    const result = resolveAutoRunnerAdapterProfile(
      {
        runtimePath,
        capabilityPath
      },
      root,
      root
    );

    expect(result).toEqual({
      runtimePath,
      capabilityPath,
      source: 'project'
    });
  });

  it('falls back to legacy runtime discovery when no project profile is stored', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-auto-runner-'));
    const adapterDir = path.join(root, '.spec2flow');
    const runtimePath = path.join(adapterDir, 'model-adapter-runtime.json');

    fs.mkdirSync(adapterDir, { recursive: true });
    fs.writeFileSync(runtimePath, '{}');

    const result = resolveAutoRunnerAdapterProfile(null, root, root);

    expect(result).toEqual({
      runtimePath,
      capabilityPath: null,
      source: 'fallback'
    });
  });

  it('surfaces invalid registered runtime paths instead of silently falling back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-auto-runner-'));
    const runtimePath = path.join(root, 'missing-runtime.json');

    const result = resolveAutoRunnerAdapterProfile({ runtimePath }, root, root);

    expect(result).toEqual({
      runtimePath,
      capabilityPath: null,
      source: 'invalid-project-runtime'
    });
  });
});