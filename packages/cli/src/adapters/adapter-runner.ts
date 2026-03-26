import { execFileSync, spawn } from 'node:child_process';
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
import { resolveEvaluationRepairTargetStage } from '../shared/evaluation-repair-target.js';
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
const defaultExternalAdapterMaxBufferBytes = 16 * 1024 * 1024;

interface ExternalAdapterCommandError {
  code?: string | number;
  killed?: boolean;
  signal?: string;
  stderr?: { toString(): string } | string;
  stdout?: { toString(): string } | string;
  message?: string;
}

type ImplementationChangeType = 'added' | 'modified' | 'deleted' | 'renamed';
type TestPlanCaseLevel = 'smoke' | 'integration' | 'regression' | 'edge';
type TestCasePriority = 'low' | 'medium' | 'high' | 'critical';
type CollaborationHandoffType = 'pull-request' | 'issue' | 'review' | 'status-update';
type CollaborationReadiness = 'ready' | 'blocked' | 'awaiting-approval';
type EvaluationDecision = 'accepted' | 'rejected' | 'needs-repair';

interface NormalizedTestPlanCase {
  id: string;
  title: string;
  level: TestPlanCaseLevel;
  priority: TestCasePriority;
  objective?: string;
  targetFiles?: string[];
}

interface NormalizedTestCase {
  id: string;
  title: string;
  priority: TestCasePriority;
  automationCandidate: boolean;
  preconditions?: string[];
  steps: string[];
  expectedResults: string[];
  targetFiles?: string[];
}

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

function isValidDefectSummaryPayload(payload: unknown): boolean {
  const validators = getSchemaValidators();
  return validators.defectSummary(payload);
}

function normalizeImplementationChangedFiles(
  deliverablePayload: Record<string, unknown>,
  fallbackEditedFiles: string[],
  changeTypes: Map<string, ImplementationChangeType>
): Array<{ path: string; changeType: ImplementationChangeType; summary?: string }> | undefined {
  const changedFiles = deliverablePayload.changedFiles;
  if (Array.isArray(changedFiles)) {
    const normalizedChangedFiles = changedFiles
      .map((entry) => {
        if (typeof entry === 'string' && entry.trim()) {
          const filePath = entry.trim();
          return {
            path: filePath,
            changeType: changeTypes.get(filePath) ?? 'modified'
          };
        }

        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }

        const filePath = getObjectStringProperty(entry, 'path');
        if (!filePath) {
          return null;
        }

        const changeTypeValue = getObjectStringProperty(entry, 'changeType');
        const changeType = changeTypeValue === 'added'
          || changeTypeValue === 'modified'
          || changeTypeValue === 'deleted'
          || changeTypeValue === 'renamed'
          ? changeTypeValue
          : changeTypes.get(filePath) ?? 'modified';
        const summary = getObjectStringProperty(entry, 'summary');

        return {
          path: filePath,
          changeType,
          ...(summary ? { summary } : {})
        };
      })
      .filter((entry): entry is { path: string; changeType: ImplementationChangeType; summary?: string } => Boolean(entry));

    if (normalizedChangedFiles.length > 0) {
      return normalizedChangedFiles;
    }
  }

  const scopedWorktreeStatus = normalizeStringList(deliverablePayload.scopedWorktreeStatus);
  if (scopedWorktreeStatus && scopedWorktreeStatus.length > 0) {
    return scopedWorktreeStatus.map((filePath) => ({
      path: filePath,
      changeType: changeTypes.get(filePath) ?? 'modified'
    }));
  }

  if (fallbackEditedFiles.length === 0) {
    return undefined;
  }

  return fallbackEditedFiles.map((filePath) => ({
    path: filePath,
    changeType: changeTypes.get(filePath) ?? 'modified'
  }));
}

function buildImplementationSummaryPayload(
  deliverablePayload: Record<string, unknown> | null,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  fallbackEditedFiles: string[],
  changeTypes: Map<string, ImplementationChangeType>,
  summary: string,
  executedCommands: string[],
  diffRefs: string[]
): Record<string, unknown> | null {
  const normalizedDeliverable = deliverablePayload ?? {};
  const changedFiles = normalizeImplementationChangedFiles(normalizedDeliverable, fallbackEditedFiles, changeTypes);
  if (!changedFiles || changedFiles.length === 0) {
    return null;
  }

  const deliverableSummary = getObjectStringProperty(normalizedDeliverable, 'summary');
  const note = getObjectStringProperty(normalizedDeliverable, 'note');
  const validatedTests = Array.isArray(normalizedDeliverable.validatedTests)
    ? normalizedDeliverable.validatedTests
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => getObjectStringProperty(entry, 'command'))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const validationCommands = Array.from(new Set([...executedCommands, ...validatedTests]));

  return {
    generatedAt: new Date().toISOString(),
    taskId: claim.taskId,
    stage: 'code-implementation',
    goal: claim.goal,
    summary: deliverableSummary ?? summary,
    changedFiles,
    ...(validationCommands.length > 0 ? { validationCommands } : {}),
    ...(diffRefs.length > 0 ? { diffRefs } : {}),
    ...(note ? { notes: [note] } : {})
  };
}

function isValidImplementationSummaryPayload(payload: unknown): boolean {
  const validators = getSchemaValidators();
  return validators.implementationSummary(payload);
}

function isValidTestPlanPayload(payload: unknown): boolean {
  const validators = getSchemaValidators();
  return validators.testPlan(payload);
}

function isValidTestCasesPayload(payload: unknown): boolean {
  const validators = getSchemaValidators();
  return validators.testCases(payload);
}

function isValidCollaborationHandoffPayload(payload: unknown): boolean {
  const validators = getSchemaValidators();
  return validators.collaborationHandoff(payload);
}

function isValidEvaluationSummaryPayload(payload: unknown): boolean {
  const validators = getSchemaValidators();
  return validators.evaluationSummary(payload);
}

function isCollaborationHandoffType(value: string | undefined): value is CollaborationHandoffType {
  return value === 'pull-request'
    || value === 'issue'
    || value === 'review'
    || value === 'status-update';
}

function isCollaborationReadiness(value: string | undefined): value is CollaborationReadiness {
  return value === 'ready'
    || value === 'blocked'
    || value === 'awaiting-approval';
}

function inferCollaborationHandoffType(sourcePayload: Record<string, unknown>): CollaborationHandoffType {
  const explicitType = getObjectStringProperty(sourcePayload, 'handoffType');
  if (isCollaborationHandoffType(explicitType)) {
    return explicitType;
  }

  if (asObjectRecord(sourcePayload.prReadySummary)) {
    return 'pull-request';
  }

  if (asObjectRecord(sourcePayload.issueReadyFollowUp)) {
    return 'issue';
  }

  if (normalizeStringList(sourcePayload.reviewFocus) || Array.isArray(sourcePayload.notableFindings)) {
    return 'review';
  }

  return 'status-update';
}

function buildCollaborationReviewPolicyPayload(
  sourcePayload: Record<string, unknown>,
  claim: NonNullable<TaskClaimPayload['taskClaim']>
): { required: boolean; reviewAgentCount: number; requireHumanApproval: boolean } {
  const sourceReviewPolicy = asObjectRecord(sourcePayload.reviewPolicy);
  const sourceReviewAgentCount = sourceReviewPolicy?.reviewAgentCount;
  const claimReviewPolicy = claim.reviewPolicy;

  return {
    required: typeof sourceReviewPolicy?.required === 'boolean'
      ? sourceReviewPolicy.required
      : claimReviewPolicy?.required === true,
    reviewAgentCount: typeof sourceReviewAgentCount === 'number' && Number.isInteger(sourceReviewAgentCount)
      ? sourceReviewAgentCount
      : claimReviewPolicy?.reviewAgentCount ?? 0,
    requireHumanApproval: typeof sourceReviewPolicy?.requireHumanApproval === 'boolean'
      ? sourceReviewPolicy.requireHumanApproval
      : claimReviewPolicy?.requireHumanApproval === true
  };
}

function inferCollaborationReadiness(
  sourcePayload: Record<string, unknown>,
  approvalRequired: boolean
): CollaborationReadiness {
  const explicitReadiness = getObjectStringProperty(sourcePayload, 'readiness');
  if (isCollaborationReadiness(explicitReadiness)) {
    return explicitReadiness;
  }

  const statusValue = getObjectStringProperty(sourcePayload, 'status')?.toLowerCase().replaceAll(/[_\s]+/g, '-');
  if (statusValue === 'blocked' || statusValue === 'needs-changes' || statusValue === 'failed') {
    return 'blocked';
  }

  if (statusValue === 'awaiting-approval' || statusValue === 'pending-approval') {
    return 'awaiting-approval';
  }

  if (statusValue === 'ready' || statusValue === 'ready-for-review' || statusValue === 'ready-to-review') {
    return approvalRequired ? 'awaiting-approval' : 'ready';
  }

  return approvalRequired ? 'awaiting-approval' : 'ready';
}

function collectCollaborationArtifactRefs(
  sourcePayload: Record<string, unknown>,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  runOutput: AdapterRunDocument
): string[] {
  const artifactRefs = new Set<string>();
  const candidateRefs = [
    ...(normalizeStringList(sourcePayload.artifactRefs) ?? []),
    ...(normalizeStringList(sourcePayload.upstreamArtifacts) ?? []),
    ...claim.runtimeContext.artifactRefs,
    ...claim.runtimeContext.taskArtifacts.map((artifact) => artifact.path).filter((artifactPath): artifactPath is string => typeof artifactPath === 'string' && artifactPath.trim().length > 0),
    ...runOutput.adapterRun.artifacts.map((artifact) => artifact.path)
  ];

  for (const artifactRef of candidateRefs) {
    const normalizedArtifactRef = artifactRef.trim();
    const normalizedArtifactRefKey = normalizedArtifactRef.toLowerCase();
    if (!normalizedArtifactRef
      || normalizedArtifactRefKey.includes('collaboration-handoff')
      || normalizedArtifactRefKey.includes('model-output')
      || normalizedArtifactRefKey.includes('copilot-cli-output')) {
      continue;
    }

    artifactRefs.add(normalizedArtifactRef);
  }

  return [...artifactRefs];
}

function buildCollaborationNextActions(
  sourcePayload: Record<string, unknown>,
  handoffType: CollaborationHandoffType,
  readiness: CollaborationReadiness,
  approvalRequired: boolean
): string[] {
  const explicitNextActions = normalizeStringList(sourcePayload.nextActions);
  if (explicitNextActions && explicitNextActions.length > 0) {
    return explicitNextActions;
  }

  const nextActions = new Set<string>();
  if (approvalRequired || readiness === 'awaiting-approval') {
    nextActions.add('Request human approval for the collaboration handoff.');
  }

  const issueReadyFollowUp = asObjectRecord(sourcePayload.issueReadyFollowUp);
  const issueTitle = getObjectStringProperty(issueReadyFollowUp, 'title');
  if (issueTitle) {
    nextActions.add(`Open follow-up issue: ${issueTitle}.`);
  }

  const notableFindings = Array.isArray(sourcePayload.notableFindings)
    ? sourcePayload.notableFindings
        .map((entry) => getObjectStringProperty(entry, 'recommendedAction'))
        .filter((value): value is string => Boolean(value))
    : [];
  for (const recommendedAction of notableFindings) {
    nextActions.add(recommendedAction);
  }

  if (nextActions.size === 0) {
    if (handoffType === 'pull-request') {
      nextActions.add('Open the pull request handoff for review.');
    } else if (handoffType === 'issue') {
      nextActions.add('Open the issue handoff for triage.');
    } else if (handoffType === 'review') {
      nextActions.add('Review the collaboration handoff and capture approval decisions.');
    } else {
      nextActions.add('Share the collaboration handoff with the owning reviewers.');
    }
  }

  return [...nextActions];
}

function buildCollaborationHandoffPayload(
  sourcePayload: Record<string, unknown> | null,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  runOutput: AdapterRunDocument
): Record<string, unknown> | null {
  const normalizedSource = sourcePayload ?? {};
  const reviewPolicy = buildCollaborationReviewPolicyPayload(normalizedSource, claim);
  const approvalRequired = typeof normalizedSource.approvalRequired === 'boolean'
    ? normalizedSource.approvalRequired
    : reviewPolicy.requireHumanApproval;
  const handoffType = inferCollaborationHandoffType(normalizedSource);
  const readiness = inferCollaborationReadiness(normalizedSource, approvalRequired);
  const summary = getObjectStringProperty(normalizedSource, 'summary')
    ?? getObjectStringProperty(normalizedSource, 'title')
    ?? runOutput.adapterRun.summary
    ?? claim.goal;
  const nextActions = buildCollaborationNextActions(normalizedSource, handoffType, readiness, approvalRequired);

  if (!summary || nextActions.length === 0) {
    return null;
  }

  return {
    generatedAt: getObjectStringProperty(normalizedSource, 'generatedAt') ?? new Date().toISOString(),
    taskId: claim.taskId,
    stage: 'collaboration',
    summary,
    handoffType,
    readiness,
    approvalRequired,
    artifactRefs: collectCollaborationArtifactRefs(normalizedSource, claim, runOutput),
    nextActions,
    reviewPolicy
  };
}

function inferEvaluationDecision(sourcePayload: Record<string, unknown>, runStatus: string): EvaluationDecision {
  const explicitDecision = getObjectStringProperty(sourcePayload, 'decision')?.toLowerCase().replaceAll(/[_\s]+/g, '-');
  if (explicitDecision === 'accepted' || explicitDecision === 'rejected' || explicitDecision === 'needs-repair') {
    return explicitDecision;
  }

  const statusValue = getObjectStringProperty(sourcePayload, 'status')?.toLowerCase().replaceAll(/[_\s]+/g, '-');
  if (statusValue === 'accepted' || statusValue === 'approved' || statusValue === 'passed') {
    return 'accepted';
  }
  if (statusValue === 'rejected' || statusValue === 'failed' || statusValue === 'blocked') {
    return 'rejected';
  }
  if (statusValue === 'needs-repair' || statusValue === 'changes-requested' || statusValue === 'repair-required') {
    return 'needs-repair';
  }

  return runStatus === 'completed' ? 'accepted' : 'rejected';
}

function collectEvaluationArtifactRefs(
  sourcePayload: Record<string, unknown>,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  runOutput: AdapterRunDocument
): string[] {
  const artifactRefs = new Set<string>();
  const candidateRefs = [
    ...(normalizeStringList(sourcePayload.artifactRefs) ?? []),
    ...claim.runtimeContext.artifactRefs,
    ...claim.runtimeContext.taskArtifacts
      .map((artifact) => artifact.path)
      .filter((artifactPath): artifactPath is string => typeof artifactPath === 'string' && artifactPath.trim().length > 0),
    ...runOutput.adapterRun.artifacts.map((artifact) => artifact.path)
  ];

  for (const artifactRef of candidateRefs) {
    const normalizedArtifactRef = artifactRef.trim();
    const normalizedArtifactRefKey = normalizedArtifactRef.toLowerCase();
    if (!normalizedArtifactRef
      || normalizedArtifactRefKey.includes('evaluation-summary')
      || normalizedArtifactRefKey.includes('model-output')
      || normalizedArtifactRefKey.includes('copilot-cli-output')) {
      continue;
    }

    artifactRefs.add(normalizedArtifactRef);
  }

  return [...artifactRefs];
}

function buildEvaluationSummaryPayload(
  sourcePayload: Record<string, unknown> | null,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  runOutput: AdapterRunDocument
): Record<string, unknown> | null {
  const normalizedSource = sourcePayload ?? {};
  const summary = getObjectStringProperty(normalizedSource, 'summary')
    ?? getObjectStringProperty(normalizedSource, 'title')
    ?? runOutput.adapterRun.summary
    ?? claim.goal;
  const artifactRefs = collectEvaluationArtifactRefs(normalizedSource, claim, runOutput);
  const findings = normalizeStringList(normalizedSource.findings);
  const nextActions = normalizeStringList(normalizedSource.nextActions);
  const explicitRepairTargetStage = getObjectStringProperty(normalizedSource, 'repairTargetStage');
  const repairTargetStage = resolveEvaluationRepairTargetStage({
    ...(explicitRepairTargetStage ? { explicitRepairTargetStage } : {}),
    ...(nextActions ? { nextActions } : {}),
    ...(findings ? { findings } : {})
  });

  if (!summary) {
    return null;
  }

  return {
    generatedAt: new Date().toISOString(),
    taskId: claim.taskId,
    stage: 'evaluation',
    summary,
    decision: inferEvaluationDecision(normalizedSource, runOutput.adapterRun.status),
    ...(repairTargetStage ? { repairTargetStage } : {}),
    artifactRefs,
    ...(findings ? { findings } : {}),
    ...(nextActions ? { nextActions } : {})
  };
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[^a-z0-9]+/i)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function inferTestPlanLevel(value: string | undefined): TestPlanCaseLevel {
  const normalizedValue = value?.trim().toLowerCase() ?? '';
  if (normalizedValue === 'edge') {
    return 'edge';
  }
  if (normalizedValue === 'integration') {
    return 'integration';
  }
  if (normalizedValue === 'regression') {
    return 'regression';
  }
  return 'smoke';
}

function inferTestCasePriority(value: string | undefined): TestCasePriority {
  const normalizedValue = value?.trim().toLowerCase() ?? '';
  if (normalizedValue === 'critical') {
    return 'critical';
  }
  if (normalizedValue === 'high') {
    return 'high';
  }
  if (normalizedValue === 'medium') {
    return 'medium';
  }
  if (normalizedValue === 'low') {
    return 'low';
  }
  if (normalizedValue === 'regression') {
    return 'critical';
  }
  if (normalizedValue === 'integration') {
    return 'medium';
  }
  return 'high';
}

function buildTestPlanPayload(
  deliverablePayload: Record<string, unknown> | null,
  rawTestPlanPayload: unknown,
  rawTestCasesPayload: unknown,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  summary: string
): Record<string, unknown> | null {
  const normalizedDeliverable = deliverablePayload ?? {};
  const rawTestPlan = asObjectRecord(rawTestPlanPayload) ?? {};
  const rawTestCases = asObjectRecord(rawTestCasesPayload) ?? {};
  const rawCases = Array.isArray(rawTestCases.cases)
    ? rawTestCases.cases
        .map((entry) => asObjectRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const planCases: NormalizedTestPlanCase[] = rawCases.map((entry) => {
    const id = getObjectStringProperty(entry, 'id');
    if (!id) {
      return null;
    }

    const route = getObjectStringProperty(entry, 'route');
    const level = inferTestPlanLevel(getObjectStringProperty(entry, 'type'));
    const priority = inferTestCasePriority(getObjectStringProperty(entry, 'type'));
    const assertions = normalizeStringList(entry.assertions);
    const service = getObjectStringProperty(entry, 'service');

    return {
      id,
      title: route ?? humanizeIdentifier(id),
      level,
      priority,
      ...(assertions && assertions.length > 0 ? { objective: assertions[0] } : {}),
      ...(service ? { targetFiles: [service] } : {})
    };
  }).filter((entry): entry is NormalizedTestPlanCase => entry !== null);

  if (planCases.length === 0) {
    const focusItems = normalizeStringList(rawTestPlan.focus)
      ?? normalizeStringList(normalizedDeliverable.focus)
      ?? [];
    for (const [index, focusItem] of focusItems.entries()) {
      planCases.push({
        id: `case-${index + 1}`,
        title: focusItem,
        level: inferTestPlanLevel(focusItem),
        priority: inferTestCasePriority(focusItem),
        objective: focusItem
      });
    }
  }

  if (planCases.length === 0) {
    return null;
  }

  const validationStrategy = asObjectRecord(rawTestPlan.validationStrategy);
  const targetedCommands = normalizeStringList(validationStrategy?.targetedCommands);
  const deferredSuiteCommands = normalizeStringList(validationStrategy?.deferredSuiteCommands);
  const deferredReason = getObjectStringProperty(validationStrategy, 'reasonDeferred');

  return {
    generatedAt: new Date().toISOString(),
    taskId: claim.taskId,
    stage: 'test-design',
    goal: claim.goal,
    summary,
    ...(targetedCommands && targetedCommands.length > 0
      ? { strategy: `Targeted validation commands: ${targetedCommands.join('; ')}` }
      : {}),
    cases: planCases,
    ...(deferredSuiteCommands && deferredSuiteCommands.length > 0
      ? { risks: [`Deferred broader verification: ${deferredSuiteCommands.join('; ')}`] }
      : {}),
    ...(deferredReason || (targetedCommands && targetedCommands.length > 0)
      ? {
          notes: [
            ...(deferredReason ? [deferredReason] : []),
            ...(targetedCommands && targetedCommands.length > 0 ? [`Targeted commands: ${targetedCommands.join('; ')}`] : [])
          ]
        }
      : {})
  };
}

function buildTestCasesPayload(
  rawTestCasesPayload: unknown,
  claim: NonNullable<TaskClaimPayload['taskClaim']>
): Record<string, unknown> | null {
  const rawTestCases = asObjectRecord(rawTestCasesPayload) ?? {};
  const rawCases = Array.isArray(rawTestCases.cases)
    ? rawTestCases.cases
        .map((entry) => asObjectRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];

  const cases: NormalizedTestCase[] = rawCases.map((entry) => {
    const id = getObjectStringProperty(entry, 'id');
    if (!id) {
      return null;
    }

    const route = getObjectStringProperty(entry, 'route');
    const service = getObjectStringProperty(entry, 'service');
    const assertions = normalizeStringList(entry.assertions) ?? [];
    const priority = inferTestCasePriority(getObjectStringProperty(entry, 'type'));

    return {
      id,
      title: route ?? humanizeIdentifier(id),
      priority,
      automationCandidate: true,
      ...(service ? { preconditions: [`Service context: ${service}`] } : {}),
      steps: [
        ...(route ? [`Exercise ${route}.`] : [`Execute ${humanizeIdentifier(id)}.`]),
        'Capture the resulting response and validation behavior.'
      ],
      expectedResults: assertions.length > 0
        ? assertions
        : ['The route behaves according to the claimed contract.'],
      ...(service ? { targetFiles: [service] } : {})
    };
  }).filter((entry): entry is NormalizedTestCase => entry !== null);

  if (cases.length === 0) {
    return null;
  }

  return {
    generatedAt: new Date().toISOString(),
    taskId: claim.taskId,
    stage: 'test-design',
    goal: claim.goal,
    cases
  };
}

function inferRepositoryRoot(
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  adapterRuntimePayload: AdapterRuntimeDocument | null
): string {
  // Prefer worktreePath from the claim: this is the checkout of the target repo
  // where artifacts should be written. adapterRuntime.cwd is the adapter tool's
  // process working directory, which may differ from the target repository root.
  const worktreePath = claim.runtimeContext.workspace?.worktreePath?.trim();
  if (worktreePath) {
    return path.resolve(worktreePath);
  }

  const runtimeCwd = adapterRuntimePayload?.adapterRuntime.cwd?.trim();
  if (runtimeCwd) {
    return path.resolve(runtimeCwd);
  }



  const workspaceRootPath = claim.runtimeContext.workspace?.workspaceRootPath?.trim();
  if (workspaceRootPath) {
    return path.resolve(workspaceRootPath);
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
  if (!artifactsDir) {
    return runOutput;
  }

  const repositoryRoot = inferRepositoryRoot(claim, adapterRuntimePayload);
  const artifacts = [...runOutput.adapterRun.artifacts];
  const notes = [...runOutput.adapterRun.notes];
  const errors = [...runOutput.adapterRun.errors];
  const editedFiles = Array.from(new Set(runOutput.adapterRun.activity.editedFiles.map((filePath) => filePath.trim()).filter(Boolean)));
  const changeTypes = inferImplementationChangeTypes(repositoryRoot, editedFiles);
  const existingImplementationSummaryArtifact = findStructuredArtifactReference(artifacts, 'implementation-summary');
  const existingImplementationSummaryPayload = existingImplementationSummaryArtifact
    ? loadOptionalStructuredFileFrom(repositoryRoot, existingImplementationSummaryArtifact.path)
    : null;
  const validImplementationSummary = existingImplementationSummaryPayload
    ? isValidImplementationSummaryPayload(existingImplementationSummaryPayload)
    : false;
  const deliverablePayload = extractModelOutputDeliverablePayloadFrom(runOutput, repositoryRoot);
  const codeDiffArtifact = artifacts.find((artifact) => artifact.id === 'code-diff');
  const diffRefs = codeDiffArtifact?.path ? [codeDiffArtifact.path] : [];

  if (!validImplementationSummary) {
    const implementationSummaryPath = existingImplementationSummaryArtifact?.path ?? path.join(artifactsDir, 'implementation-summary.json');
    const implementationSummaryPayload = buildImplementationSummaryPayload(
      deliverablePayload,
      claim,
      editedFiles,
      changeTypes,
      runOutput.adapterRun.summary,
      runOutput.adapterRun.activity.commands,
      diffRefs
    );

    if (implementationSummaryPayload) {
      writeJsonFrom(repositoryRoot, implementationSummaryPath, implementationSummaryPayload);
      if (!existingImplementationSummaryArtifact) {
        artifacts.push({
          id: 'implementation-summary',
          kind: 'report',
          path: implementationSummaryPath,
          taskId: claim.taskId
        });
      }
      notes.push(existingImplementationSummaryArtifact
        ? 'controller-normalized:implementation-summary'
        : 'controller-generated:implementation-summary');
    }
  }

  if (!hasArtifactReference(artifacts, 'code-diff')) {
    if (editedFiles.length === 0) {
      return {
        adapterRun: {
          ...runOutput.adapterRun,
          notes,
          artifacts,
          errors
        }
      };
    }

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
      notes.push('controller-code-diff-unavailable');
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

function enrichTestDesignRunOutput(
  runOutput: AdapterRunDocument,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  adapterRuntimePayload: AdapterRuntimeDocument | null
): AdapterRunDocument {
  if (claim.stage !== 'test-design') {
    return runOutput;
  }

  const artifactsDir = claim.runtimeContext.artifactsDir?.trim();
  if (!artifactsDir) {
    return runOutput;
  }

  const repositoryRoot = inferRepositoryRoot(claim, adapterRuntimePayload);
  const artifacts = [...runOutput.adapterRun.artifacts];
  const notes = [...runOutput.adapterRun.notes];
  const existingTestPlanArtifact = findStructuredArtifactReference(artifacts, 'test-plan');
  const existingTestCasesArtifact = findStructuredArtifactReference(artifacts, 'test-cases');
  const existingTestPlanPayload = existingTestPlanArtifact
    ? loadOptionalStructuredFileFrom(repositoryRoot, existingTestPlanArtifact.path)
    : null;
  const existingTestCasesPayload = existingTestCasesArtifact
    ? loadOptionalStructuredFileFrom(repositoryRoot, existingTestCasesArtifact.path)
    : null;
  const validTestPlan = existingTestPlanPayload ? isValidTestPlanPayload(existingTestPlanPayload) : false;
  const validTestCases = existingTestCasesPayload ? isValidTestCasesPayload(existingTestCasesPayload) : false;
  const deliverablePayload = extractModelOutputDeliverablePayloadFrom(runOutput, repositoryRoot);

  if (!validTestPlan) {
    const testPlanPath = existingTestPlanArtifact?.path ?? path.join(artifactsDir, 'test-plan.json');
    const testPlanPayload = buildTestPlanPayload(
      deliverablePayload,
      existingTestPlanPayload,
      existingTestCasesPayload,
      claim,
      runOutput.adapterRun.summary
    );
    if (testPlanPayload) {
      writeJsonFrom(repositoryRoot, testPlanPath, testPlanPayload);
      if (!existingTestPlanArtifact) {
        artifacts.push({
          id: 'test-plan',
          kind: 'report',
          path: testPlanPath,
          taskId: claim.taskId
        });
      }
      notes.push(existingTestPlanArtifact ? 'controller-normalized:test-plan' : 'controller-generated:test-plan');
    }
  }

  if (!validTestCases) {
    const testCasesPath = existingTestCasesArtifact?.path ?? path.join(artifactsDir, 'test-cases.json');
    const testCasesPayload = buildTestCasesPayload(existingTestCasesPayload, claim);
    if (testCasesPayload) {
      writeJsonFrom(repositoryRoot, testCasesPath, testCasesPayload);
      if (!existingTestCasesArtifact) {
        artifacts.push({
          id: 'test-cases',
          kind: 'report',
          path: testCasesPath,
          taskId: claim.taskId
        });
      }
      notes.push(existingTestCasesArtifact ? 'controller-normalized:test-cases' : 'controller-generated:test-cases');
    }
  }

  return {
    adapterRun: {
      ...runOutput.adapterRun,
      notes,
      artifacts
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

function enrichDefectFeedbackRunOutput(
  runOutput: AdapterRunDocument,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  adapterRuntimePayload: AdapterRuntimeDocument | null
): AdapterRunDocument {
  if (claim.stage !== 'defect-feedback') {
    return runOutput;
  }

  const artifactsDir = claim.runtimeContext.artifactsDir?.trim();
  if (!artifactsDir) {
    return runOutput;
  }

  const repositoryRoot = inferRepositoryRoot(claim, adapterRuntimePayload);
  const artifacts = [...runOutput.adapterRun.artifacts];
  const notes = [...runOutput.adapterRun.notes];

  const existingDefectSummaryArtifact = findStructuredArtifactReference(artifacts, 'defect-summary');
  if (existingDefectSummaryArtifact) {
    const existingPayload = loadOptionalStructuredFileFrom(repositoryRoot, existingDefectSummaryArtifact.path);
    if (existingPayload && isValidDefectSummaryPayload(existingPayload)) {
      return runOutput;
    }
  }

  // Normalize the defect-summary to match schema requirements.
  // Pull what we can from the existing file or adapter summary.
  const existingRaw = existingDefectSummaryArtifact
    ? loadOptionalStructuredFileFrom(repositoryRoot, existingDefectSummaryArtifact.path)
    : null;
  const rawRecord = asObjectRecord(existingRaw);

  const defectSummaryPath = existingDefectSummaryArtifact?.path ?? path.join(artifactsDir, 'defect-summary.json');
  const evidenceRefs = artifacts
    .map((a) => a.id)
    .filter(Boolean)
    .slice(0, 5);
  if (evidenceRefs.length === 0) {
    evidenceRefs.push('adapter-run-summary');
  }

  const normalizedDefectSummary = {
    generatedAt: new Date().toISOString(),
    taskId: claim.taskId,
    stage: 'defect-feedback' as const,
    summary: getObjectStringProperty(rawRecord, 'summary') ?? runOutput.adapterRun.summary,
    failureType: 'requirements' as const,
    severity: 'medium' as const,
    evidenceRefs,
    recommendedAction: 'clarify-requirements' as const
  };
  writeJsonFrom(repositoryRoot, defectSummaryPath, normalizedDefectSummary);

  if (!existingDefectSummaryArtifact) {
    artifacts.push({
      id: 'defect-summary',
      kind: 'report',
      path: defectSummaryPath,
      taskId: claim.taskId
    });
    notes.push('controller-generated:defect-summary');
  } else {
    notes.push('controller-normalized:defect-summary');
  }

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
  deliverable: Record<string, unknown>;
  handoff?: Record<string, unknown>;
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
      handoffArtifact?: string;
    };
  }>(repositoryRoot, modelOutputArtifact.path);
  const deliverable = asObjectRecord(modelOutputPayload?.deliverable);
  if (!deliverable) {
    return null;
  }

  const handoff = asObjectRecord(deliverable.handoff);
  const handoffArtifactPath = getObjectStringProperty(deliverable, 'handoffArtifactPath')
    ?? getObjectStringProperty(deliverable, 'handoffArtifact');

  return handoffArtifactPath
    ? { deliverable, ...(handoff ? { handoff } : {}), handoffArtifactPath }
    : { deliverable, ...(handoff ? { handoff } : {}) };
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
  if (!artifactsDir) {
    return runOutput;
  }

  const repositoryRoot = inferRepositoryRoot(claim, adapterRuntimePayload);
  const artifacts = [...runOutput.adapterRun.artifacts];
  const existingCollaborationArtifact = findStructuredArtifactReference(artifacts, 'collaboration-handoff');
  const collaborationPayload = extractCollaborationHandoffPayloadFrom(runOutput, repositoryRoot);
  const candidateArtifactPaths = Array.from(new Set([
    existingCollaborationArtifact?.path,
    collaborationPayload?.handoffArtifactPath,
    path.join(artifactsDir, 'collaboration-handoff.json')
  ].filter((artifactPath): artifactPath is string => typeof artifactPath === 'string' && artifactPath.trim().length > 0)));

  let existingPayload: Record<string, unknown> | null = null;
  let collaborationHandoffPath = existingCollaborationArtifact?.path ?? collaborationPayload?.handoffArtifactPath?.trim() ?? path.join(artifactsDir, 'collaboration-handoff.json');

  for (const candidatePath of candidateArtifactPaths) {
    const loadedPayload = asObjectRecord(loadOptionalStructuredFileFrom(repositoryRoot, candidatePath));
    if (loadedPayload) {
      existingPayload = loadedPayload;
      collaborationHandoffPath = candidatePath;
      break;
    }
  }

  const validExistingPayload = existingPayload ? isValidCollaborationHandoffPayload(existingPayload) : false;
  const normalizedPayload = validExistingPayload
    ? existingPayload
    : buildCollaborationHandoffPayload(existingPayload ?? collaborationPayload?.handoff ?? collaborationPayload?.deliverable ?? null, claim, runOutput);

  if (!normalizedPayload) {
    return runOutput;
  }

  const needsWrite = !validExistingPayload || !existingPayload || !existingCollaborationArtifact;
  if (needsWrite) {
    writeJsonFrom(repositoryRoot, collaborationHandoffPath, normalizedPayload);
  }

  const notes = [...runOutput.adapterRun.notes];
  if (!validExistingPayload) {
    notes.push(existingPayload ? 'controller-normalized:collaboration-handoff' : 'controller-generated:collaboration-handoff');
  }

  const remainingErrors = runOutput.adapterRun.errors.filter((error) => error.code !== 'artifact-write-blocked');
  const recoveredFromArtifactWriteBlock = runOutput.adapterRun.errors.length > 0
    && remainingErrors.length === 0
    && runOutput.adapterRun.errors.every((error) => error.code === 'artifact-write-blocked');

  if (!needsWrite && !recoveredFromArtifactWriteBlock) {
    return runOutput;
  }

  if (recoveredFromArtifactWriteBlock) {
    notes.push('controller-recovered:artifact-write-blocked');
  }

  const handoffSummary = typeof normalizedPayload.summary === 'string'
    ? normalizedPayload.summary
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
      artifacts: existingCollaborationArtifact
        ? artifacts
        : [
            ...artifacts,
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

function enrichEvaluationRunOutput(
  runOutput: AdapterRunDocument,
  claim: NonNullable<TaskClaimPayload['taskClaim']>,
  adapterRuntimePayload: AdapterRuntimeDocument | null
): AdapterRunDocument {
  if (claim.stage !== 'evaluation') {
    return runOutput;
  }

  const artifactsDir = claim.runtimeContext.artifactsDir?.trim();
  if (!artifactsDir) {
    return runOutput;
  }

  const repositoryRoot = inferRepositoryRoot(claim, adapterRuntimePayload);
  const artifacts = [...runOutput.adapterRun.artifacts];
  const existingEvaluationArtifact = findStructuredArtifactReference(artifacts, 'evaluation-summary');
  if (existingEvaluationArtifact) {
    const existingPayload = loadOptionalStructuredFileFrom(repositoryRoot, existingEvaluationArtifact.path);
    if (existingPayload && isValidEvaluationSummaryPayload(existingPayload)) {
      return runOutput;
    }
  }

  const deliverablePayload = extractModelOutputDeliverablePayloadFrom(runOutput, repositoryRoot);
  const evaluationSummaryPayload = buildEvaluationSummaryPayload(deliverablePayload, claim, runOutput);
  if (!evaluationSummaryPayload) {
    return runOutput;
  }

  const evaluationSummaryPath = existingEvaluationArtifact?.path ?? path.join(artifactsDir, 'evaluation-summary.json');
  writeJsonFrom(repositoryRoot, evaluationSummaryPath, evaluationSummaryPayload);

  return {
    adapterRun: {
      ...runOutput.adapterRun,
      notes: [
        ...runOutput.adapterRun.notes,
        existingEvaluationArtifact
          ? 'controller-normalized:evaluation-summary'
          : 'controller-generated:evaluation-summary'
      ],
      artifacts: existingEvaluationArtifact
        ? artifacts
        : [
            ...artifacts,
            {
              id: 'evaluation-summary',
              kind: 'report',
              path: evaluationSummaryPath,
              taskId: claim.taskId
            }
          ]
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

function readCommandOutputText(value: ExternalAdapterCommandError['stderr'] | ExternalAdapterCommandError['stdout']): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  return value?.toString().trim() ?? '';
}

function isExternalAdapterTimeoutError(error: ExternalAdapterCommandError, timeout: number | undefined): boolean {
  return error.code === 'ETIMEDOUT'
    || (timeout !== undefined && (error.killed === true || error.signal === 'SIGTERM'));
}

function buildExternalAdapterFailureMessage(error: ExternalAdapterCommandError): string {
  const stderr = readCommandOutputText(error.stderr);
  const stdout = readCommandOutputText(error.stdout);
  const detail = stderr || stdout || error.message || 'unknown adapter command failure';
  const qualifiers = [
    typeof error.code === 'string' || typeof error.code === 'number' ? `code=${String(error.code)}` : null,
    error.signal ? `signal=${error.signal}` : null
  ].filter(Boolean);

  return qualifiers.length > 0
    ? `adapter command failed (${qualifiers.join(', ')}): ${detail}`
    : `adapter command failed: ${detail}`;
}

function createAbortError(message: string): Error & { code: string; name: string; } {
  const error = new Error(message) as Error & { code: string; name: string; };
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function parseAdapterStdoutPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('adapter command returned empty stdout; expected JSON output');
  }

  try {
    const assistantContent = extractCopilotAssistantContent(trimmed);
    return JSON.parse(extractJsonPayload(assistantContent));
  } catch (error) {
    const parseError = error as { message?: string };
    throw new Error(`adapter stdout is not valid JSON: ${parseError.message ?? 'unknown error'}`);
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
  const claim = claimPayload.taskClaim;
  if (!claim) {
    fail('task claim is required to run an external adapter');
  }
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
  const cwd = adapterRuntime.cwd
    ? resolveFromCwd(expandTemplateValue(adapterRuntime.cwd, templateContext))
    : inferRepositoryRoot(claim, adapterRuntimePayload);
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
      maxBuffer: defaultExternalAdapterMaxBufferBytes,
      ...(timeout === undefined ? {} : { timeout }),
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    const commandError = error as ExternalAdapterCommandError;
    if (isExternalAdapterTimeoutError(commandError, timeout)) {
      return buildAdapterTimeoutRunOutput(adapterRuntimePayload, claimPayload, timeout);
    }

    const failureMessage = buildExternalAdapterFailureMessage(commandError);
    console.error(failureMessage);
    throw new Error(failureMessage);
  }

  let adapterOutputPayload: unknown;

  if (adapterRuntime.outputMode === 'stdout') {
    adapterOutputPayload = parseAdapterStdoutPayload(stdout);
  } else {
    adapterOutputPayload = readAdapterOutput(adapterRuntime, templateContext);
  }

  return normalizeAdapterRunPayload(adapterOutputPayload, adapterRuntimePayload, claimPayload);
}

export async function runExternalAdapterAsync(
  adapterRuntimePayload: AdapterRuntimeDocument,
  claimPayload: TaskClaimPayload,
  statePath: string,
  taskGraphPath: string,
  options: Record<string, any> = {}
): Promise<AdapterRunDocument> {
  const claim = claimPayload.taskClaim;
  if (!claim) {
    fail('task claim is required to run an external adapter');
  }
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
  const cwd = adapterRuntime.cwd
    ? resolveFromCwd(expandTemplateValue(adapterRuntime.cwd, templateContext))
    : inferRepositoryRoot(claim, adapterRuntimePayload);
  const timeout = typeof adapterRuntime.timeoutMs === 'number' && adapterRuntime.timeoutMs > 0
    ? adapterRuntime.timeoutMs
    : undefined;
  const abortSignal = options.signal as AbortSignal | undefined;

  const stdout = await new Promise<string>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(createAbortError(`adapter command aborted before start: ${command}`));
      return;
    }

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let abortTriggered = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const cleanup = (): void => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort);
      }
    };

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const onAbort = (): void => {
      abortTriggered = true;
      child.kill('SIGTERM');
    };

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.on('error', (error) => {
      finish(() => reject(error));
    });
    child.on('close', (code, signal) => {
      const stdoutText = Buffer.concat(stdoutChunks).toString('utf8');
      const stderrText = Buffer.concat(stderrChunks).toString('utf8');

      if (abortTriggered) {
        finish(() => reject(createAbortError(`adapter command aborted: ${command}`)));
        return;
      }

      if (timedOut) {
        finish(() => resolve(JSON.stringify(buildAdapterTimeoutRunOutput(adapterRuntimePayload, claimPayload, timeout).adapterRun)));
        return;
      }

      if (code !== 0) {
        const commandError: ExternalAdapterCommandError = {
          stderr: stderrText,
          stdout: stdoutText
        };
        if (typeof code === 'number') {
          commandError.code = code;
        }
        if (signal) {
          commandError.signal = signal;
        }
        finish(() => reject(new Error(buildExternalAdapterFailureMessage(commandError))));
        return;
      }

      finish(() => resolve(stdoutText));
    });

    child.stdin?.end(`${JSON.stringify(claimPayload, null, 2)}\n`);

    if (typeof timeout === 'number') {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeout);
    }

    if (abortSignal) {
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
  });

  if (typeof timeout === 'number') {
    try {
      const timeoutPayload = JSON.parse(stdout) as AdapterRunDocument['adapterRun'];
      if (timeoutPayload?.summary === buildAdapterTimeoutRunOutput(adapterRuntimePayload, claimPayload, timeout).adapterRun.summary) {
        return {
          adapterRun: timeoutPayload
        };
      }
    } catch {
      // fall through to normal parsing
    }
  }

  const adapterOutputPayload = adapterRuntime.outputMode === 'stdout'
    ? parseAdapterStdoutPayload(stdout)
    : readAdapterOutput(adapterRuntime, templateContext);

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
    resolvedOptions.stage === 'collaboration' ||
    resolvedOptions.stage === 'evaluation'
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
  const testDesignEnrichedRunOutput = enrichTestDesignRunOutput(implementationEnrichedRunOutput, claim, adapterRuntimePayload);
  const defectEnrichedRunOutput = enrichDefectFeedbackRunOutput(testDesignEnrichedRunOutput, claim, adapterRuntimePayload);
  const collaborationEnrichedRunOutput = enrichCollaborationRunOutput(defectEnrichedRunOutput, claim, adapterRuntimePayload);
  const evaluationEnrichedRunOutput = enrichEvaluationRunOutput(collaborationEnrichedRunOutput, claim, adapterRuntimePayload);
  const validatedRunOutput = applyRolePolicyToRunOutput(claim, evaluationEnrichedRunOutput);

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

export async function executeTaskRunAsync(
  statePath: string,
  taskGraphPath: string,
  claimPayload: TaskClaimPayload,
  options: CliOptions,
  dependencies: AdapterRunnerDependencies & { signal?: AbortSignal; }
): Promise<TaskExecutionResult> {
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
    resolvedOptions.stage === 'collaboration' ||
    resolvedOptions.stage === 'evaluation'
      ? resolvedOptions.stage
      : undefined;
  const runOutput = adapterRuntimePayload
    ? await runExternalAdapterAsync(adapterRuntimePayload, claimPayload, statePath, taskGraphPath, {
        ...resolvedOptions,
        getRouteNameFromTaskId,
        signal: dependencies.signal
      })
    : buildSimulatedAdapterOutput(claimPayload, adapterCapabilityPayload, {
        ...resolvedOptions,
        sanitizeStageName,
        getRouteNameFromTaskId,
        parseCsvOption
      });
  const requirementsEnrichedRunOutput = enrichRequirementsAnalysisRunOutput(runOutput, claim, adapterRuntimePayload);
  const implementationEnrichedRunOutput = enrichCodeImplementationRunOutput(requirementsEnrichedRunOutput, claim, adapterRuntimePayload);
  const testDesignEnrichedRunOutput = enrichTestDesignRunOutput(implementationEnrichedRunOutput, claim, adapterRuntimePayload);
  const defectEnrichedRunOutput = enrichDefectFeedbackRunOutput(testDesignEnrichedRunOutput, claim, adapterRuntimePayload);
  const collaborationEnrichedRunOutput = enrichCollaborationRunOutput(defectEnrichedRunOutput, claim, adapterRuntimePayload);
  const evaluationEnrichedRunOutput = enrichEvaluationRunOutput(collaborationEnrichedRunOutput, claim, adapterRuntimePayload);
  const validatedRunOutput = applyRolePolicyToRunOutput(claim, evaluationEnrichedRunOutput);

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
