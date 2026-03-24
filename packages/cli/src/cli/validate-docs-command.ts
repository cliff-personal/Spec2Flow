import { buildDocsValidationReport } from '../docs/docs-validation-service.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export type { DocsValidationReportDocument } from '../docs/docs-validation-service.js';

export interface ValidateDocsDependencies {
  buildDocsValidationReport: (repoRoot: string) => import('../docs/docs-validation-service.js').DocsValidationReportDocument;
  printJson: (value: import('../docs/docs-validation-service.js').DocsValidationReportDocument) => void;
  rootDir: string;
  setExitCode: (code: number) => void;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function runValidateDocs(options: CliOptions, dependencies: ValidateDocsDependencies): void {
  const repoRoot = typeof options['repo-root'] === 'string' ? options['repo-root'] : dependencies.rootDir;
  const report = dependencies.buildDocsValidationReport(repoRoot);
  const outputPath = typeof options.output === 'string' ? options.output : undefined;

  if (outputPath) {
    dependencies.writeJson(outputPath, report);
    console.log(`Wrote docs validation report to ${outputPath}`);
  } else {
    dependencies.printJson(report);
  }

  if (report.status === 'failed') {
    dependencies.setExitCode(1);
  }
}

export const validateDocsDependencies = {
  buildDocsValidationReport
};