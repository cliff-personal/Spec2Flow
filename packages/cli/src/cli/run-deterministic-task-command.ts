import { runDeterministicTask } from '../runtime/deterministic-execution-service.js';
import type { AdapterRunDocument, TaskClaimPayload } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface RunDeterministicTaskDependencies {
  fail: (message: string) => void;
  printJson: (value: AdapterRunDocument) => void;
  readStructuredFile: (filePath: string) => unknown;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function runDeterministicTaskCommand(options: CliOptions, dependencies: RunDeterministicTaskDependencies): void {
  const claimPath = options.claim;

  if (typeof claimPath !== 'string') {
    dependencies.fail('run-deterministic-task requires --claim');
    throw new Error('unreachable');
  }

  const claimPayload = dependencies.readStructuredFile(claimPath) as TaskClaimPayload;
  const result = runDeterministicTask(claimPayload);
  const outputPath = typeof options.output === 'string' ? options.output : undefined;

  if (outputPath) {
    dependencies.writeJson(outputPath, result);
    console.log(`Wrote deterministic adapter run to ${outputPath}`);
    return;
  }

  dependencies.printJson(result);
}