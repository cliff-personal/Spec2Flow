import { buildValidatorResult } from '../onboarding/validator-service.js';
import { buildTaskGraph, getChangedFiles, getRequirementText } from '../planning/task-graph-service.js';
import type { TaskGraphDocument } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface GenerateTaskGraphDependencies {
  fail: (message: string) => void;
  printJson: (value: TaskGraphDocument) => void;
  readStructuredFile: (filePath: string) => any;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function runGenerateTaskGraph(options: CliOptions, dependencies: GenerateTaskGraphDependencies): void {
  const projectPath = options.project;
  const topologyPath = options.topology;
  const riskPath = options.risk;

  if (typeof projectPath !== 'string' || typeof topologyPath !== 'string' || typeof riskPath !== 'string') {
    dependencies.fail('generate-task-graph requires --project, --topology, and --risk');
    throw new Error('unreachable');
  }

  const projectPayload = dependencies.readStructuredFile(projectPath);
  const topologyPayload = dependencies.readStructuredFile(topologyPath);
  const riskPayload = dependencies.readStructuredFile(riskPath);
  const changedFiles = getChangedFiles(options);
  const requirementText = getRequirementText(options);
  const validatorResult = buildValidatorResult(projectPayload, topologyPayload, riskPayload, {
    project: projectPath,
    topology: topologyPath,
    risk: riskPath
  });

  if (validatorResult.validatorResult.status === 'failed') {
    dependencies.fail('cannot generate task graph because onboarding validation failed');
    throw new Error('unreachable');
  }

  const taskGraph = buildTaskGraph(projectPayload, topologyPayload, riskPayload, {
    project: projectPath,
    topology: topologyPath,
    risk: riskPath,
    requirement: typeof options['requirement-file'] === 'string' ? options['requirement-file'] : null
  }, {
    changedFiles,
    requirementText
  });

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  if (outputPath) {
    dependencies.writeJson(outputPath, taskGraph);
    console.log(`Wrote task graph to ${outputPath}`);
    return;
  }

  dependencies.printJson(taskGraph);
}