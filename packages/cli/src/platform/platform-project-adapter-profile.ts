import { getSchemaValidators } from '../shared/schema-registry.js';
import { fileExists, readStructuredFile, resolveFromBaseDir } from '../shared/fs-utils.js';
import type { AdapterRuntimeDocument, PlatformProjectAdapterProfile } from '../types/index.js';

export const DEFAULT_PLATFORM_PROJECT_ADAPTER_RUNTIME_PATH = '.spec2flow/runtime/model-adapter-runtime.json';
export const DEFAULT_PLATFORM_PROJECT_ADAPTER_CAPABILITY_PATH = '.spec2flow/model-adapter-capability.json';

export interface PlatformProjectAdapterProfileInput {
  runtimePath?: string;
  capabilityPath?: string | null;
}

export interface ResolvePlatformProjectAdapterProfileOptions {
  repositoryRootPath: string;
  workspaceRootPath?: string;
  adapterProfile?: PlatformProjectAdapterProfileInput;
}

function normalizePath(baseDir: string, value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return resolveFromBaseDir(baseDir, trimmed);
}

function uniqueRoots(repositoryRootPath: string, workspaceRootPath: string | undefined): string[] {
  return [workspaceRootPath, repositoryRootPath].filter((value, index, values): value is string => {
    return typeof value === 'string' && value.length > 0 && values.indexOf(value) === index;
  });
}

function findDefaultProfilePath(roots: string[], relativePath: string): string | null {
  for (const root of roots) {
    const candidate = resolveFromBaseDir(root, relativePath);
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildValidationError(prefix: string, filePath: string, details: unknown): Error {
  return new Error(`${prefix} for ${filePath}: ${JSON.stringify(details)}`);
}

export function validatePlatformProjectAdapterProfile(profile: PlatformProjectAdapterProfile | null): void {
  if (!profile) {
    return;
  }

  const validators = getSchemaValidators();
  const runtimePayload = readStructuredFile(profile.runtimePath) as AdapterRuntimeDocument;
  if (!validators.adapterRuntime(runtimePayload)) {
    throw buildValidationError('adapter runtime validation failed', profile.runtimePath, validators.adapterRuntime.errors ?? []);
  }

  if (!profile.capabilityPath) {
    return;
  }

  const capabilityPayload = readStructuredFile(profile.capabilityPath);
  if (!validators.modelAdapterCapability(capabilityPayload)) {
    throw buildValidationError('adapter capability validation failed', profile.capabilityPath, validators.modelAdapterCapability.errors ?? []);
  }
}

export function resolvePlatformProjectAdapterProfile(
  options: ResolvePlatformProjectAdapterProfileOptions
): PlatformProjectAdapterProfile | null {
  const explicitRuntimePath = normalizePath(options.repositoryRootPath, options.adapterProfile?.runtimePath);
  const explicitCapabilityPath = normalizePath(options.repositoryRootPath, options.adapterProfile?.capabilityPath);
  const roots = uniqueRoots(options.repositoryRootPath, options.workspaceRootPath);

  if (explicitRuntimePath && !fileExists(explicitRuntimePath)) {
    throw new Error(`adapter runtime file does not exist: ${explicitRuntimePath}`);
  }

  if (explicitCapabilityPath && !fileExists(explicitCapabilityPath)) {
    throw new Error(`adapter capability file does not exist: ${explicitCapabilityPath}`);
  }

  const runtimePath = explicitRuntimePath
    ?? findDefaultProfilePath(roots, DEFAULT_PLATFORM_PROJECT_ADAPTER_RUNTIME_PATH);
  if (!runtimePath) {
    if (explicitCapabilityPath) {
      throw new Error('adapter capability path requires an adapter runtime path');
    }

    return null;
  }

  const capabilityPath = explicitCapabilityPath
    ?? findDefaultProfilePath(roots, DEFAULT_PLATFORM_PROJECT_ADAPTER_CAPABILITY_PATH);
  const profile: PlatformProjectAdapterProfile = {
    runtimePath,
    capabilityPath: capabilityPath ?? null
  };

  validatePlatformProjectAdapterProfile(profile);
  return profile;
}