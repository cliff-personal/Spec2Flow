import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDocsValidationReport } from './docs-validation-service.js';

describe('docs-validation-service', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('passes for active docs and canonical docs with valid references', () => {
    const repoRoot = createRepoFixture({
      'package.json': JSON.stringify({
        scripts: {
          build: 'tsc -p tsconfig.build.json',
          'test:unit': 'vitest run',
          'validate:docs': 'node spec2flow validate-docs'
        }
      }, null, 2),
      'README.md': '# Readme\n\n- Status: active\n- Source of truth: `AGENTS.md`, `docs/index.md`\n- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`\n\nSee [Docs Index](docs/index.md).\n',
      'AGENTS.md': '# Agents\n\nUse `npm run build`.\n',
      '.github/copilot-instructions.md': 'See `AGENTS.md` and [Docs Index](../docs/index.md).\n',
      'docs/index.md': '# Docs Index\n\n- Status: active\n- Source of truth: `README.md`, `AGENTS.md`\n- Verified with: `npm run build`, `npm run validate:docs`\n\nSee [README](../README.md).\n'
    });

    const report = buildDocsValidationReport(repoRoot);

    expect(report.status).toBe('passed');
    expect(report.summary.validatedFiles).toBe(4);
    expect(report.issues).toEqual([]);
  });

  it('reports missing metadata, missing scripts, broken links, and bad source-of-truth paths', () => {
    const repoRoot = createRepoFixture({
      'package.json': JSON.stringify({
        scripts: {
          build: 'tsc -p tsconfig.build.json'
        }
      }, null, 2),
      'README.md': '# Readme\n\n- Status: active\n- Source of truth: `AGENTS.md`, `docs/missing.md`\n\nRun `npm run missing-script`.\nSee [Missing](docs/missing.md).\n',
      'AGENTS.md': '# Agents\n\nSee [Missing](missing.md).\n',
      '.github/copilot-instructions.md': 'Run `npm run build`.\n'
    });

    const report = buildDocsValidationReport(repoRoot);

    expect(report.status).toBe('failed');
    expect(report.issues).toEqual(expect.arrayContaining([
      {
        file: 'README.md',
        kind: 'metadata',
        message: 'missing Verified with metadata'
      },
      {
        file: 'README.md',
        kind: 'source-of-truth',
        message: 'source of truth path does not exist: docs/missing.md'
      },
      {
        file: 'README.md',
        kind: 'script',
        message: 'referenced npm script does not exist: missing-script'
      },
      {
        file: 'README.md',
        kind: 'link',
        message: 'linked file does not exist: docs/missing.md'
      },
      {
        file: 'AGENTS.md',
        kind: 'link',
        message: 'linked file does not exist: missing.md'
      }
    ]));
  });

  it('ignores historical docs and excluded directories', () => {
    const repoRoot = createRepoFixture({
      'package.json': JSON.stringify({ scripts: { build: 'tsc -p tsconfig.build.json' } }, null, 2),
      'README.md': '# Readme\n\n- Status: active\n- Source of truth: `AGENTS.md`\n- Verified with: `npm run build`\n',
      'AGENTS.md': '# Agents\n',
      '.github/copilot-instructions.md': 'Run `npm run build`.\n',
      'docs/old-plan.md': '# Old Plan\n\n- Status: historical\n\nRun `npm run missing-script`.\n',
      'packages/cli/dist/stale.md': '# Dist\n\n- Status: active\n\nRun `npm run missing-script`.\n'
    });

    const report = buildDocsValidationReport(repoRoot);

    expect(report.status).toBe('passed');
    expect(report.validatedFiles).toEqual(expect.arrayContaining(['README.md', 'AGENTS.md', '.github/copilot-instructions.md']));
    expect(report.validatedFiles).not.toContain('docs/old-plan.md');
    expect(report.validatedFiles).not.toContain('packages/cli/dist/stale.md');
  });
});

function createRepoFixture(files: Record<string, string>): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-docs-validator-'));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
  }

  return repoRoot;
}