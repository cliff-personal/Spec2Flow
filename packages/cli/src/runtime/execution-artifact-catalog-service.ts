import type { ExecutionArtifactStoreConfig, StoredExecutionArtifact } from './execution-artifact-store-service.js';

export interface BuildExecutionArtifactCatalogOptions {
  taskId: string;
  summary: string;
  artifacts: StoredExecutionArtifact[];
  storeConfig: ExecutionArtifactStoreConfig;
}

export function buildExecutionArtifactCatalog(options: BuildExecutionArtifactCatalogOptions): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    taskId: options.taskId,
    stage: 'automated-execution',
    summary: options.summary,
    store: {
      mode: options.storeConfig.mode,
      ...(options.storeConfig.provider ? { provider: options.storeConfig.provider } : {}),
      ...(options.storeConfig.publicBaseUrl ? { publicBaseUrl: options.storeConfig.publicBaseUrl } : {}),
      ...(options.storeConfig.keyPrefix ? { keyPrefix: options.storeConfig.keyPrefix } : {}),
      uploadConfigured: Boolean(options.storeConfig.upload?.endpointTemplate),
      ...(options.storeConfig.upload?.method ? { uploadMethod: options.storeConfig.upload.method } : {})
    },
    artifacts: options.artifacts.map((artifact) => ({
      id: artifact.id,
      path: artifact.path,
      kind: artifact.kind,
      category: artifact.category,
      ...(artifact.contentType ? { contentType: artifact.contentType } : {}),
      ...(artifact.storage ? { storage: artifact.storage } : {}),
      ...(artifact.upload ? { upload: artifact.upload } : {})
    }))
  };
}
