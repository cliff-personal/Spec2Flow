import fs from 'node:fs';
import process from 'node:process';
import { ensureDirForFile, resolveFromBaseDir, writeJsonFrom } from '../shared/fs-utils.js';

export type ExecutionArtifactKind = 'log' | 'trace' | 'screenshot' | 'video' | 'report' | 'other';
export type ExecutionArtifactStoreMode = 'local' | 'remote-catalog';
export type ExecutionArtifactStoreProvider = 'local-fs' | 'generic-http' | 's3' | 'gcs' | 'azure-blob';
export type ExecutionArtifactUploadMethod = 'PUT' | 'POST';
export type ExecutionArtifactUploadStatus = 'pending' | 'uploaded' | 'skipped' | 'failed';
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

export interface ExecutionArtifactUploadConfig {
  endpointTemplate: string;
  method?: ExecutionArtifactUploadMethod;
  headers?: Record<string, string>;
  authTokenEnv?: string;
}

export interface ExecutionArtifactStoreConfig {
  mode: ExecutionArtifactStoreMode;
  provider?: ExecutionArtifactStoreProvider;
  publicBaseUrl?: string;
  keyPrefix?: string;
  catalogPath?: string;
  upload?: ExecutionArtifactUploadConfig;
}

export interface ExecutionArtifactUploadState {
  status: ExecutionArtifactUploadStatus;
  uploadedAt?: string;
  httpStatus?: number;
  error?: string;
}

export interface StoredExecutionArtifact {
  id: string;
  path: string;
  kind: ExecutionArtifactKind;
  category: ExecutionArtifactCategory;
  contentType?: string;
  storage?: ExecutionArtifactStorageReference;
  upload?: ExecutionArtifactUploadState;
}

interface WriteExecutionArtifactOptions {
  id: string;
  path: string;
  kind: ExecutionArtifactKind;
  category: ExecutionArtifactCategory;
  contentType?: string;
}

interface FlushExecutionArtifactUploadsOptions {
  artifactIds?: string[];
}

export interface ExecutionArtifactStore {
  getConfig: () => ExecutionArtifactStoreConfig;
  writeJsonArtifact: (options: WriteExecutionArtifactOptions & { payload: unknown }) => StoredExecutionArtifact;
  writeTextArtifact: (options: WriteExecutionArtifactOptions & { content: string }) => StoredExecutionArtifact;
  registerArtifact: (options: WriteExecutionArtifactOptions) => StoredExecutionArtifact;
  flushUploads: (options?: FlushExecutionArtifactUploadsOptions) => Promise<StoredExecutionArtifact[]>;
  listArtifacts: () => StoredExecutionArtifact[];
}

function joinRemoteUrl(baseUrl: string, objectKey: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(objectKey, normalizedBaseUrl).toString();
}

function encodeObjectKeyForUrl(objectKey: string): string {
  return objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function renderUploadEndpoint(template: string, objectKey: string): string {
  const encodedObjectKey = encodeObjectKeyForUrl(objectKey);
  return template.includes('{objectKey}')
    ? template.replaceAll('{objectKey}', encodedObjectKey)
    : template;
}

function normalizeObjectKey(pathValue: string, config: ExecutionArtifactStoreConfig): string {
  return `${config.keyPrefix ?? ''}${pathValue}`.replaceAll(/\\/g, '/').replaceAll(/^\/+/g, '');
}

function buildStorageReference(pathValue: string, config: ExecutionArtifactStoreConfig): ExecutionArtifactStorageReference | undefined {
  const objectKey = normalizeObjectKey(pathValue, config);

  if (config.mode === 'local') {
    return {
      mode: config.mode,
      ...(config.provider ? { provider: config.provider } : {}),
      objectKey,
      ...(config.publicBaseUrl ? { remoteUrl: joinRemoteUrl(config.publicBaseUrl, objectKey) } : {})
    };
  }

  return {
    mode: config.mode,
    ...(config.provider ? { provider: config.provider } : {}),
    objectKey,
    ...(config.publicBaseUrl ? { remoteUrl: joinRemoteUrl(config.publicBaseUrl, objectKey) } : {})
  };
}

function buildInitialUploadState(config: ExecutionArtifactStoreConfig, storage: ExecutionArtifactStorageReference | undefined): ExecutionArtifactUploadState | undefined {
  if (config.mode === 'local' || !storage) {
    return undefined;
  }

  return {
    status: 'pending'
  };
}

function normalizeArtifactRecord(options: WriteExecutionArtifactOptions, config: ExecutionArtifactStoreConfig): StoredExecutionArtifact {
  const storage = buildStorageReference(options.path, config);
  const upload = buildInitialUploadState(config, storage);
  return {
    id: options.id,
    path: options.path,
    kind: options.kind,
    category: options.category,
    ...(options.contentType ? { contentType: options.contentType } : {}),
    ...(storage ? { storage } : {}),
    ...(upload ? { upload } : {})
  };
}

function buildUploadHeaders(
  artifact: StoredExecutionArtifact,
  config: ExecutionArtifactStoreConfig,
  objectKey: string
): Record<string, string> | { error: string } {
  const configuredHeaders = config.upload?.headers ?? {};
  const authTokenEnv = config.upload?.authTokenEnv;

  if (!authTokenEnv) {
    return {
      ...configuredHeaders,
      ...(artifact.contentType ? { 'content-type': artifact.contentType } : {}),
      'x-spec2flow-artifact-id': artifact.id,
      'x-spec2flow-artifact-path': artifact.path,
      'x-spec2flow-object-key': objectKey
    };
  }

  const authToken = process.env[authTokenEnv];
  if (!authToken) {
    return {
      error: `Missing auth token in environment variable ${authTokenEnv}`
    };
  }

  return {
    ...configuredHeaders,
    ...(artifact.contentType ? { 'content-type': artifact.contentType } : {}),
    authorization: `Bearer ${authToken}`,
    'x-spec2flow-artifact-id': artifact.id,
    'x-spec2flow-artifact-path': artifact.path,
    'x-spec2flow-object-key': objectKey
  };
}

function updateArtifactRecord(
  artifacts: Map<string, StoredExecutionArtifact>,
  artifactId: string,
  upload: ExecutionArtifactUploadState
): StoredExecutionArtifact {
  const current = artifacts.get(artifactId);
  if (!current) {
    throw new Error(`Unknown artifact id: ${artifactId}`);
  }

  const next: StoredExecutionArtifact = {
    ...current,
    upload
  };
  artifacts.set(artifactId, next);
  return next;
}

export function createExecutionArtifactStore(cwd: string, config: Partial<ExecutionArtifactStoreConfig> = {}): ExecutionArtifactStore {
  const resolvedMode = config.mode ?? 'local';
  const resolvedProvider = config.provider ?? (resolvedMode === 'local' ? 'local-fs' : undefined);
  const resolvedConfig: ExecutionArtifactStoreConfig = {
    mode: resolvedMode,
    ...(resolvedProvider ? { provider: resolvedProvider } : {}),
    ...(config.publicBaseUrl ? { publicBaseUrl: config.publicBaseUrl } : {}),
    ...(config.keyPrefix ? { keyPrefix: config.keyPrefix } : {}),
    ...(config.catalogPath ? { catalogPath: config.catalogPath } : {}),
    ...(config.upload ? {
      upload: {
        endpointTemplate: config.upload.endpointTemplate,
        ...(config.upload.method ? { method: config.upload.method } : {}),
        ...(config.upload.headers ? { headers: config.upload.headers } : {}),
        ...(config.upload.authTokenEnv ? { authTokenEnv: config.upload.authTokenEnv } : {})
      }
    } : {})
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
    flushUploads: async (options = {}) => {
      const artifactIds = options.artifactIds ?? [...artifacts.keys()];
      const updatedArtifacts: StoredExecutionArtifact[] = [];

      for (const artifactId of artifactIds) {
        const artifact = artifacts.get(artifactId);
        if (!artifact) {
          continue;
        }

        if (!artifact.storage || resolvedConfig.mode === 'local') {
          updatedArtifacts.push(updateArtifactRecord(artifacts, artifactId, {
            status: 'skipped',
            error: 'local-store'
          }));
          continue;
        }

        const objectKey = artifact.storage.objectKey;
        if (!objectKey) {
          updatedArtifacts.push(updateArtifactRecord(artifacts, artifactId, {
            status: 'failed',
            error: 'missing-object-key'
          }));
          continue;
        }

        if (!resolvedConfig.upload?.endpointTemplate) {
          updatedArtifacts.push(updateArtifactRecord(artifacts, artifactId, {
            status: 'skipped',
            error: 'upload-not-configured'
          }));
          continue;
        }

        const resolvedPath = resolveFromBaseDir(cwd, artifact.path);
        if (!fs.existsSync(resolvedPath)) {
          updatedArtifacts.push(updateArtifactRecord(artifacts, artifactId, {
            status: 'failed',
            error: 'artifact-file-missing'
          }));
          continue;
        }

        const headers = buildUploadHeaders(artifact, resolvedConfig, objectKey);
        if ('error' in headers) {
          updatedArtifacts.push(updateArtifactRecord(artifacts, artifactId, {
            status: 'failed',
            error: headers.error
          }));
          continue;
        }

        const endpoint = renderUploadEndpoint(resolvedConfig.upload.endpointTemplate, objectKey);
        const response = await fetch(endpoint, {
          method: resolvedConfig.upload.method ?? 'PUT',
          headers,
          body: fs.readFileSync(resolvedPath)
        });

        if (!response.ok) {
          const errorBody = (await response.text()).trim();
          updatedArtifacts.push(updateArtifactRecord(artifacts, artifactId, {
            status: 'failed',
            httpStatus: response.status,
            error: errorBody || `artifact upload failed with status ${response.status}`
          }));
          continue;
        }

        updatedArtifacts.push(updateArtifactRecord(artifacts, artifactId, {
          status: 'uploaded',
          httpStatus: response.status,
          uploadedAt: new Date().toISOString()
        }));
      }

      return updatedArtifacts;
    },
    listArtifacts: () => [...artifacts.values()]
  };
}
