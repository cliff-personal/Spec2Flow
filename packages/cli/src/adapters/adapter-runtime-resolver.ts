import path from 'node:path';

import type { AdapterRuntimeDocument, TaskStage } from '../types/index.js';

const taskStages: TaskStage[] = [
  'environment-preparation',
  'requirements-analysis',
  'code-implementation',
  'test-design',
  'automated-execution',
  'defect-feedback',
  'collaboration'
];

export interface AdapterRuntimeResolverDependencies {
  readStructuredFile: (filePath: string) => unknown;
  validateAdapterRuntimePayload: (payload: AdapterRuntimeDocument, runtimePath: string) => void;
}

export interface ResolvedAdapterRuntime {
  runtimePath: string;
  runtimePayload: AdapterRuntimeDocument;
}

function resolveRuntimeRefPath(baseRuntimePath: string, runtimeRef: string): string {
  return path.isAbsolute(runtimeRef)
    ? runtimeRef
    : path.resolve(path.dirname(baseRuntimePath), runtimeRef);
}

function readValidatedRuntime(runtimePath: string, dependencies: AdapterRuntimeResolverDependencies): AdapterRuntimeDocument {
  const runtimePayload = dependencies.readStructuredFile(runtimePath) as AdapterRuntimeDocument;
  dependencies.validateAdapterRuntimePayload(runtimePayload, runtimePath);
  return runtimePayload;
}

export function resolveAdapterRuntimeForStage(
  rootRuntimePath: string,
  rootRuntimePayload: AdapterRuntimeDocument,
  stage: TaskStage,
  dependencies: AdapterRuntimeResolverDependencies
): ResolvedAdapterRuntime {
  const runtimeRef = rootRuntimePayload.adapterRuntime.stageRuntimeRefs?.[stage];
  if (!runtimeRef) {
    return {
      runtimePath: rootRuntimePath,
      runtimePayload: rootRuntimePayload
    };
  }

  const resolvedRuntimePath = resolveRuntimeRefPath(rootRuntimePath, runtimeRef);
  return {
    runtimePath: resolvedRuntimePath,
    runtimePayload: readValidatedRuntime(resolvedRuntimePath, dependencies)
  };
}

export function collectAdapterRuntimeVariants(
  rootRuntimePath: string,
  rootRuntimePayload: AdapterRuntimeDocument,
  dependencies: AdapterRuntimeResolverDependencies
): ResolvedAdapterRuntime[] {
  const variants: ResolvedAdapterRuntime[] = [{
    runtimePath: rootRuntimePath,
    runtimePayload: rootRuntimePayload
  }];
  const seenPaths = new Set([rootRuntimePath]);

  for (const stage of taskStages) {
    const runtimeRef = rootRuntimePayload.adapterRuntime.stageRuntimeRefs?.[stage];
    if (!runtimeRef) {
      continue;
    }

    const resolvedRuntimePath = resolveRuntimeRefPath(rootRuntimePath, runtimeRef);
    if (seenPaths.has(resolvedRuntimePath)) {
      continue;
    }

    variants.push({
      runtimePath: resolvedRuntimePath,
      runtimePayload: readValidatedRuntime(resolvedRuntimePath, dependencies)
    });
    seenPaths.add(resolvedRuntimePath);
  }

  return variants;
}