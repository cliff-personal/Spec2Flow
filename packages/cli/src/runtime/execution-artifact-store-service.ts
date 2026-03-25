import fs from 'node:fs';
import { ensureDirForFile, resolveFromBaseDir, writeJsonFrom } from '../shared/fs-utils.js';

export type ExecutionArtifactKind = 'log' | 'trace' | 'screenshot' | 'video' | 'report' | 'other';
export type ExecutionArtifactStoreMode = 'local' | 'remote-catalog';
export type ExecutionArtifactStoreProvider = 'generic-http' | 's3' | 'gcs' | 'azure-blob';
export type ExecutionArtifactCategory =
  | 'service-startup'
  | 'service-health'
  | 'service-teardown'
  | 'verification-command'
  | 'browser-check'
  | 'browser-screenshot'
  | 'browser-trace'
  | 'browser-video'
  | 'execution-lifecycle'
  | 'artifact-index'
  | 'other';

export interface ExecutionArtifactStorageReference {
  mode: ExecutionArtifactStoreMode;
  provider?: ExecutionArtifactStoreProvider;
  objectKey?: string;
  remoteUrl?: string;
}

export interface ExecutionArtifactStoreConfig {
  mode: ExecutionArtifactStoreMode;
  provider?: ExecutionArtifactStoreProvider;
  publicBaseUrl?: string;
  keyPrefix?: string;
  catalogPath?: string;
}

export interface StoredExecutionArtifact {
  id: string;
  path: string;
  kind: ExecutionArtifactKind;
  category: ExecutionArtifactCategory;
  contentType?: string;
  storage?: ExecutionArtifactStorageReference;
}

interface WriteExecutionArtifactOptions {
  id: string;
  path: string;
  kind: ExecutionArtifactKind;
  category: ExecutionArtifactCategory;
  contentType?: string;
}

export interface ExecutionArtifactStore {
  getConfig: () => ExecutionArtifactStoreConfig;
  writeJsonArtifact: (options: WriteExecutionArtifactOptions & { payload: unknown }) => StoredExecutionArtifact;
  writeTextArtifact: (options: WriteExecutionArtifactOptions & { content: string }) => StoredExecutionArtifact;
  registerArtifact: (options: WriteExecutionArtifactOptions) => StoredExecutionArtifact;
  listArtifacts: () => StoredExecutionArtifact[];
}

function joinRemoteUrl(baseUrl: string, objectKey: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(objectKey, normalizedBaseUrl).toString();
}

function buildStorageReference(path: string, config: ExecutionArtifactStoreConfig): ExecutionArtifactStorageReference | undefined {
  if (config.mode === 'local') {
    return undefined;
  }

  const objectKey = `${config.keyPrefix ?? ''}${path}`.replaceAll(/\\/g, '/').replaceAll(/^\/+/g, '');
  return {
    mode: config.mode,
    ...(config.provider ? { provider: config.provider } : {}),
    objectKey,
    ...(config.publicBaseUrl ? { remoteUrl: joinRemoteUrl(config.publicBaseUrl, objectKey) } : {})
  };
}

function normalizeArtifactRecord(options: WriteExecutionArtifactOptions, config: ExecutionArtifactStoreConfig): StoredExecutionArtifact {
  const storage = buildStorageReference(options.path, config);
  return {
    id: options.id,
    path: options.path,
    kind: options.kind,
    category: options.category,
    ...(options.contentType ? { contentType: options.contentType } : {}),
    ...(storage ? { storage } : {})
  };
}

export function createExecutionArtifactStore(cwd: string, config: Partial<ExecutionArtifactStoreConfig> = {}): ExecutionArtifactStore {
  const resolvedConfig: ExecutionArtifactStoreConfig = {
    mode: config.mode ?? 'local',
    ...(config.provider ? { provider: config.provider } : {}),
    ...(config.publicBaseUrl ? { publicBaseUrl: config.publicBaseUrl } : {}),
    ...(config.keyPrefix ? { keyPrefix: config.keyPrefix } : {}),
    ...(config.catalogPath ? { catalogPath: config.catalogPath } : {})
  };
  const artifacts = new Map<string, StoredExecutionArtifact>();

  const registerArtifact = (options: WriteExecutionArtifactOptions): StoredExecutionArtifact => {
    const record = normalizeArtifactRecord(options, resolvedConfig);
    artifacts.set(record.id, record);
    return record;
  };

  return {
    getConfig: () => resolvedConfig,
    writeJsonArtifact: (options) => {
      writeJsonFrom(cwd, options.path, options.payload);
      return registerArtifact(options);
    },
    writeTextArtifact: (options) => {
      const resolvedPath = resolveFromBaseDir(cwd, options.path);
      ensureDirForFile(resolvedPath);
      fs.writeFileSync(resolvedPath, options.content, 'utf8');
      return registerArtifact(options);
    },
    registerArtifact,
    listArtifacts: () => [...artifacts.values()]
  };
}
