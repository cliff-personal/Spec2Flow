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
    executionState: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/execution-state.schema.json'))),
    taskResult: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/task-result.schema.json'))),
    adapterRun: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/adapter-run.schema.json'))),
    adapterRuntime: ajv.compile(readJsonFile(path.join(rootDir, 'schemas/model-adapter-runtime.schema.json')))
  };
}