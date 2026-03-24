export type AdapterOutputMode = 'stdout' | 'file';

export interface AdapterRuntimeStageRuntimeRefs {
  'environment-preparation'?: string;
  'requirements-analysis'?: string;
  'code-implementation'?: string;
  'test-design'?: string;
  'automated-execution'?: string;
  'defect-feedback'?: string;
  collaboration?: string;
}

export interface AdapterRuntime {
  name: string;
  provider?: string;
  model?: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  outputMode: AdapterOutputMode;
  outputPath?: string;
  stageRuntimeRefs?: AdapterRuntimeStageRuntimeRefs;
}

export interface AdapterRuntimeDocument {
  adapterRuntime: AdapterRuntime;
}
