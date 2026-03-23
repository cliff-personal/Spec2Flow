export type AdapterOutputMode = 'stdout' | 'file';

export interface AdapterRuntime {
  name: string;
  provider?: string;
  model?: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  outputMode: AdapterOutputMode;
  outputPath?: string;
}

export interface AdapterRuntimeDocument {
  adapterRuntime: AdapterRuntime;
}
