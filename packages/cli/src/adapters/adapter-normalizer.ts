import { fail, fileExists, readStructuredFile, resolveFromCwd } from '../shared/fs-utils.js';
import type { AdapterRunDocument, AdapterRuntime, AdapterRuntimeDocument, ArtifactRef, ErrorItem, TaskClaimPayload } from '../types/index.js';

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
    runSessionKey: buildSessionKey(sessionNamespace),
    routeSessionKey: buildSessionKey(sessionNamespace, routeName),
    stageSessionKey: buildSessionKey(sessionNamespace, claim.stage ?? ''),
    executorSessionKey: buildSessionKey(sessionNamespace, claim.executorType ?? ''),
    routeExecutorSessionKey: buildSessionKey(sessionNamespace, routeName, claim.executorType ?? ''),
    taskSessionKey: buildSessionKey(sessionNamespace, claim.taskId ?? ''),
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

export function normalizeAdapterErrors(errors: AdapterErrorLike[] | undefined, taskId: string): ErrorItem[] {
  return (errors ?? []).map((error) => ({
    code: error.code ?? error.type ?? 'adapter-error',
    message: error.message,
    taskId: error.taskId ?? taskId,
    ...(typeof error.recoverable === 'boolean' ? { recoverable: error.recoverable } : {})
  }));
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

  return {
    adapterRun: {
      adapterName: adapterRun.adapterName ?? adapterRuntimePayload.adapterRuntime.name,
      provider: adapterRun.provider ?? adapterRuntimePayload.adapterRuntime.provider ?? 'external-adapter',
      taskId: adapterRun.taskId ?? claim.taskId,
      runId: adapterRun.runId ?? claim.runId,
      stage: adapterRun.stage ?? claim.stage,
      status: adapterRun.status ?? 'completed',
      summary: adapterRun.summary ?? `${claim.taskId}-completed`,
      notes: adapterRun.notes ?? [],
      artifacts: normalizeAdapterArtifacts(adapterRun.artifacts, claim.taskId),
      errors: normalizeAdapterErrors(adapterRun.errors, claim.taskId)
    }
  };
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