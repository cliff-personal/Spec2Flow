import path from 'node:path';

import { fail, fileExists, readStructuredFile, resolveFromCwd } from '../shared/fs-utils.js';
import { getSchemaValidators } from '../shared/schema-registry.js';
import type {
  AdapterRunActivity,
  AdapterRunDocument,
  AdapterRuntime,
  AdapterRuntimeDocument,
  ArtifactRef,
  ErrorItem,
  TaskClaimPayload
} from '../types/index.js';

export type AdapterTemplateContext = Record<string, string>;

export interface AdapterErrorLike {
  code?: string;
  type?: string;
  message: string;
  taskId?: string;
  recoverable?: boolean;
}

export interface AdapterArtifactLike {
  id?: string;
  kind?: ArtifactRef['kind'];
  path: string;
  taskId?: string;
}

interface AdapterRunActivityLike {
  commands?: unknown;
  editedFiles?: unknown;
  artifactFiles?: unknown;
  collaborationActions?: unknown;
}

const schemaBackedArtifactIds = new Set([
  'environment-preparation-report',
  'requirements-summary',
  'implementation-summary',
  'test-plan',
  'test-cases',
  'execution-report',
  'defect-summary',
  'collaboration-handoff'
]);

function normalizePathSeparators(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function isPathWithinDirectory(filePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function inferRepositoryRoot(adapterRuntimePayload: AdapterRuntimeDocument, claimPayload: TaskClaimPayload): string | null {
  const runtimeCwd = adapterRuntimePayload.adapterRuntime.cwd?.trim();
  if (runtimeCwd) {
    return path.resolve(runtimeCwd);
  }

  const projectAdapterRef = claimPayload.taskClaim?.repositoryContext.projectAdapterRef?.trim();
  if (!projectAdapterRef) {
    return null;
  }

  const resolvedProjectAdapterRef = resolveFromCwd(projectAdapterRef);
  return path.resolve(path.dirname(resolvedProjectAdapterRef), '..');
}

function normalizeEditedFilePath(filePath: string, repositoryRoot: string | null): string | null {
  const normalizedInput = normalizePathSeparators(filePath.trim());
  if (!normalizedInput) {
    return null;
  }

  if (!repositoryRoot) {
    return normalizedInput;
  }

  if (!path.isAbsolute(normalizedInput)) {
    return normalizedInput;
  }

  const resolvedFilePath = path.resolve(normalizedInput);
  if (!isPathWithinDirectory(resolvedFilePath, repositoryRoot)) {
    return null;
  }

  const relativePath = path.relative(repositoryRoot, resolvedFilePath);
  return normalizePathSeparators(relativePath || path.basename(resolvedFilePath));
}

function normalizeActivityPathForComparison(filePath: string, repositoryRoot: string | null): string | null {
  const normalizedInput = normalizePathSeparators(filePath.trim());
  if (!normalizedInput) {
    return null;
  }

  if (!repositoryRoot || !path.isAbsolute(normalizedInput)) {
    return normalizedInput;
  }

  const resolvedFilePath = path.resolve(normalizedInput);
  if (!isPathWithinDirectory(resolvedFilePath, repositoryRoot)) {
    return normalizePathSeparators(resolvedFilePath);
  }

  const relativePath = path.relative(repositoryRoot, resolvedFilePath);
  return normalizePathSeparators(relativePath || path.basename(resolvedFilePath));
}

function filterEditedFilesThatAreArtifactOutputs(
  editedFiles: string[],
  artifactPaths: string[],
  repositoryRoot: string | null
): string[] {
  const artifactPathKeys = new Set(
    artifactPaths
      .map((filePath) => normalizeActivityPathForComparison(filePath, repositoryRoot))
      .filter((filePath): filePath is string => Boolean(filePath))
      .map((filePath) => filePath.toLowerCase())
  );

  return editedFiles.filter((filePath) => {
    const normalizedFilePath = normalizeActivityPathForComparison(filePath, repositoryRoot);
    if (!normalizedFilePath) {
      return false;
    }

    return !artifactPathKeys.has(normalizedFilePath.toLowerCase());
  });
}

export function buildAdapterTemplateContext(
  claimPayload: TaskClaimPayload,
  statePath: string,
  taskGraphPath: string,
  options: Record<string, any> = {}
): AdapterTemplateContext {
  const claim = claimPayload.taskClaim;
  if (!claim) {
    fail('task claim is required to build adapter template context');
  }
  const adapterRuntimePayload = options.adapterRuntimePayload ?? null;
  const provider = (claim.runtimeContext?.provider ?? {}) as { adapter?: string; sessionId?: string };
  const routeName = options.getRouteNameFromTaskId(claim.taskId ?? '');
  const sessionNamespace = provider.sessionId ?? claim.runId ?? '';
  const specialistSessionScope = claim.roleProfile.specialistRole ?? claim.executorType ?? '';

  const buildSessionKey = (...parts: string[]) => parts.filter(Boolean).join('::');

  return {
    adapterCapabilityPath: options['adapter-capability'] ?? '',
    claimPath: options.claim ?? '',
    outputBase: options['output-base'] ?? '',
    outputPath: options['adapter-output'] ?? '',
    adapterModel: adapterRuntimePayload?.adapterRuntime?.model ?? '',
    adapterProvider: provider.adapter ?? adapterRuntimePayload?.adapterRuntime?.provider ?? '',
    runId: claim.runId ?? '',
    workflowName: claim.workflowName ?? '',
    taskId: claim.taskId ?? '',
    routeName,
    stage: claim.stage ?? '',
    executorType: claim.executorType ?? '',
    goal: claim.goal ?? '',
    providerSessionId: provider.sessionId ?? '',
    sessionNamespace,
    specialistSessionId: specialistSessionScope,
    specialistSessionKey: buildSessionKey(specialistSessionScope),
    runSessionKey: buildSessionKey(sessionNamespace),
    routeSessionKey: buildSessionKey(sessionNamespace, routeName),
    stageSessionKey: buildSessionKey(sessionNamespace, claim.stage ?? ''),
    executorSessionKey: buildSessionKey(sessionNamespace, claim.executorType ?? ''),
    routeExecutorSessionKey: buildSessionKey(sessionNamespace, routeName, claim.executorType ?? ''),
    taskSessionKey: buildSessionKey(sessionNamespace, claim.taskId ?? ''),
    worktreePath: claim.runtimeContext?.workspace?.worktreePath ?? '',
    repositoryRootPath: claim.runtimeContext?.workspace?.repositoryRootPath ?? '',
    workspaceRootPath: claim.runtimeContext?.workspace?.workspaceRootPath ?? '',
    statePath,
    taskGraphPath
  };
}

export function expandTemplateValue(value: string, context: AdapterTemplateContext): string {
  return value.replaceAll(/\$\{([^}]+)\}/g, (match, key) => {
    if (Object.hasOwn(context, key)) {
      return String(context[key] ?? '');
    }

    return match;
  });
}

export function normalizeAdapterArtifacts(artifacts: AdapterArtifactLike[] | undefined, taskId: string): ArtifactRef[] {
  return (artifacts ?? []).map((artifact, index) => ({
    id: artifact.id ?? `${taskId}-artifact-${index + 1}`,
    kind: artifact.kind ?? 'report',
    path: artifact.path,
    taskId: artifact.taskId ?? taskId
  }));
}

function inferArtifactKindFromPath(filePath: string): ArtifactRef['kind'] {
  const normalizedPath = filePath.trim().toLowerCase();
  const extension = path.extname(normalizedPath);

  if (normalizedPath.includes('screenshot') || ['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    return 'screenshot';
  }

  if (normalizedPath.includes('trace') || extension === '.zip') {
    return 'trace';
  }

  if (normalizedPath.includes('bug-draft')) {
    return 'bug-draft';
  }

  if (normalizedPath.includes('diff') || extension === '.diff' || extension === '.patch') {
    return 'diff';
  }

  if (normalizedPath.includes('log') || extension === '.log') {
    return 'log';
  }

  return 'report';
}

function inferArtifactIdFromPath(filePath: string, fallbackId: string): string {
  const normalizedPath = filePath.trim().replaceAll('\\', '/');
  const baseName = path.basename(normalizedPath);
  const extension = path.extname(baseName);
  const withoutExtension = extension ? baseName.slice(0, -extension.length) : baseName;
  const normalizedCharacters: string[] = [];
  let previousWasSeparator = false;

  for (const character of withoutExtension.toLowerCase()) {
    const isAlphaNumeric =
      (character >= 'a' && character <= 'z') ||
      (character >= '0' && character <= '9');

    if (isAlphaNumeric) {
      normalizedCharacters.push(character);
      previousWasSeparator = false;
      continue;
    }

    if (!previousWasSeparator && normalizedCharacters.length > 0) {
      normalizedCharacters.push('-');
      previousWasSeparator = true;
    }
  }

  while (normalizedCharacters.at(-1) === '-') {
    normalizedCharacters.pop();
  }

  const normalized = normalizedCharacters.join('');

  return normalized || fallbackId;
}

function normalizeActivityArtifactFiles(activityArtifactFiles: string[], taskId: string): ArtifactRef[] {
  return activityArtifactFiles.map((artifactPath, index) => {
    const fallbackId = `${taskId}-artifact-file-${index + 1}`;
    const inferredId = inferArtifactIdFromPath(artifactPath, fallbackId);
    const parsedArtifactPath = path.parse(artifactPath.trim());
    const id = schemaBackedArtifactIds.has(inferredId) && parsedArtifactPath.ext.toLowerCase() !== '.json'
      ? fallbackId
      : inferredId;

    return {
      id,
      kind: inferArtifactKindFromPath(artifactPath),
      path: artifactPath,
      taskId
    };
  });
}

function mergeArtifactRefs(explicitArtifacts: ArtifactRef[], activityArtifacts: ArtifactRef[]): ArtifactRef[] {
  const mergedArtifacts = [...explicitArtifacts];
  const seenKeys = new Set(
    explicitArtifacts.map((artifact) => `${artifact.id}::${artifact.path}`.toLowerCase())
  );

  for (const artifact of activityArtifacts) {
    const artifactKey = `${artifact.id}::${artifact.path}`.toLowerCase();
    if (seenKeys.has(artifactKey)) {
      continue;
    }

    mergedArtifacts.push(artifact);
    seenKeys.add(artifactKey);
  }

  return mergedArtifacts;
}

export function normalizeAdapterErrors(errors: AdapterErrorLike[] | undefined, taskId: string): ErrorItem[] {
  return (errors ?? []).map((error) => ({
    code: error.code ?? error.type ?? 'adapter-error',
    message: error.message,
    taskId: error.taskId ?? taskId,
    ...(typeof error.recoverable === 'boolean' ? { recoverable: error.recoverable } : {})
  }));
}

function normalizeActivityList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean);
}

export function normalizeAdapterRunActivity(activity: unknown): AdapterRunActivity {
  const activityPayload = activity && typeof activity === 'object' ? activity as AdapterRunActivityLike : {};

  return {
    commands: normalizeActivityList(activityPayload.commands),
    editedFiles: normalizeActivityList(activityPayload.editedFiles),
    artifactFiles: normalizeActivityList(activityPayload.artifactFiles),
    collaborationActions: normalizeActivityList(activityPayload.collaborationActions)
  };
}

export function extractJsonPayload(content: string): string {
  const trimmed = content.trim();
  const firstObjectStart = trimmed.indexOf('{');
  const lastObjectEnd = trimmed.lastIndexOf('}');

  if (firstObjectStart === -1 || lastObjectEnd === -1 || lastObjectEnd < firstObjectStart) {
    return trimmed;
  }

  return trimmed.slice(firstObjectStart, lastObjectEnd + 1);
}

export function extractCopilotAssistantContent(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const events: any[] = [];

  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      return content;
    }
  }

  const assistantMessages = events.filter((event) => event?.type === 'assistant.message');
  const finalMessage = assistantMessages.at(-1)?.data?.content;

  if (typeof finalMessage === 'string' && finalMessage.trim()) {
    return finalMessage;
  }

  return content;
}

export function normalizeAdapterRunPayload(
  payload: unknown,
  adapterRuntimePayload: AdapterRuntimeDocument,
  claimPayload: TaskClaimPayload
): AdapterRunDocument {
  const claim = claimPayload.taskClaim;
  if (!claim) {
    fail('task claim is required to normalize adapter output');
  }

  if (!payload || typeof payload !== 'object') {
    fail('adapter output must be a JSON object or contain an adapterRun object');
  }

  const adapterPayload = payload as { adapterRun?: Record<string, any> } & Record<string, any>;
  const adapterRun = adapterPayload.adapterRun ?? adapterPayload;

  if (!adapterRun || typeof adapterRun !== 'object') {
    fail('adapter output must be a JSON object or contain an adapterRun object');
  }

  const repositoryRoot = inferRepositoryRoot(adapterRuntimePayload, claimPayload);
  const normalizedActivity = normalizeAdapterRunActivity(adapterRun.activity);
  normalizedActivity.editedFiles = normalizedActivity.editedFiles
    .map((filePath) => normalizeEditedFilePath(filePath, repositoryRoot))
    .filter((filePath): filePath is string => Boolean(filePath));
  const explicitArtifacts = normalizeAdapterArtifacts(adapterRun.artifacts, claim.taskId);
  const activityArtifacts = normalizeActivityArtifactFiles(normalizedActivity.artifactFiles, claim.taskId);
  normalizedActivity.editedFiles = filterEditedFilesThatAreArtifactOutputs(
    normalizedActivity.editedFiles,
    [
      ...normalizedActivity.artifactFiles,
      ...explicitArtifacts.map((artifact) => artifact.path),
      ...activityArtifacts.map((artifact) => artifact.path)
    ],
    repositoryRoot
  );

  const normalizedPayload: AdapterRunDocument = {
    adapterRun: {
      adapterName: adapterRun.adapterName ?? adapterRuntimePayload.adapterRuntime.name,
      provider: adapterRun.provider ?? adapterRuntimePayload.adapterRuntime.provider ?? 'external-adapter',
      taskId: adapterRun.taskId ?? claim.taskId,
      runId: adapterRun.runId ?? claim.runId,
      stage: adapterRun.stage ?? claim.stage,
      status: adapterRun.status ?? 'completed',
      summary: adapterRun.summary ?? `${claim.taskId}-completed`,
      notes: adapterRun.notes ?? [],
      activity: normalizedActivity,
      artifacts: mergeArtifactRefs(explicitArtifacts, activityArtifacts),
      errors: normalizeAdapterErrors(adapterRun.errors, claim.taskId)
    }
  };

  const validators = getSchemaValidators();
  const valid = validators.adapterRun(normalizedPayload);
  if (!valid) {
    fail(`adapter-run validation failed: ${JSON.stringify(validators.adapterRun.errors ?? [])}`);
  }

  return normalizedPayload;
}

export function readAdapterOutput(adapterRuntime: AdapterRuntime, templateContext: AdapterTemplateContext): unknown {
  if (adapterRuntime.outputMode === 'stdout') {
    fail('readAdapterOutput requires stdout content and should not be called directly for stdout mode');
  }

  const rawOutputPath = adapterRuntime.outputPath ?? templateContext.outputPath;
  if (!rawOutputPath) {
    fail('adapter runtime with outputMode=file requires outputPath or --adapter-output');
  }

  const outputPath = expandTemplateValue(rawOutputPath, templateContext);
  if (!outputPath) {
    fail('adapter runtime with outputMode=file requires outputPath or --adapter-output');
  }
  const resolvedOutputPath = resolveFromCwd(outputPath);
  if (!fileExists(resolvedOutputPath)) {
    fail(`adapter output file was not written: ${outputPath}`);
  }
  return readStructuredFile(outputPath);
}