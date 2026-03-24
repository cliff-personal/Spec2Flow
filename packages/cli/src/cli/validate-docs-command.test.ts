import type { DocsValidationReportDocument } from './validate-docs-command.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runValidateDocs } from './validate-docs-command.js';

describe('validate-docs-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints the report for the default repo root and sets exit code on failure', () => {
    const report: DocsValidationReportDocument = {
      validator: 'docs',
      status: 'failed',
      repoRoot: '/repo',
      summary: {
        scannedMarkdownFiles: 3,
        validatedFiles: 2,
        issueCount: 1
      },
      validatedFiles: ['README.md', 'AGENTS.md'],
      issues: [{ file: 'README.md', kind: 'script', message: 'bad script' }]
    };
    const buildDocsValidationReport = vi.fn<(repoRoot: string) => DocsValidationReportDocument>(() => report);
    const printJson = vi.fn();
    const setExitCode = vi.fn();

    runValidateDocs({}, {
      buildDocsValidationReport,
      printJson,
      rootDir: '/repo',
      setExitCode,
      writeJson: vi.fn()
    });

    expect(buildDocsValidationReport).toHaveBeenCalledWith('/repo');
    expect(printJson).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it('writes the report when output is requested', () => {
    const report: DocsValidationReportDocument = {
      validator: 'docs',
      status: 'passed',
      repoRoot: '/custom-repo',
      summary: {
        scannedMarkdownFiles: 4,
        validatedFiles: 4,
        issueCount: 0
      },
      validatedFiles: ['README.md'],
      issues: []
    };
    const buildDocsValidationReport = vi.fn<(repoRoot: string) => DocsValidationReportDocument>(() => report);
    const writeJson = vi.fn();

    runValidateDocs({
      'repo-root': '/custom-repo',
      output: 'generated/docs-validation-report.json'
    }, {
      buildDocsValidationReport,
      printJson: vi.fn(),
      rootDir: '/repo',
      setExitCode: vi.fn(),
      writeJson
    });

    expect(buildDocsValidationReport).toHaveBeenCalledWith('/custom-repo');
    expect(writeJson).toHaveBeenCalledWith('generated/docs-validation-report.json', expect.objectContaining({
      status: 'passed'
    }));
  });
});