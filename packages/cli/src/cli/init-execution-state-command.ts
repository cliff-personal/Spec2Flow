import { buildExecutionState, validateExecutionStatePayload } from '../runtime/execution-state-service.js';
import type { ExecutionStateDocument, TaskGraphDocument } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface InitExecutionStateDependencies {
  fail: (message: string) => void;
  printJson: (value: ExecutionStateDocument) => void;
  readStructuredFile: (filePath: string) => TaskGraphDocument;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function runInitExecutionState(options: CliOptions, dependencies: InitExecutionStateDependencies): void {
  const taskGraphPath = options['task-graph'];

  if (typeof taskGraphPath !== 'string') {
    dependencies.fail('init-execution-state requires --task-graph');
    throw new Error('unreachable');
  }

  const taskGraphPayload = dependencies.readStructuredFile(taskGraphPath);
  const executionStatePayload = buildExecutionState(taskGraphPayload, options, {
    taskGraph: taskGraphPath
  }) as ExecutionStateDocument;

  validateExecutionStatePayload(executionStatePayload, taskGraphPath);

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  if (outputPath) {
    dependencies.writeJson(outputPath, executionStatePayload);
    console.log(`Wrote execution state to ${outputPath}`);
    return;
  }

  dependencies.printJson(executionStatePayload);
}