import { loadOptionalStructuredFile } from '../shared/fs-utils.js';
import { claimNextTaskPayload } from '../runtime/task-claim-service.js';
import type { TaskClaimPayload } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface ClaimNextTaskDependencies {
  fail: (message: string) => void;
  printJson: (value: TaskClaimPayload) => void;
  readStructuredFile: (filePath: string) => any;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function runClaimNextTask(options: CliOptions, dependencies: ClaimNextTaskDependencies): void {
  const statePath = options.state;
  const taskGraphPath = options['task-graph'];

  if (typeof statePath !== 'string' || typeof taskGraphPath !== 'string') {
    dependencies.fail('claim-next-task requires --state and --task-graph');
    throw new Error('unreachable');
  }

  const claimPayload = claimNextTaskPayload(statePath, taskGraphPath, options, {
    readStructuredFile: dependencies.readStructuredFile,
    loadOptionalStructuredFile,
    writeJson: dependencies.writeJson
  });

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  if (outputPath) {
    dependencies.writeJson(outputPath, claimPayload);
    console.log(`Wrote task claim to ${outputPath}`);
    return;
  }

  dependencies.printJson(claimPayload);
}