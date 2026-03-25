import fs from 'node:fs';
import { ensureDirForFile, resolveFromBaseDir, writeJsonFrom } from '../shared/fs-utils.js';

export type ExecutionArtifactKind = 'log' | 'trace' | 'screenshot' | 'video' | 'report' | 'other';
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

export interface StoredExecutionArtifact {
  id: string;
  path: string;
  kind: ExecutionArtifactKind;
  category: ExecutionArtifactCategory;
  contentType?: string;
}

interface WriteExecutionArtifactOptions {
  id: string;
  path: string;
  kind: ExecutionArtifactKind;
  category: ExecutionArtifactCategory;
  contentType?: string;
}

export interface ExecutionArtifactStore {
  writeJsonArtifact: (options: WriteExecutionArtifactOptions & { payload: unknown }) => StoredExecutionArtifact;
  writeTextArtifact: (options: WriteExecutionArtifactOptions & { content: string }) => StoredExecutionArtifact;
  registerArtifact: (options: WriteExecutionArtifactOptions) => StoredExecutionArtifact;
  listArtifacts: () => StoredExecutionArtifact[];
}

function normalizeArtifactRecord(options: WriteExecutionArtifactOptions): StoredExecutionArtifact {
  return {
    id: options.id,
    path: options.path,
    kind: options.kind,
    category: options.category,
    ...(options.contentType ? { contentType: options.contentType } : {})
  };
}

export function createExecutionArtifactStore(cwd: string): ExecutionArtifactStore {
  const artifacts = new Map<string, StoredExecutionArtifact>();

  const registerArtifact = (options: WriteExecutionArtifactOptions): StoredExecutionArtifact => {
    const record = normalizeArtifactRecord(options);
    artifacts.set(record.id, record);
    return record;
  };

  return {
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
