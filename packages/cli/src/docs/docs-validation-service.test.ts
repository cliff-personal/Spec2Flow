import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDocsValidationReport } from './docs-validation-service.js';

describe('docs-validation-service', () => {
  const tempDirs: string[] = [];
  const validationNow = new Date('2026-03-25T00:00:00.000Z');

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
      'README.md': '# Readme\n\n- Status: active\n- Source of truth: `AGENTS.md`, `docs/index.md`\n- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`\n- Last verified: 2026-03-25\n\nSee [Docs Index](docs/index.md).\n',
      'AGENTS.md': '# Agents\n\nUse `npm run build`.\n',
      '.github/copilot-instructions.md': 'See `AGENTS.md` and [Docs Index](../docs/index.md).\n',
      'docs/index.md': '# Docs Index\n\n- Status: active\n- Source of truth: `README.md`, `AGENTS.md`\n- Verified with: `npm run build`, `npm run validate:docs`\n- Last verified: 2026-03-25\n\nSee [README](../README.md).\n'
    });

    const report = buildDocsValidationReport(repoRoot, { now: validationNow });

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

    const report = buildDocsValidationReport(repoRoot, { now: validationNow });

    expect(report.status).toBe('failed');
    expect(report.issues).toEqual(expect.arrayContaining([
      {
        file: 'README.md',
        kind: 'metadata',
        message: 'missing Verified with metadata'
      },
      {
        file: 'README.md',
        kind: 'metadata',
        message: 'missing Last verified metadata'
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
      'README.md': '# Readme\n\n- Status: active\n- Source of truth: `AGENTS.md`\n- Verified with: `npm run build`\n- Last verified: 2026-03-25\n',
      'AGENTS.md': '# Agents\n',
      '.github/copilot-instructions.md': 'Run `npm run build`.\n',
      'docs/plans/historical/old-plan.md': '# Old Plan\n\n- Status: historical\n\nRun `npm run missing-script`.\n',
      'packages/cli/dist/stale.md': '# Dist\n\n- Status: active\n\nRun `npm run missing-script`.\n'
    });

    const report = buildDocsValidationReport(repoRoot, { now: validationNow });

    expect(report.status).toBe('passed');
    expect(report.validatedFiles).toEqual(expect.arrayContaining(['README.md', 'AGENTS.md', '.github/copilot-instructions.md']));
    expect(report.validatedFiles).not.toContain('docs/plans/historical/old-plan.md');
    expect(report.validatedFiles).not.toContain('packages/cli/dist/stale.md');
  });

  it('reports docs root layout drift for plan docs and archived statuses', () => {
    const repoRoot = createRepoFixture({
      'package.json': JSON.stringify({ scripts: { build: 'tsc -p tsconfig.build.json' } }, null, 2),
      'README.md': '# Readme\n\n- Status: active\n- Source of truth: `AGENTS.md`\n- Verified with: `npm run build`\n- Last verified: 2026-03-25\n',
      'AGENTS.md': '# Agents\n',
      '.github/copilot-instructions.md': 'Run `npm run build`.\n',
      'docs/roadmap.md': '# Roadmap\n\n- Status: active\n- Source of truth: `README.md`\n- Verified with: `npm run build`\n- Last verified: 2026-03-25\n',
      'docs/archive-note.md': '# Archive Note\n\n- Status: historical\n- Source of truth: `README.md`\n- Verified with: archived for reference only\n',
      'docs/plans/historical/roadmap.md': '# Roadmap\n\n- Status: historical\n- Source of truth: `README.md`\n- Verified with: archived for reference only\n'
    });

    const report = buildDocsValidationReport(repoRoot, { now: validationNow });

    expect(report.status).toBe('failed');
    expect(report.issues).toEqual(expect.arrayContaining([
      {
        file: 'docs/roadmap.md',
        kind: 'layout',
        message: 'plan, roadmap, migration, and rollout docs must live under docs/plans/'
      },
      {
        file: 'docs/archive-note.md',
        kind: 'layout',
        message: 'completed or historical docs must live under docs/plans/ instead of docs root'
      }
    ]));
    expect(report.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'docs/plans/historical/roadmap.md',
        kind: 'layout'
      })
    ]));
  });

  it('rejects archived plan files as source-of-truth or direct navigation targets for active docs', () => {
    const repoRoot = createRepoFixture({
      'package.json': JSON.stringify({ scripts: { build: 'tsc -p tsconfig.build.json' } }, null, 2),
      'README.md': '# Readme\n\n- Status: active\n- Source of truth: `AGENTS.md`, `docs/plans/historical/roadmap.md`\n- Verified with: `npm run build`\n- Last verified: 2026-03-25\n\nSee [Old roadmap](docs/plans/historical/roadmap.md).\nSee [Historical index](docs/plans/historical/index.md).\n',
      'AGENTS.md': '# Agents\n',
      '.github/copilot-instructions.md': 'Run `npm run build`.\n',
      'docs/plans/historical/index.md': '# Historical Plans\n\n- Status: reference\n- Source of truth: `docs/plans/index.md`\n- Verified with: archived for reference only\n',
      'docs/plans/historical/roadmap.md': '# Roadmap\n\n- Status: historical\n- Source of truth: `README.md`\n- Verified with: archived for reference only\n'
    });

    const report = buildDocsValidationReport(repoRoot, { now: validationNow });

    expect(report.status).toBe('failed');
    expect(report.issues).toEqual(expect.arrayContaining([
      {
        file: 'README.md',
        kind: 'source-of-truth',
        message: 'active or canonical docs cannot use archived plan files as source of truth: docs/plans/historical/roadmap.md'
      },
      {
        file: 'README.md',
        kind: 'layout',
        message: 'active or canonical docs must link to plan indexes instead of archived plan files: docs/plans/historical/roadmap.md'
      }
    ]));
    expect(report.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'README.md',
        message: expect.stringContaining('docs/plans/historical/index.md')
      })
    ]));
  });

  it('keeps docs-governance navigation hints valid in the live repository docs', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
    const report = buildDocsValidationReport(repoRoot);
    const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
    const docsIndex = fs.readFileSync(path.join(repoRoot, 'docs/index.md'), 'utf8');

    expect(report.status).toBe('passed');
    expect(report.validatedFiles).toEqual(expect.arrayContaining([
      'README.md',
      'docs/index.md',
      'docs/structure.md',
      'docs/plans/index.md'
    ]));
    expect(report.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'README.md' }),
      expect.objectContaining({ file: 'docs/index.md' })
    ]));
    expect(readme).toContain('Docs governance lives in two places: use [docs/structure.md](docs/structure.md)');
    expect(readme).toContain('[docs/plans/index.md](docs/plans/index.md)');
    expect(docsIndex).toContain('Docs governance quick path:');
    expect(docsIndex).toContain('### Where do active docs rules and archived plan rules live?');
    expect(docsIndex).toContain('docs/structure.md');
    expect(docsIndex).toContain('docs/plans/index.md');
  });

  it('rejects invalid, future, and stale Last verified metadata for active docs', () => {
    const repoRoot = createRepoFixture({
      'package.json': JSON.stringify({ scripts: { build: 'tsc -p tsconfig.build.json' } }, null, 2),
      'README.md': '# Readme\n\n- Status: active\n- Source of truth: `AGENTS.md`\n- Verified with: `npm run build`\n- Last verified: yesterday\n',
      'AGENTS.md': '# Agents\n',
      '.github/copilot-instructions.md': 'Run `npm run build`.\n',
      'docs/index.md': '# Docs Index\n\n- Status: active\n- Source of truth: `README.md`\n- Verified with: `npm run build`\n- Last verified: 2026-03-26\n',
      'docs/usage-guide.md': '# Usage\n\n- Status: active\n- Source of truth: `README.md`\n- Verified with: `npm run build`\n- Last verified: 2025-11-20\n'
    });

    const report = buildDocsValidationReport(repoRoot, { now: validationNow });

    expect(report.status).toBe('failed');
    expect(report.issues).toEqual(expect.arrayContaining([
      {
        file: 'README.md',
        kind: 'metadata',
        message: 'Last verified metadata must use YYYY-MM-DD'
      },
      {
        file: 'docs/index.md',
        kind: 'metadata',
        message: 'Last verified date cannot be in the future: 2026-03-26'
      },
      {
        file: 'docs/usage-guide.md',
        kind: 'metadata',
        message: 'active doc freshness window exceeded: 2025-11-20 is older than 120 days'
      }
    ]));
  });

  it('rejects deprecated scripts and overbroad source-of-truth paths in active docs', () => {
    const repoRoot = createRepoFixture({
      'package.json': JSON.stringify({
        scripts: {
          build: 'tsc -p tsconfig.build.json',
          lint: 'eslint .'
        },
        spec2flow: {
          docsValidation: {
            deprecatedScripts: {
              'legacy:build': 'build'
            }
          }
        }
      }, null, 2),
      'README.md': '# Readme\n\n- Status: active\n- Source of truth: `schemas/`, `AGENTS.md`\n- Verified with: `npm run build`\n- Last verified: 2026-03-25\n\nRun `npm run legacy:build`.\n',
      'AGENTS.md': '# Agents\n',
      '.github/copilot-instructions.md': 'Run `npm run build`.\n',
      'schemas/task-graph.schema.json': '{}\n'
    });

    const report = buildDocsValidationReport(repoRoot, { now: validationNow });

    expect(report.status).toBe('failed');
    expect(report.issues).toEqual(expect.arrayContaining([
      {
        file: 'README.md',
        kind: 'source-of-truth',
        message: 'source of truth path is too broad for an active doc; reference concrete files instead: schemas/'
      },
      {
        file: 'README.md',
        kind: 'script',
        message: 'referenced npm script is deprecated: legacy:build; use build'
      }
    ]));
  });

  it('rejects non-reciprocal supersession metadata', () => {
    const repoRoot = createRepoFixture({
      'package.json': JSON.stringify({ scripts: { build: 'tsc -p tsconfig.build.json' } }, null, 2),
      'README.md': '# Readme\n\n- Status: active\n- Source of truth: `docs/design.md`\n- Verified with: `npm run build`\n- Last verified: 2026-03-25\n',
      'AGENTS.md': '# Agents\n',
      '.github/copilot-instructions.md': 'Run `npm run build`.\n',
      'docs/design.md': '# Design\n\n- Status: active\n- Source of truth: `README.md`\n- Verified with: `npm run build`\n- Last verified: 2026-03-25\n- Supersedes: `reference.md`\n',
      'docs/reference.md': '# Reference\n\n- Status: reference\n- Source of truth: `README.md`\n- Verified with: archived for reference only\n'
    });

    const report = buildDocsValidationReport(repoRoot, { now: validationNow });

    expect(report.status).toBe('failed');
    expect(report.issues).toEqual(expect.arrayContaining([
      {
        file: 'docs/design.md',
        kind: 'supersession',
        message: 'Supersedes relationship must be reciprocal: docs/design.md -> docs/reference.md requires Superseded by'
      }
    ]));
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
