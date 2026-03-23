import { buildValidatorResult } from '../onboarding/validator-service.js';
import type { ValidateOnboardingResultDocument } from '../onboarding/validator-service.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export type { ValidateOnboardingResultDocument } from '../onboarding/validator-service.js';

export interface ValidateOnboardingDependencies {
  fail: (message: string) => void;
  printJson: (value: ValidateOnboardingResultDocument) => void;
  readStructuredFile: (filePath: string) => any;
  setExitCode: (code: number) => void;
  writeJson: (filePath: string, payload: unknown) => void;
}

export function runValidateOnboarding(options: CliOptions, dependencies: ValidateOnboardingDependencies): void {
  const projectPath = options.project;
  const topologyPath = options.topology;
  const riskPath = options.risk;

  if (typeof projectPath !== 'string' || typeof topologyPath !== 'string' || typeof riskPath !== 'string') {
    dependencies.fail('validate-onboarding requires --project, --topology, and --risk');
    throw new Error('unreachable');
  }

  const projectPayload = dependencies.readStructuredFile(projectPath);
  const topologyPayload = dependencies.readStructuredFile(topologyPath);
  const riskPayload = dependencies.readStructuredFile(riskPath);
  const result = buildValidatorResult(projectPayload, topologyPayload, riskPayload, {
    project: projectPath,
    topology: topologyPath,
    risk: riskPath
  }) as ValidateOnboardingResultDocument;

  const outputPath = typeof options.output === 'string' ? options.output : undefined;
  if (outputPath) {
    dependencies.writeJson(outputPath, result);
    console.log(`Wrote validator result to ${outputPath}`);
  } else {
    dependencies.printJson(result);
  }

  if (result.validatorResult.status === 'failed') {
    dependencies.setExitCode(1);
  }
}