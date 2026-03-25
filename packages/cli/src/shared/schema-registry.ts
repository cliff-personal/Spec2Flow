import path from 'node:path';
import * as Ajv2020Module from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { readJsonFile, rootDir } from './fs-utils.js';

type AjvConstructor = new (options?: { allErrors?: boolean; strict?: boolean }) => {
  compile(schema: unknown): ValidateFunction;
};

const Ajv2020 = Ajv2020Module.default as unknown as AjvConstructor;
const addFormats = addFormatsModule.default as unknown as (ajv: unknown) => void;

export interface SchemaValidators {
  project: ValidateFunction;
  topology: ValidateFunction;
  risk: ValidateFunction;
  environmentPreparationReport: ValidateFunction;
  requirementSummary: ValidateFunction;
  implementationSummary: ValidateFunction;
  testPlan: ValidateFunction;
  testCases: ValidateFunction;
  executionReport: ValidateFunction;
  executionEvidenceIndex: ValidateFunction;
  defectSummary: ValidateFunction;
  collaborationHandoff: ValidateFunction;
  publicationRecord: ValidateFunction;
  executionState: ValidateFunction;
  taskResult: ValidateFunction;
  adapterRun: ValidateFunction;
  adapterRuntime: ValidateFunction;
}

export function getSchemaValidators(): SchemaValidators {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  return {
    project: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/project-adapter.schema.json'))),
    topology: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/system-topology.schema.json'))),
    risk: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/risk-policy.schema.json'))),
    environmentPreparationReport: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/environment-preparation-report.schema.json'))),
    requirementSummary: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/requirement-summary.schema.json'))),
    implementationSummary: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/implementation-summary.schema.json'))),
    testPlan: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/test-plan.schema.json'))),
    testCases: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/test-cases.schema.json'))),
    executionReport: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/execution-report.schema.json'))),
    executionEvidenceIndex: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/execution-evidence-index.schema.json'))),
    defectSummary: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/defect-summary.schema.json'))),
    collaborationHandoff: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/collaboration-handoff.schema.json'))),
    publicationRecord: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/publication-record.schema.json'))),
    executionState: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/execution-state.schema.json'))),
    taskResult: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/task-result.schema.json'))),
    adapterRun: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/adapter-run.schema.json'))),
    adapterRuntime: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/model-adapter-runtime.schema.json')))
  };
}
