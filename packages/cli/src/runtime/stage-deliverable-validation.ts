import path from 'node:path';
import { fail, readStructuredFileFrom } from '../shared/fs-utils.js';
import { getSchemaValidators, type SchemaValidators } from '../shared/schema-registry.js';
import type { ArtifactRef } from '../types/execution-state.js';

type SchemaBackedArtifactId =
  | 'environment-preparation-report'
  | 'requirements-summary'
  | 'implementation-summary'
  | 'test-plan'
  | 'test-cases'
  | 'execution-report'
  | 'defect-summary'
  | 'collaboration-handoff';

interface SchemaBackedArtifactConfig {
  validate: (validators: SchemaValidators, payload: unknown) => boolean;
  getErrors: (validators: SchemaValidators) => unknown;
}

export interface ValidateSchemaBackedArtifactsOptions {
  baseDir?: string;
}

const schemaBackedArtifactIds: SchemaBackedArtifactId[] = [
  'environment-preparation-report',
  'requirements-summary',
  'implementation-summary',
  'test-plan',
  'test-cases',
  'execution-report',
  'defect-summary',
  'collaboration-handoff'
];

const schemaBackedArtifactConfigs: Record<SchemaBackedArtifactId, SchemaBackedArtifactConfig> = {
  'environment-preparation-report': {
    validate: (validators, payload) => validators.environmentPreparationReport(payload),
    getErrors: (validators) => validators.environmentPreparationReport.errors ?? []
  },
  'requirements-summary': {
    validate: (validators, payload) => validators.requirementSummary(payload),
    getErrors: (validators) => validators.requirementSummary.errors ?? []
  },
  'implementation-summary': {
    validate: (validators, payload) => validators.implementationSummary(payload),
    getErrors: (validators) => validators.implementationSummary.errors ?? []
  },
  'test-plan': {
    validate: (validators, payload) => validators.testPlan(payload),
    getErrors: (validators) => validators.testPlan.errors ?? []
  },
  'test-cases': {
    validate: (validators, payload) => validators.testCases(payload),
    getErrors: (validators) => validators.testCases.errors ?? []
  },
  'execution-report': {
    validate: (validators, payload) => validators.executionReport(payload),
    getErrors: (validators) => validators.executionReport.errors ?? []
  },
  'defect-summary': {
    validate: (validators, payload) => validators.defectSummary(payload),
    getErrors: (validators) => validators.defectSummary.errors ?? []
  },
  'collaboration-handoff': {
    validate: (validators, payload) => validators.collaborationHandoff(payload),
    getErrors: (validators) => validators.collaborationHandoff.errors ?? []
  }
};

function normalizeArtifactSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function isSchemaArtifactMatch(candidate: string, artifactId: SchemaBackedArtifactId): boolean {
  const normalizedCandidate = normalizeArtifactSearchValue(candidate);

  return normalizedCandidate === artifactId
    || normalizedCandidate.startsWith(`${artifactId}.`)
    || normalizedCandidate.startsWith(`${artifactId}-`)
    || normalizedCandidate.startsWith(`${artifactId}_`);
}

function getSchemaBackedArtifactId(artifact: ArtifactRef): SchemaBackedArtifactId | null {
  const artifactPath = String(artifact.path);
  const parsedArtifactPath = path.parse(artifactPath);
  const searchableValues = [artifact.id].map((value) => normalizeArtifactSearchValue(String(value)));

  if (parsedArtifactPath.ext.toLowerCase() === '.json') {
    searchableValues.push(
      normalizeArtifactSearchValue(parsedArtifactPath.base),
      normalizeArtifactSearchValue(parsedArtifactPath.name)
    );
  }

  return schemaBackedArtifactIds.find((artifactId) =>
    searchableValues.some((value) => isSchemaArtifactMatch(value, artifactId))
  ) ?? null;
}

function readArtifactPayload(artifact: ArtifactRef, options?: ValidateSchemaBackedArtifactsOptions): unknown {
  try {
    return readStructuredFileFrom(options?.baseDir, artifact.path);
  } catch (error) {
    const artifactError = error instanceof Error ? error.message : String(error);
    fail(`artifact schema validation failed for ${artifact.path}: unable to read payload: ${artifactError}`);
  }
}

export function validateSchemaBackedArtifacts(artifacts: ArtifactRef[], options?: ValidateSchemaBackedArtifactsOptions): void {
  const validators = getSchemaValidators();

  for (const artifact of artifacts) {
    const schemaBackedArtifactId = getSchemaBackedArtifactId(artifact);
    if (!schemaBackedArtifactId) {
      continue;
    }

    const artifactPayload = readArtifactPayload(artifact, options);
    const config = schemaBackedArtifactConfigs[schemaBackedArtifactId];
    const valid = config.validate(validators, artifactPayload);

    if (!valid) {
      fail(
        `artifact schema validation failed for ${artifact.path} (${schemaBackedArtifactId}): ${JSON.stringify(config.getErrors(validators))}`
      );
    }
  }
}
