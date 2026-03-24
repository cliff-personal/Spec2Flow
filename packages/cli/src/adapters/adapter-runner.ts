import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  ensureDirForFile,
  fail,
  loadOptionalStructuredFile,
  loadOptionalStructuredFileFrom,
  readStructuredFile,
  resolveFromBaseDir,
  resolveFromCwd,
  writeJsonFrom
} from '../shared/fs-utils.js';
import { applyTaskResult } from '../runtime/task-result-service.js';
import { getSchemaValidators } from '../shared/schema-registry.js';
import {
  buildAdapterTemplateContext,
  extractCopilotAssistantContent,
  extractJsonPayload,
  expandTemplateValue,
  normalizeAdapterRunPayload,
  readAdapterOutput
} from './adapter-normalizer.js';
import { resolveAdapterRuntimeForStage } from './adapter-runtime-resolver.js';
import type {
  AdapterRunDocument,
  AdapterRuntimeDocument,
  ExecutionStateDocument,
  ExecutionStatus,
  ModelAdapterCapability,
  TaskClaimPayload,
  TaskGraphDocument,
  TaskExecutionResult,
  TaskStage
} from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

interface AdapterCapabilityDocument {
  adapter?: ModelAdapterCapability;
}

export interface AdapterRunnerDependencies {
  validateAdapterRuntimePayload: (payload: AdapterRuntimeDocument, runtimePath: string) => void;
  sanitizeStageName: (stage: string) => string;
  getRouteNameFromTaskId: (taskId: string | null | undefined) => string;
  parseCsvOption: (value: string | undefined) => string[];
}

export interface SimulatedAdapterOptions {
  sanitizeStageName: (stage: string) => string;
  getRouteNameFromTaskId: (taskId: string | null | undefined) => string;
  parseCsvOption: (value: string | undefined) => string[];
  adapter?: string;
  summary?: string;
  notes?: string;
  'result-status'?: string;
}

const repoMutationCommandPattern = /^(?:git\s+(?:add|commit|push|merge|rebase|reset|checkout)\b|gh\s+pr\b)/i;

type ImplementationChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

function normalizeCommandValue(command: string): string {
  return command.trim().replaceAll(/\s+/g, ' ').toLowerCase();
}

function stripLeadingCwdChange(command: string): string {
  let normalizedCommand = command.trim();
  let previousCommand = '';

  while (normalizedCommand !== previousCommand) {
    previousCommand = normalizedCommand;
    normalizedCommand = normalizedCommand.replace(/^cd\s+.+?\s*&&\s*/is, '').trim();
  }

  return normalizedCommand;
}

function matchesAllowedCommand(command: string, allowedCommands: string[]): boolean {
  const normalizedCommand = normalizeCommandValue(command);
  const normalizedStrippedCommand = normalizeCommandValue(stripLeadingCwdChange(command));

  return allowedCommands.some((allowedCommand) => {
    const normalizedAllowedCommand = normalizeCommandValue(allowedCommand);
    return normalizedCommand === normalizedAllowedCommand
      || normalizedCommand.startsWith(`${normalizedAllowedCommand} `)
      || normalizedStrippedCommand === normalizedAllowedCommand
      || normalizedStrippedCommand.startsWith(`${normalizedAllowedCommand} `);
  });
}

function isAllowedArtifactSupportCommand(command: string, artifactPaths: string[]): boolean {
  if (artifactPaths.length === 0) {
    return false;
  }

  const commandWithoutCwd = stripLeadingCwdChange(command);
  const segments = commandWithoutCwd
    .split(/&&/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return false;
  }

  const normalizedArtifactPaths = artifactPaths.map((artifactPath) => normalizeCommandValue(artifactPath));

  return segments.every((segment) => {
    const normalizedSegment = normalizeCommandValue(segment);
    if (/^mkdir\s+-p\s+/i.test(segment)) {
      return true;
    }

    const referencesArtifactPath = normalizedArtifactPaths.some((artifactPath) => normalizedSegment.includes(artifactPath));
    if (!referencesArtifactPath) {
      return false;
    }

    return />|>>|\btee\b/i.test(segment);
  });
}

function collectCapabilityViolations(claim: NonNullable<TaskClaimPayload['taskClaim']>, runOutput: AdapterRunDocument): string[] {
  const { roleProfile, taskId } = claim;
  const { activity } = runOutput.adapterRun;
  const violations: string[] = [];

  if (!roleProfile.canRunCommands && activity.commands.length > 0) {
    violations.push(`task ${taskId} reported shell commands while role profile ${roleProfile.profileId} forbids command execution`);
  }

  if (!roleProfile.canEditFiles && activity.editedFiles.length > 0) {
    violations.push(`task ${taskId} reported file edits while role profile ${roleProfile.profileId} forbids repository edits`);
  }

  if (!roleProfile.canWriteArtifacts && activity.artifactFiles.length > 0) {
    violations.push(`task ${taskId} reported artifact writes while role profile ${roleProfile.profileId} forbids artifact output`);
  }

  if (!roleProfile.canOpenCollaboration && activity.collaborationActions.length > 0) {
    violations.push(`task ${taskId} reported collaboration actions while role profile ${roleProfile.profileId} forbids collaboration side effects`);
  }

  return violations;
}

function collectNonePolicyViolations(claim: NonNullable<TaskClaimPayload['taskClaim']>, runOutput: AdapterRunDocument): string[] {
  const { taskId } = claim;
  const { activity } = runOutput.adapterRun;

  return activity.commands.length > 0 ? [`task ${taskId} used shell commands under command policy none`] : [];
}

function collectCollaborationOnlyViolations(claim: NonNullable<TaskClaimPayload['taskClaim']>, runOutput: AdapterRunDocument): string[] {
  const { taskId } = claim;
  const { activity } = runOutput.adapterRun;
  const violations: string[] = [];

  if (activity.commands.length > 0) {
    violations.push(`task ${taskId} used shell commands under collaboration-only policy`);
  }

  if (activity.editedFiles.length > 0) {
    violations.push(`task ${taskId} edited repository files under collaboration-only policy`);
  }

  return violations;
}

function collectAllowlistedCommandViolations(claim: NonNullable<TaskClaimPayload['taskClaim']>, runOutput: AdapterRunDocument): string[] {
  const { roleProfile, repositoryContext, taskId } = claim;
  const { activity } = runOutput.adapterRun;
  const allowedCommands = repositoryContext.verifyCommands ?? [];
  const artifactPaths = [
    ...activity.artifactFiles,
    ...runOutput.adapterRun.artifacts.map((artifact) => artifact.path)
  ];
  const violations: string[] = [];

  if (allowedCommands.length === 0 && activity.commands.length > 0) {
    violations.push(`task ${taskId} reported shell commands but no allowlisted verify commands exist for ${roleProfile.commandPolicy}`);
    return violations;
  }

  const disallowedCommands = activity.commands.filter(
    (command) => !matchesAllowedCommand(command, allowedCommands) && !isAllowedArtifactSupportCommand(command, artifactPaths)
  );
  return disallowedCommands.map(
    (command) => `task ${taskId} used non-allowlisted command under ${roleProfile.commandPolicy}: ${command}`
  );
}

function collectSafeRepoCommandViolations(claim: NonNullable<TaskClaimPayload['taskClaim']>, runOutput: AdapterRunDocument): string[] {
  const { taskId } = claim;
  const { activity } = runOutput.adapterRun;

  return activity.commands
    .filter((command) => repoMutationCommandPattern.test(command.trim()))
    .map((command) => `task ${taskId} used blocked repository mutation command under safe-repo-commands: ${command}`);
}

function collectCommandPolicyViolations(claim: NonNullable<TaskClaimPayload['taskClaim']>, runOutput: AdapterRunDocument): string[] {
  const { commandPolicy } = claim.roleProfile;

  switch (commandPolicy) {
    case 'none':
      return collectNonePolicyViolations(claim, runOutput);
    case 'collaboration-only':
      return collectCollaborationOnlyViolations(claim, runOutput);
    case 'bootstrap-only':
    case 'verification-only':
      return collectAllowlistedCommandViolations(claim, runOutput);
    case 'safe-repo-commands':
      return collectSafeRepoCommandViolations(claim, runOutput);
    default:
      return [];
  }
}

function collectRolePolicyViolations(claim: NonNullable<TaskClaimPayload['taskClaim']>, runOutput: AdapterRunDocument): string[] {
  return [
    ...collectCapabilityViolations(claim, runOutput),
    ...collectCommandPolicyViolations(claim, runOutput)
  ];
}

function applyRolePolicyToRunOutput(
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  runOutput: AdapterRunDocument
): AdapterRunDocument {
  const violations = collectRolePolicyViolations(claim, runOutput);

  if (violations.length === 0) {
    return runOutput;
  }

  return {
    adapterRun: {
      ...runOutput.adapterRun,
      status: 'failed',
      summary: `role policy violation for ${claim.taskId}`,
      notes: [
        ...runOutput.adapterRun.notes,
        'role-policy:failed',
        ...violations.map((violation) => `policy-violation:${violation}`)
      ],
      errors: [
        ...runOutput.adapterRun.errors,
        ...violations.map((violation) => ({
          code: 'role-policy-violation',
          message: violation,
          taskId: claim.taskId,
          recoverable: false
        }))
      ]
    }
  };
}

function normalizeArtifactSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function hasArtifactReference(artifacts: AdapterRunDocument['adapterRun']['artifacts'], expectedArtifact: string): boolean {
  const normalizedExpectedArtifact = normalizeArtifactSearchValue(expectedArtifact);

  return artifacts.some((artifact) => {
    const searchableValues = [artifact.id, artifact.kind, artifact.path]
      .map((value) => normalizeArtifactSearchValue(String(value)));
    return searchableValues.some((value) => value.includes(normalizedExpectedArtifact));
  });
}

function isStructuredJsonArtifactFor(artifact: AdapterRunDocument['adapterRun']['artifacts'][number], expectedArtifact: string): boolean {
  const normalizedExpectedArtifact = normalizeArtifactSearchValue(expectedArtifact);
  const artifactPath = String(artifact.path ?? '').trim();
  const parsedArtifactPath = path.parse(artifactPath);
  const searchableValues = [artifact.id, parsedArtifactPath.base, parsedArtifactPath.name]
    .map((value) => normalizeArtifactSearchValue(String(value)));

  if (parsedArtifactPath.ext.toLowerCase() !== '.json') {
    return false;
  }

  return searchableValues.some((value) => value.includes(normalizedExpectedArtifact));
}

function hasStructuredArtifactReference(artifacts: AdapterRunDocument['adapterRun']['artifacts'], expectedArtifact: string): boolean {
  return artifacts.some((artifact) => isStructuredJsonArtifactFor(artifact, expectedArtifact));
}

function findStructuredArtifactReference(
  artifacts: AdapterRunDocument['adapterRun']['artifacts'],
  expectedArtifact: string
): AdapterRunDocument['adapterRun']['artifacts'][number] | undefined {
  return artifacts.find((artifact) => isStructuredJsonArtifactFor(artifact, expectedArtifact));
}

function normalizeStringList(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const normalizedValues = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  return normalizedValues.length > 0 ? normalizedValues : undefined;
}

function getObjectStringProperty(value: unknown, propertyName: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const propertyValue = (value as Record<string, unknown>)[propertyName];
  return typeof propertyValue === 'string' && propertyValue.trim() ? propertyValue.trim() : undefined;
}

function buildRequirementsSummaryPayload(
  deliverablePayload: Record<string, unknown>,
  claim: NonNullable<TaskClaimPayload['taskClaim']>
): Record<string, unknown> {
  const deliverableSources = normalizeStringList(deliverablePayload.sources);
  const fallbackSources = [
    claim.repositoryContext.requirementRef,
    claim.repositoryContext.projectAdapterRef,
    claim.repositoryContext.topologyRef,
    claim.repositoryContext.riskPolicyRef,
    claim.runtimeContext.taskGraphRef,
    claim.runtimeContext.executionStateRef
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const deliverableScope = deliverablePayload.scope;
  const deliverableScopeSummary = getObjectStringProperty(deliverableScope, 'summary');
  const inferredSummary = typeof deliverablePayload.summary === 'string' && deliverablePayload.summary.trim()
    ? deliverablePayload.summary.trim()
    : deliverableScopeSummary
      ? deliverableScopeSummary
      : claim.goal;
  const impactedServices = Array.isArray(deliverablePayload.impactedServices)
    ? deliverablePayload.impactedServices
        .filter((service): service is Record<string, unknown> => Boolean(service) && typeof service === 'object' && !Array.isArray(service))
        .map((service) => {
          const name = typeof service.name === 'string' && service.name.trim()
            ? service.name.trim()
            : typeof service.service === 'string' && service.service.trim()
              ? service.service.trim()
              : '';
          const role = typeof service.role === 'string' && service.role.trim() ? service.role.trim() : undefined;
          const impact = normalizeStringList(service.impact)
            ?? (typeof service.impact === 'string' && service.impact.trim() ? [service.impact.trim()] : undefined);

          if (!name) {
            return null;
          }

          return {
            name,
            ...(role ? { role } : {}),
            ...(impact ? { impact } : {})
          };
        })
        .filter((service): service is { name: string; role?: string; impact?: string[] } => Boolean(service))
    : undefined;
  const acceptanceCriteria = normalizeStringList(deliverablePayload.acceptanceCriteria);
  const constraints = normalizeStringList(deliverablePayload.constraints);
  const routeName = typeof deliverablePayload.routeName === 'string' && deliverablePayload.routeName.trim()
    ? deliverablePayload.routeName.trim()
    : claim.taskId.split('--')[0] ?? '';

  return {
    taskId: claim.taskId,
    stage: 'requirements-analysis',
    goal: claim.goal,
    summary: inferredSummary,
    sources: deliverableSources ?? fallbackSources,
    ...(routeName ? { routeName } : {}),
    ...(impactedServices && impactedServices.length > 0 ? { impactedServices } : {}),
    ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
    ...(constraints ? { constraints } : {})
  };
}

function isValidRequirementSummaryPayload(payload: unknown): boolean {
  const validators = getSchemaValidators();
  return validators.requirementSummary(payload);
}

function inferRepositoryRoot(
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  adapterRuntimePayload: AdapterRuntimeDocument | null
): string {
  const runtimeCwd = adapterRuntimePayload?.adapterRuntime.cwd?.trim();
  if (runtimeCwd) {
    return path.resolve(runtimeCwd);
  }

  const projectAdapterRef = claim.repositoryContext.projectAdapterRef?.trim();
  if (projectAdapterRef) {
    const resolvedProjectAdapterRef = resolveFromCwd(projectAdapterRef);
    return path.resolve(path.dirname(resolvedProjectAdapterRef), '..');
  }

  return process.cwd();
}

function runGitCommand(repositoryRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8'
    });
  } catch (error) {
    const commandError = error as { status?: number; stdout?: { toString(): string } };
    if (commandError.status === 1) {
      return commandError.stdout?.toString() ?? '';
    }

    return null;
  }
}

function inferImplementationChangeTypes(repositoryRoot: string, editedFiles: string[]): Map<string, ImplementationChangeType> {
  const changeTypes = new Map<string, ImplementationChangeType>();
  const trackedDiffOutput = runGitCommand(repositoryRoot, ['--no-pager', 'diff', '--name-status', '--', ...editedFiles]);
  const stagedDiffOutput = runGitCommand(repositoryRoot, ['--no-pager', 'diff', '--cached', '--name-status', '--', ...editedFiles]);
  const statusOutput = runGitCommand(repositoryRoot, ['status', '--short', '--', ...editedFiles]);

  const applyNameStatusOutput = (output: string | null): void => {
    if (!output) {
      return;
    }

    for (const line of output.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }

      const parts = trimmedLine.split(/\s+/);
      const status = parts[0] ?? '';
      const targetPath = parts.length >= 3 && /^R\d+$/i.test(status)
        ? parts[2]
        : parts[1];

      if (!targetPath) {
        continue;
      }

      const normalizedTargetPath = targetPath.replaceAll('\\', '/');
      if (status.startsWith('A')) {
        changeTypes.set(normalizedTargetPath, 'added');
      } else if (status.startsWith('D')) {
        changeTypes.set(normalizedTargetPath, 'deleted');
      } else if (status.startsWith('R')) {
        changeTypes.set(normalizedTargetPath, 'renamed');
      } else {
        changeTypes.set(normalizedTargetPath, 'modified');
      }
    }
  };

  applyNameStatusOutput(trackedDiffOutput);
  applyNameStatusOutput(stagedDiffOutput);

  if (statusOutput) {
    for (const line of statusOutput.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }

      const status = trimmedLine.slice(0, 2);
      const targetPath = trimmedLine.slice(3).trim().replaceAll('\\', '/');
      if (!targetPath || changeTypes.has(targetPath)) {
        continue;
      }

      if (status === '??') {
        changeTypes.set(targetPath, 'added');
      } else if (status.includes('D')) {
        changeTypes.set(targetPath, 'deleted');
      } else if (status.includes('R')) {
        changeTypes.set(targetPath, 'renamed');
      } else {
        changeTypes.set(targetPath, 'modified');
      }
    }
  }

  return changeTypes;
}

function buildCodeDiffPatch(repositoryRoot: string, editedFiles: string[]): string | null {
  const patchParts: string[] = [];
  const trackedDiffOutput = runGitCommand(repositoryRoot, ['--no-pager', 'diff', '--', ...editedFiles]);
  const stagedDiffOutput = runGitCommand(repositoryRoot, ['--no-pager', 'diff', '--cached', '--', ...editedFiles]);

  if (trackedDiffOutput) {
    patchParts.push(trackedDiffOutput.trimEnd());
  }

  if (stagedDiffOutput) {
    patchParts.push(stagedDiffOutput.trimEnd());
  }

  const untrackedOutput = runGitCommand(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '--', ...editedFiles]);
  if (untrackedOutput) {
    for (const filePath of untrackedOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      const untrackedDiff = runGitCommand(repositoryRoot, ['--no-pager', 'diff', '--no-index', '--', '/dev/null', filePath]);
      if (untrackedDiff) {
        patchParts.push(untrackedDiff.trimEnd());
      }
    }
  }

  const combinedPatch = patchParts.filter(Boolean).join('\n');
  return combinedPatch || null;
}

function enrichCodeImplementationRunOutput(
  runOutput: AdapterRunDocument,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  adapterRuntimePayload: AdapterRuntimeDocument | null
): AdapterRunDocument {
  if (claim.stage !== 'code-implementation') {
    return runOutput;
  }

  const artifactsDir = claim.runtimeContext.artifactsDir?.trim();
  const editedFiles = Array.from(new Set(runOutput.adapterRun.activity.editedFiles.map((filePath) => filePath.trim()).filter(Boolean)));
  if (!artifactsDir || editedFiles.length === 0) {
    return runOutput;
  }

  const repositoryRoot = inferRepositoryRoot(claim, adapterRuntimePayload);
  const artifacts = [...runOutput.adapterRun.artifacts];
  const notes = [...runOutput.adapterRun.notes];
  const errors = [...runOutput.adapterRun.errors];
  const changeTypes = inferImplementationChangeTypes(repositoryRoot, editedFiles);

  if (!hasArtifactReference(artifacts, 'implementation-summary')) {
    const implementationSummaryPath = path.join(artifactsDir, 'implementation-summary.json');
    writeJsonFrom(repositoryRoot, implementationSummaryPath, {
      generatedAt: new Date().toISOString(),
      taskId: claim.taskId,
      stage: 'code-implementation',
      goal: claim.goal,
      summary: runOutput.adapterRun.summary,
      changedFiles: editedFiles.map((filePath) => ({
        path: filePath,
        changeType: changeTypes.get(filePath) ?? 'modified'
      })),
      validationCommands: runOutput.adapterRun.activity.commands.length > 0 ? runOutput.adapterRun.activity.commands : undefined
    });
    artifacts.push({
      id: 'implementation-summary',
      kind: 'report',
      path: implementationSummaryPath,
      taskId: claim.taskId
    });
    notes.push('controller-generated:implementation-summary');
  }

  if (!hasArtifactReference(artifacts, 'code-diff')) {
    const codeDiffPatch = buildCodeDiffPatch(repositoryRoot, editedFiles);
    if (codeDiffPatch) {
      const codeDiffPath = path.join(artifactsDir, 'code-diff.patch');
      const resolvedCodeDiffPath = resolveFromBaseDir(repositoryRoot, codeDiffPath);
      ensureDirForFile(resolvedCodeDiffPath);
      fs.writeFileSync(resolvedCodeDiffPath, `${codeDiffPatch}\n`, 'utf8');
      artifacts.push({
        id: 'code-diff',
        kind: 'diff',
        path: codeDiffPath,
        taskId: claim.taskId
      });
      notes.push('controller-generated:code-diff');
    } else {
      errors.push({
        code: 'controller-code-diff-unavailable',
        message: `Unable to synthesize code-diff for ${claim.taskId} from repository changes.`,
        taskId: claim.taskId,
        recoverable: true
      });
    }
  }

  return {
    adapterRun: {
      ...runOutput.adapterRun,
      notes,
      artifacts,
      errors
    }
  };
}

function extractModelOutputDeliverablePayloadFrom(
  runOutput: AdapterRunDocument,
  repositoryRoot: string | undefined
): Record<string, unknown> | null {
  const modelOutputArtifact = runOutput.adapterRun.artifacts.find((artifact) => artifact.id.endsWith('-model-output'));
  if (!modelOutputArtifact) {
    return null;
  }

  const modelOutputPayload = loadOptionalStructuredFileFrom<{
    deliverable?: Record<string, unknown>;
  }>(repositoryRoot, modelOutputArtifact.path);
  const deliverable = modelOutputPayload?.deliverable;

  if (!deliverable || typeof deliverable !== 'object' || Array.isArray(deliverable)) {
    return null;
  }

  return deliverable;
}

function enrichRequirementsAnalysisRunOutput(
  runOutput: AdapterRunDocument,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  adapterRuntimePayload: AdapterRuntimeDocument | null
): AdapterRunDocument {
  if (claim.stage !== 'requirements-analysis') {
    return runOutput;
  }

  const artifactsDir = claim.runtimeContext.artifactsDir?.trim();
  if (!artifactsDir) {
    return runOutput;
  }

  const repositoryRoot = inferRepositoryRoot(claim, adapterRuntimePayload);

  const existingRequirementsSummaryArtifact = findStructuredArtifactReference(runOutput.adapterRun.artifacts, 'requirements-summary');
  if (existingRequirementsSummaryArtifact) {
    const existingPayload = loadOptionalStructuredFileFrom(repositoryRoot, existingRequirementsSummaryArtifact.path);
    if (existingPayload && isValidRequirementSummaryPayload(existingPayload)) {
      return runOutput;
    }
  }

  const deliverablePayload = extractModelOutputDeliverablePayloadFrom(runOutput, repositoryRoot);
  if (!deliverablePayload) {
    return runOutput;
  }

  const requirementsSummaryPath = existingRequirementsSummaryArtifact?.path ?? path.join(artifactsDir, 'requirements-summary.json');
  writeJsonFrom(repositoryRoot, requirementsSummaryPath, buildRequirementsSummaryPayload(deliverablePayload, claim));

  const notes = [
    ...runOutput.adapterRun.notes,
    existingRequirementsSummaryArtifact
      ? 'controller-normalized:requirements-summary'
      : 'controller-generated:requirements-summary'
  ];
  const artifacts: AdapterRunDocument['adapterRun']['artifacts'] = existingRequirementsSummaryArtifact
    ? runOutput.adapterRun.artifacts
    : [
        ...runOutput.adapterRun.artifacts,
        {
          id: 'requirements-summary',
          kind: 'report',
          path: requirementsSummaryPath,
          taskId: claim.taskId
        }
      ];

  return {
    adapterRun: {
      ...runOutput.adapterRun,
      notes,
      artifacts
    }
  };
}

function extractCollaborationHandoffPayloadFrom(
  runOutput: AdapterRunDocument,
  repositoryRoot: string | undefined
): {
  handoff: Record<string, unknown>;
  handoffArtifactPath?: string;
} | null {
  const modelOutputArtifact = runOutput.adapterRun.artifacts.find((artifact) => artifact.id.endsWith('-model-output'));
  if (!modelOutputArtifact) {
    return null;
  }

  const modelOutputPayload = loadOptionalStructuredFileFrom<{
    deliverable?: {
      handoff?: Record<string, unknown>;
      handoffArtifactPath?: string;
    };
  }>(repositoryRoot, modelOutputArtifact.path);
  const handoff = modelOutputPayload?.deliverable?.handoff;

  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    return null;
  }

  const handoffArtifactPath = modelOutputPayload?.deliverable?.handoffArtifactPath;

  return handoffArtifactPath
    ? {
        handoff,
        handoffArtifactPath
      }
    : {
        handoff
      };
}

function enrichCollaborationRunOutput(
  runOutput: AdapterRunDocument,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  adapterRuntimePayload: AdapterRuntimeDocument | null
): AdapterRunDocument {
  if (claim.stage !== 'collaboration') {
    return runOutput;
  }

  const artifactsDir = claim.runtimeContext.artifactsDir?.trim();
  if (!artifactsDir || hasArtifactReference(runOutput.adapterRun.artifacts, 'collaboration-handoff')) {
    return runOutput;
  }

  const repositoryRoot = inferRepositoryRoot(claim, adapterRuntimePayload);

  const collaborationPayload = extractCollaborationHandoffPayloadFrom(runOutput, repositoryRoot);
  if (!collaborationPayload) {
    return runOutput;
  }

  const collaborationHandoffPath = collaborationPayload.handoffArtifactPath?.trim() || path.join(artifactsDir, 'collaboration-handoff.json');
  writeJsonFrom(repositoryRoot, collaborationHandoffPath, collaborationPayload.handoff);

  const notes = [
    ...runOutput.adapterRun.notes,
    'controller-generated:collaboration-handoff'
  ];
  const remainingErrors = runOutput.adapterRun.errors.filter((error) => error.code !== 'artifact-write-blocked');
  const recoveredFromArtifactWriteBlock = runOutput.adapterRun.errors.length > 0
    && remainingErrors.length === 0
    && runOutput.adapterRun.errors.every((error) => error.code === 'artifact-write-blocked');

  if (recoveredFromArtifactWriteBlock) {
    notes.push('controller-recovered:artifact-write-blocked');
  }

  const handoffSummary = typeof collaborationPayload.handoff.summary === 'string'
    ? collaborationPayload.handoff.summary
    : runOutput.adapterRun.summary;

  return {
    adapterRun: {
      ...runOutput.adapterRun,
      status: recoveredFromArtifactWriteBlock && runOutput.adapterRun.status === 'blocked'
        ? 'completed'
        : runOutput.adapterRun.status,
      summary: recoveredFromArtifactWriteBlock && runOutput.adapterRun.status === 'blocked'
        ? handoffSummary
        : runOutput.adapterRun.summary,
      notes,
      artifacts: [
        ...runOutput.adapterRun.artifacts,
        {
          id: 'collaboration-handoff',
          kind: 'report',
          path: collaborationHandoffPath,
          taskId: claim.taskId
        }
      ],
      errors: remainingErrors
    }
  };
}

function buildAdapterTimeoutMessage(timeout: number | undefined): string {
  return timeout === undefined
    ? 'Adapter runtime exceeded timeout.'
    : `Adapter runtime exceeded timeout of ${timeout}ms.`;
}

function buildAdapterTimeoutRunOutput(
  adapterRuntimePayload: AdapterRuntimeDocument,
  claimPayload: TaskClaimPayload,
  timeout: number | undefined
): AdapterRunDocument {
  return normalizeAdapterRunPayload({
    adapterRun: {
      status: 'failed',
      summary: `adapter runtime timed out for ${claimPayload.taskClaim?.taskId ?? 'task'}`,
      notes: [
        `adapter-timeout-ms:${timeout ?? 'unknown'}`
      ],
      activity: {
        commands: [],
        editedFiles: [],
        artifactFiles: [],
        collaborationActions: []
      },
      artifacts: [],
      errors: [
        {
          code: 'adapter-runtime-timeout',
          message: buildAdapterTimeoutMessage(timeout),
          taskId: claimPayload.taskClaim?.taskId,
          recoverable: true
        }
      ]
    }
  }, adapterRuntimePayload, claimPayload);
}

function parseAdapterStdoutPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    fail('adapter command returned empty stdout; expected JSON output');
  }

  try {
    const assistantContent = extractCopilotAssistantContent(trimmed);
    return JSON.parse(extractJsonPayload(assistantContent));
  } catch (error) {
    const parseError = error as { message?: string };
    fail(`adapter stdout is not valid JSON: ${parseError.message ?? 'unknown error'}`);
  }
}

export function buildSimulatedAdapterOutput(
  claimPayload: TaskClaimPayload,
  adapterCapabilityPayload: AdapterCapabilityDocument | null | undefined,
  options: SimulatedAdapterOptions
): AdapterRunDocument {
  const claim = claimPayload.taskClaim;
  if (!claim) {
    fail('task claim is required to build simulated adapter output');
  }
  const stageName = options.sanitizeStageName(claim.stage);
  const routeName = options.getRouteNameFromTaskId(claim.taskId);
  const adapterName = adapterCapabilityPayload?.adapter?.name ?? options.adapter ?? 'simulated-adapter';
  const outputPath = `spec2flow/outputs/execution/${routeName}/${stageName}-output.json`;
  const artifactId = `${claim.taskId}-${stageName}-output`;
  const summary = options.summary ?? `simulated-${claim.stage}-completed`;
  const requestedResultStatus = options['result-status'];
  const resultStatus =
    requestedResultStatus === 'pending' ||
    requestedResultStatus === 'ready' ||
    requestedResultStatus === 'in-progress' ||
    requestedResultStatus === 'blocked' ||
    requestedResultStatus === 'completed' ||
    requestedResultStatus === 'failed' ||
    requestedResultStatus === 'skipped'
      ? requestedResultStatus
      : undefined;

  return {
    adapterRun: {
      adapterName,
      provider: adapterCapabilityPayload?.adapter?.provider ?? 'simulation',
      taskId: claim.taskId,
      runId: claim.runId,
      stage: claim.stage,
      status: resultStatus ?? 'completed',
      summary,
      notes: [
        `simulated-adapter:${adapterName}`,
        `simulated-stage:${claim.stage}`,
        ...options.parseCsvOption(options.notes)
      ],
      activity: {
        commands: [],
        editedFiles: [],
        artifactFiles: [outputPath],
        collaborationActions: []
      },
      artifacts: [
        {
          id: artifactId,
          kind: 'report',
          path: outputPath,
          taskId: claim.taskId
        }
      ],
      errors: []
    }
  };
}

export function runExternalAdapter(
  adapterRuntimePayload: AdapterRuntimeDocument,
  claimPayload: TaskClaimPayload,
  statePath: string,
  taskGraphPath: string,
  options: Record<string, any> = {}
): AdapterRunDocument {
  const adapterRuntime = adapterRuntimePayload.adapterRuntime;
  const templateContext = buildAdapterTemplateContext(claimPayload, statePath, taskGraphPath, {
    ...options,
    adapterRuntimePayload
  });
  const command = expandTemplateValue(adapterRuntime.command, templateContext);
  const args = (adapterRuntime.args ?? []).map((arg) => expandTemplateValue(arg, templateContext));
  const env = {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(adapterRuntime.env ?? {}).map(([key, value]) => [key, expandTemplateValue(value, templateContext)])
    )
  };
  const cwd = adapterRuntime.cwd ? resolveFromCwd(expandTemplateValue(adapterRuntime.cwd, templateContext)) : process.cwd();
  const timeout = typeof adapterRuntime.timeoutMs === 'number' && adapterRuntime.timeoutMs > 0
    ? adapterRuntime.timeoutMs
    : undefined;

  let stdout = '';

  try {
    stdout = execFileSync(command, args, {
      cwd,
      env,
      encoding: 'utf8',
      input: `${JSON.stringify(claimPayload, null, 2)}\n`,
      ...(timeout === undefined ? {} : { timeout }),
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    const commandError = error as {
      code?: string;
      killed?: boolean;
      signal?: string;
      stderr?: { toString(): string };
      stdout?: { toString(): string };
      message?: string;
    };
    if (commandError.code === 'ETIMEDOUT' || commandError.killed === true || commandError.signal === 'SIGTERM') {
      return buildAdapterTimeoutRunOutput(adapterRuntimePayload, claimPayload, timeout);
    }

    const stderr = commandError.stderr?.toString().trim();
    const stdoutText = commandError.stdout?.toString().trim();
    fail(`adapter command failed: ${stderr || stdoutText || commandError.message}`);
  }

  let adapterOutputPayload: unknown;

  if (adapterRuntime.outputMode === 'stdout') {
    adapterOutputPayload = parseAdapterStdoutPayload(stdout);
  } else {
    adapterOutputPayload = readAdapterOutput(adapterRuntime, templateContext);
  }

  return normalizeAdapterRunPayload(adapterOutputPayload, adapterRuntimePayload, claimPayload);
}

export function executeTaskRun(
  statePath: string,
  taskGraphPath: string,
  claimPayload: TaskClaimPayload,
  options: CliOptions,
  dependencies: AdapterRunnerDependencies
): TaskExecutionResult {
  const { validateAdapterRuntimePayload, sanitizeStageName, getRouteNameFromTaskId, parseCsvOption } = dependencies;
  const resolvedOptions = options ?? {};
  const executionStatePayload = readStructuredFile(statePath) as ExecutionStateDocument;
  const taskGraphPayload = readStructuredFile(taskGraphPath) as TaskGraphDocument;
  const adapterCapabilityPayload = loadOptionalStructuredFile<AdapterCapabilityDocument>(
    typeof resolvedOptions['adapter-capability'] === 'string' ? resolvedOptions['adapter-capability'] : undefined
  );
  const claim = claimPayload.taskClaim;

  if (!claim) {
    fail('execute-task-run requires a task claim payload');
  }

  const adapterRuntimePath = typeof resolvedOptions['adapter-runtime'] === 'string' ? resolvedOptions['adapter-runtime'] : null;
  const adapterRuntimeSelection = adapterRuntimePath
    ? (() => {
        const rootRuntimePayload = readStructuredFile(adapterRuntimePath) as AdapterRuntimeDocument;
        validateAdapterRuntimePayload(rootRuntimePayload, adapterRuntimePath);
        return resolveAdapterRuntimeForStage(adapterRuntimePath, rootRuntimePayload, claim.stage, {
          readStructuredFile,
          validateAdapterRuntimePayload
        });
      })()
    : null;
  const adapterRuntimePayload = adapterRuntimeSelection?.runtimePayload ?? null;

  const executor = typeof resolvedOptions.executor === 'string' ? resolvedOptions.executor : undefined;
  const workflowStatus: ExecutionStatus | undefined =
    resolvedOptions.status === 'pending' ||
    resolvedOptions.status === 'running' ||
    resolvedOptions.status === 'blocked' ||
    resolvedOptions.status === 'completed' ||
    resolvedOptions.status === 'failed' ||
    resolvedOptions.status === 'cancelled'
      ? resolvedOptions.status
      : undefined;
  const currentStage: TaskStage | undefined =
    resolvedOptions.stage === 'environment-preparation' ||
    resolvedOptions.stage === 'requirements-analysis' ||
    resolvedOptions.stage === 'code-implementation' ||
    resolvedOptions.stage === 'test-design' ||
    resolvedOptions.stage === 'automated-execution' ||
    resolvedOptions.stage === 'defect-feedback' ||
    resolvedOptions.stage === 'collaboration'
      ? resolvedOptions.stage
      : undefined;
  const runOutput = adapterRuntimePayload
    ? runExternalAdapter(adapterRuntimePayload, claimPayload, statePath, taskGraphPath, {
        ...resolvedOptions,
        getRouteNameFromTaskId
      })
    : buildSimulatedAdapterOutput(claimPayload, adapterCapabilityPayload, {
        ...resolvedOptions,
        sanitizeStageName,
        getRouteNameFromTaskId,
        parseCsvOption
      });
  const requirementsEnrichedRunOutput = enrichRequirementsAnalysisRunOutput(runOutput, claim, adapterRuntimePayload);
  const implementationEnrichedRunOutput = enrichCodeImplementationRunOutput(requirementsEnrichedRunOutput, claim, adapterRuntimePayload);
  const collaborationEnrichedRunOutput = enrichCollaborationRunOutput(implementationEnrichedRunOutput, claim, adapterRuntimePayload);
  const validatedRunOutput = applyRolePolicyToRunOutput(claim, collaborationEnrichedRunOutput);

  const receipt = applyTaskResult(executionStatePayload, taskGraphPayload, statePath, {
    taskId: claim.taskId,
    taskStatus: validatedRunOutput.adapterRun.status,
    notes: [`summary:${validatedRunOutput.adapterRun.summary}`, ...validatedRunOutput.adapterRun.notes],
    artifacts: validatedRunOutput.adapterRun.artifacts,
    errors: validatedRunOutput.adapterRun.errors,
    ...(executor === undefined ? {} : { executor }),
    ...(workflowStatus === undefined ? {} : { workflowStatus }),
    ...(currentStage === undefined ? {} : { currentStage })
  });

  return {
    adapterRun: validatedRunOutput.adapterRun,
    receipt: receipt.taskResult,
    mode: adapterRuntimePayload ? 'external-adapter' : 'simulation'
  };
}