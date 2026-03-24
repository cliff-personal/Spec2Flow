import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateSchemaBackedArtifacts } from './stage-deliverable-validation.js';
import type { ArtifactRef } from '../types/execution-state.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-stage-deliverable-validation-'));
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

describe('stage-deliverable-validation', () => {
  it('validates generated deliverable filenames that prefix the schema-backed artifact id', () => {
    const tempDir = createTempDir();
    const artifactPath = path.join(tempDir, 'requirements-summary.schema-contracts--requirements-analysis.json');

    fs.writeFileSync(artifactPath, `${JSON.stringify({
      taskId: 'schema-contracts--requirements-analysis',
      stage: 'requirements-analysis',
      goal: 'Summarize schema contract scope',
      summary: 'The requirements payload is schema-valid.',
      sources: ['docs/architecture.md']
    }, null, 2)}\n`, 'utf8');

    expect(() => validateSchemaBackedArtifacts([
      {
        id: 'analysis-output',
        kind: 'report',
        path: artifactPath,
        taskId: 'schema-contracts--requirements-analysis'
      }
    ])).not.toThrow();
  });

  it('ignores unrelated artifacts whose directories happen to mention a schema-backed artifact id', () => {
    const tempDir = createTempDir();
    const nestedDir = path.join(tempDir, 'notes-about-requirements-summary');
    const artifactPath = path.join(nestedDir, 'analysis-output.json');

    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify({ note: 'not a stage deliverable' }, null, 2)}\n`, 'utf8');

    expect(() => validateSchemaBackedArtifacts([
      {
        id: 'analysis-output',
        kind: 'report',
        path: artifactPath,
        taskId: 'schema-contracts--requirements-analysis'
      }
    ])).not.toThrow();
  });

  it('validates relative artifact paths against an explicit repository base directory', () => {
    const tempDir = createTempDir();
    const repoRoot = path.join(tempDir, 'repo');
    const artifactPath = path.join(repoRoot, 'spec2flow', 'outputs', 'execution', 'frontend-smoke', 'requirements-summary.json');

    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify({
      taskId: 'frontend-smoke--requirements-analysis',
      stage: 'requirements-analysis',
      goal: 'Summarize the frontend smoke requirement',
      summary: 'The artifact is resolved from the repository root, not process cwd.',
      sources: ['docs/architecture.md']
    }, null, 2)}\n`, 'utf8');

    expect(() => validateSchemaBackedArtifacts([
      {
        id: 'requirements-summary',
        kind: 'report',
        path: 'spec2flow/outputs/execution/frontend-smoke/requirements-summary.json',
        taskId: 'frontend-smoke--requirements-analysis'
      }
    ], {
      baseDir: repoRoot
    })).not.toThrow();
  });

  it('fails when a schema-backed artifact payload is invalid', () => {
    const tempDir = createTempDir();
    const artifactPath = path.join(tempDir, 'implementation-summary.json');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const artifact: ArtifactRef = {
      id: 'implementation-summary',
      kind: 'report',
      path: artifactPath,
      taskId: 'schema-contracts--code-implementation'
    };

    fs.writeFileSync(artifactPath, `${JSON.stringify({
      taskId: 'schema-contracts--code-implementation',
      stage: 'code-implementation',
      goal: 'Apply the schema contracts change',
      summary: 'Missing changedFiles makes this invalid.'
    }, null, 2)}\n`, 'utf8');

    expect(() => validateSchemaBackedArtifacts([artifact])).toThrow('process.exit:1');

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
