import type { execFileSync as execFileSyncType } from 'node:child_process';
import type { AdapterRuntimeDocument } from '../types/index.js';
import {
  buildCopilotPreflightReport,
  maybeWritePreflightReport,
  type CliOptions,
  type CopilotPreflightReportDocument
} from '../adapters/copilot-preflight.js';

export interface PreflightCopilotCliDependencies {
  execFileSync: typeof execFileSyncType;
  fail: (message: string) => void;
  printJson: (value: CopilotPreflightReportDocument) => void;
  readStructuredFile: (filePath: string) => AdapterRuntimeDocument;
  setExitCode: (code: number) => void;
  validateAdapterRuntimePayload: (adapterRuntimePayload: AdapterRuntimeDocument, runtimePath: string) => void;
}

export function runPreflightCopilotCli(options: CliOptions, dependencies: PreflightCopilotCliDependencies): void {
  const adapterRuntimePath = options['adapter-runtime'];

  if (typeof adapterRuntimePath !== 'string') {
    dependencies.fail('preflight-copilot-cli requires --adapter-runtime');
    throw new Error('unreachable');
  }

  const adapterRuntimePayload = dependencies.readStructuredFile(adapterRuntimePath);
  dependencies.validateAdapterRuntimePayload(adapterRuntimePayload, adapterRuntimePath);

  const { report, blockingFailures } = buildCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload, {
    execFileSync: dependencies.execFileSync
  });

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  if (outputPath) {
    maybeWritePreflightReport(outputPath, report);
  } else {
    dependencies.printJson(report);
  }

  if (blockingFailures.length > 0) {
    dependencies.setExitCode(1);
  }
}