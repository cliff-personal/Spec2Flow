import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDirForFile, readStructuredFileFrom, writeJsonFrom } from '../shared/fs-utils.js';
import { getSchemaValidators } from '../shared/schema-registry.js';
import type { ArtifactRef, TaskState } from '../types/execution-state.js';
import type { CollaborationHandoff, ImplementationSummary, PublicationRecord } from '../types/stage-deliverables.js';
import type { Task } from '../types/task-graph.js';

type PublicationGateReason = NonNullable<PublicationRecord['gateReason']>;

export type CollaborationPublicationDecision =
  | {
      status: 'not-applicable';
      generatedArtifacts: ArtifactRef[];
      notes: string[];
    }
  | {
      status: 'published';
      publication: PublicationRecord;
      generatedArtifacts: ArtifactRef[];
      notes: string[];
    }
  | {
      status: 'blocked';
      reason: PublicationGateReason;
      publication: PublicationRecord;
      generatedArtifacts: ArtifactRef[];
      notes: string[];
    };

export interface ApplyCollaborationPublicationOptions {
  taskGraphTask: Task;
  taskState: TaskState;
  artifacts: ArtifactRef[];
  allArtifacts: ArtifactRef[];
  artifactBaseDir: string;
}

function normalizeArtifactSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function findArtifact(artifacts: ArtifactRef[], token: string): ArtifactRef | null {
  return artifacts.find((artifact) => {
    const values = [artifact.id, artifact.path]
      .map((value) => normalizeArtifactSearchValue(String(value)));
    return values.some((value) => value.includes(token));
  }) ?? null;
}

function sanitizeFileToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'collaboration';
}

function getRouteName(taskId: string): string {
  return taskId.includes('--')
    ? taskId.split('--')[0] ?? taskId
    : taskId;
}

function resolveGitRepositoryRoot(startDir: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: startDir,
    encoding: 'utf8'
  }).trim();
}

function runGit(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim();
}

function readCollaborationHandoff(artifacts: ArtifactRef[], artifactBaseDir: string): CollaborationHandoff | null {
  const handoffArtifact = findArtifact(artifacts, 'collaboration-handoff');
  if (!handoffArtifact) {
    return null;
  }

  const payload = readStructuredFileFrom(artifactBaseDir, handoffArtifact.path);
  const validators = getSchemaValidators();
  if (!validators.collaborationHandoff(payload)) {
    throw new Error(`invalid collaboration-handoff payload: ${JSON.stringify(validators.collaborationHandoff.errors ?? [])}`);
  }

  return payload as CollaborationHandoff;
}

function readImplementationSummary(artifacts: ArtifactRef[], artifactBaseDir: string): ImplementationSummary | null {
  const implementationArtifact = findArtifact(artifacts, 'implementation-summary');
  if (!implementationArtifact) {
    return null;
  }

  const payload = readStructuredFileFrom(artifactBaseDir, implementationArtifact.path);
  const validators = getSchemaValidators();
  if (!validators.implementationSummary(payload)) {
    throw new Error(`invalid implementation-summary payload: ${JSON.stringify(validators.implementationSummary.errors ?? [])}`);
  }

  return payload as ImplementationSummary;
}

function buildBranchName(routeName: string): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '').replace('T', '-').replace('Z', '').toLowerCase();
  return `spec2flow/${sanitizeFileToken(routeName)}-${timestamp}`;
}

function buildCommitMessage(routeName: string, handoff: CollaborationHandoff): string {
  const summary = handoff.summary.replaceAll(/\s+/g, ' ').trim();
  return `spec2flow: publish ${sanitizeFileToken(routeName)} handoff${summary ? ` - ${summary}` : ''}`.slice(0, 120);
}

function buildPrTitle(routeName: string, handoff: CollaborationHandoff): string {
  return handoff.summary.trim().length > 0
    ? handoff.summary.trim()
    : `Spec2Flow collaboration handoff for ${routeName}`;
}

function buildPrDraftBody(handoff: CollaborationHandoff, publication: PublicationRecord): string {
  const lines = [
    `# ${publication.prTitle ?? handoff.summary}`,
    '',
    '## Summary',
    handoff.summary,
    '',
    '## Evidence',
    ...(handoff.artifactRefs.length > 0 ? handoff.artifactRefs.map((artifactRef) => `- ${artifactRef}`) : ['- No upstream artifacts were referenced.']),
    '',
    '## Next Actions',
    ...(handoff.nextActions.length > 0 ? handoff.nextActions.map((action) => `- ${action}`) : ['- No follow-up actions were provided.'])
  ];

  if (publication.branchName) {
    lines.push('', '## Publication', `- Branch: \`${publication.branchName}\``);
  }

  if (publication.commitSha) {
    lines.push(`- Commit: \`${publication.commitSha}\``);
  }

  return `${lines.join('\n')}\n`;
}

function toRelativeArtifactPath(repoRoot: string, filePath: string): string {
  const relativePath = path.relative(repoRoot, filePath);
  return relativePath && !relativePath.startsWith('..')
    ? relativePath
    : filePath;
}

function createPublicationArtifactsDir(repoRoot: string, routeName: string): string {
  return path.join(repoRoot, 'spec2flow', 'outputs', 'collaboration', sanitizeFileToken(routeName));
}

function getScopedChangedFiles(implementationSummary: ImplementationSummary | null): string[] {
  return implementationSummary?.changedFiles
    .map((entry) => entry.path.trim())
    .filter((entry) => entry.length > 0) ?? [];
}

function normalizePaths(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replaceAll('\\', '/')).filter(Boolean))];
}

function getStagedFiles(repoRoot: string): string[] {
  const output = runGit(repoRoot, ['diff', '--cached', '--name-only']);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function stageScopedFiles(repoRoot: string, scopedFiles: string[]): void {
  runGit(repoRoot, ['add', '-A', '--', ...scopedFiles]);
}

function getStagedScopedFiles(repoRoot: string, scopedFiles: string[]): string[] {
  const output = runGit(repoRoot, ['diff', '--cached', '--name-only', '--', ...scopedFiles]);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function buildGeneratedArtifact(taskId: string, artifactId: string, artifactPath: string): ArtifactRef {
  return {
    id: artifactId,
    kind: 'report',
    path: artifactPath,
    taskId
  };
}

function buildPublicationRecord(
  handoff: CollaborationHandoff,
  taskId: string,
  autoCommitEnabled: boolean,
  status: PublicationRecord['status'],
  publishMode: PublicationRecord['publishMode'],
  overrides: Partial<PublicationRecord> = {}
): PublicationRecord {
  return {
    generatedAt: new Date().toISOString(),
    publicationId: randomUUID(),
    taskId,
    stage: 'collaboration',
    status,
    publishMode,
    summary: handoff.summary,
    handoffType: handoff.handoffType,
    approvalRequired: handoff.approvalRequired,
    autoCommitEnabled,
    artifactRefs: handoff.artifactRefs,
    nextActions: handoff.nextActions,
    ...overrides
  };
}

function writePublicationRecord(
  artifactBaseDir: string,
  publicationRecordPath: string,
  publicationRecord: PublicationRecord
): void {
  const validators = getSchemaValidators();
  if (!validators.publicationRecord(publicationRecord)) {
    throw new Error(`invalid publication-record payload: ${JSON.stringify(validators.publicationRecord.errors ?? [])}`);
  }

  writeJsonFrom(artifactBaseDir, publicationRecordPath, publicationRecord);
}

export function applyCollaborationPublicationPolicy(options: ApplyCollaborationPublicationOptions): CollaborationPublicationDecision {
  if (options.taskGraphTask.stage !== 'collaboration' || options.taskState.status !== 'completed') {
    return {
      status: 'not-applicable',
      generatedArtifacts: [],
      notes: []
    };
  }

  const handoff = readCollaborationHandoff(options.artifacts, options.artifactBaseDir);
  if (!handoff || handoff.readiness !== 'ready') {
    return {
      status: 'not-applicable',
      generatedArtifacts: [],
      notes: []
    };
  }

  const routeName = getRouteName(options.taskGraphTask.id);
  const repoRoot = resolveGitRepositoryRoot(options.artifactBaseDir);
  const publicationArtifactsDir = createPublicationArtifactsDir(repoRoot, routeName);
  const publicationRecordAbsolutePath = path.join(publicationArtifactsDir, 'publication-record.json');
  const publicationRecordPath = toRelativeArtifactPath(repoRoot, publicationRecordAbsolutePath);
  const generatedArtifacts: ArtifactRef[] = [];
  const autoCommitEnabled = options.taskGraphTask.reviewPolicy?.allowAutoCommit === true;
  const requireHumanApproval = options.taskGraphTask.reviewPolicy?.requireHumanApproval === true || handoff.approvalRequired === true;

  if (handoff.handoffType === 'pull-request') {
    ensureDirForFile(path.join(repoRoot, publicationRecordPath));
  }

  const writeDraftArtifact = (publicationRecord: PublicationRecord): ArtifactRef[] => {
    if (handoff.handoffType !== 'pull-request') {
      return [];
    }

    const prDraftAbsolutePath = path.join(publicationArtifactsDir, 'pr-draft.md');
    const prDraftPath = toRelativeArtifactPath(repoRoot, prDraftAbsolutePath);
    const updatedRecord = {
      ...publicationRecord,
      prTitle: publicationRecord.prTitle ?? buildPrTitle(routeName, handoff),
      prDraftPath
    };
    fs.mkdirSync(path.dirname(prDraftAbsolutePath), { recursive: true });
    fs.writeFileSync(prDraftAbsolutePath, buildPrDraftBody(handoff, updatedRecord), 'utf8');
    publicationRecord.prTitle = updatedRecord.prTitle;
    publicationRecord.prDraftPath = updatedRecord.prDraftPath;
    return [buildGeneratedArtifact(options.taskGraphTask.id, 'pr-draft', prDraftPath)];
  };

  if (requireHumanApproval) {
    const publicationRecord = buildPublicationRecord(handoff, options.taskGraphTask.id, autoCommitEnabled, 'approval-required', 'manual-handoff', {
      gateReason: 'human-approval-required'
    });
    const draftArtifacts = writeDraftArtifact(publicationRecord);
    writePublicationRecord(options.artifactBaseDir, publicationRecordPath, publicationRecord);
    generatedArtifacts.push(
      buildGeneratedArtifact(options.taskGraphTask.id, 'publication-record', publicationRecordPath),
      ...draftArtifacts
    );
    return {
      status: 'blocked',
      reason: 'human-approval-required',
      publication: publicationRecord,
      generatedArtifacts,
      notes: [
        'publication-gate:human-approval-required',
        ...(draftArtifacts.length > 0 ? [`publication-pr-draft:${draftArtifacts[0]?.path}`] : [])
      ]
    };
  }

  if (!autoCommitEnabled) {
    const publicationRecord = buildPublicationRecord(handoff, options.taskGraphTask.id, false, 'approval-required', 'manual-handoff', {
      gateReason: 'auto-commit-disabled'
    });
    const draftArtifacts = writeDraftArtifact(publicationRecord);
    writePublicationRecord(options.artifactBaseDir, publicationRecordPath, publicationRecord);
    generatedArtifacts.push(
      buildGeneratedArtifact(options.taskGraphTask.id, 'publication-record', publicationRecordPath),
      ...draftArtifacts
    );
    return {
      status: 'blocked',
      reason: 'auto-commit-disabled',
      publication: publicationRecord,
      generatedArtifacts,
      notes: [
        'publication-gate:auto-commit-disabled',
        ...(draftArtifacts.length > 0 ? [`publication-pr-draft:${draftArtifacts[0]?.path}`] : [])
      ]
    };
  }

  const implementationSummary = readImplementationSummary(options.allArtifacts, options.artifactBaseDir);
  const scopedChangedFiles = normalizePaths(getScopedChangedFiles(implementationSummary));
  if (scopedChangedFiles.length === 0) {
    const publicationRecord = buildPublicationRecord(handoff, options.taskGraphTask.id, true, 'blocked', 'auto-commit', {
      gateReason: 'missing-implementation-summary'
    });
    const draftArtifacts = writeDraftArtifact(publicationRecord);
    writePublicationRecord(options.artifactBaseDir, publicationRecordPath, publicationRecord);
    generatedArtifacts.push(
      buildGeneratedArtifact(options.taskGraphTask.id, 'publication-record', publicationRecordPath),
      ...draftArtifacts
    );
    return {
      status: 'blocked',
      reason: 'missing-implementation-summary',
      publication: publicationRecord,
      generatedArtifacts,
      notes: [
        'publication-blocked:missing-implementation-summary',
        ...(draftArtifacts.length > 0 ? [`publication-pr-draft:${draftArtifacts[0]?.path}`] : [])
      ]
    };
  }

  const scopedStagedFiles = normalizePaths(getStagedFiles(repoRoot));
  const stagedOutsideScope = scopedStagedFiles.filter((filePath) => !scopedChangedFiles.includes(filePath.replaceAll('\\', '/')));
  if (stagedOutsideScope.length > 0) {
    const publicationRecord = buildPublicationRecord(handoff, options.taskGraphTask.id, true, 'blocked', 'auto-commit', {
      gateReason: 'staged-changes-outside-scope'
    });
    const draftArtifacts = writeDraftArtifact(publicationRecord);
    writePublicationRecord(options.artifactBaseDir, publicationRecordPath, publicationRecord);
    generatedArtifacts.push(
      buildGeneratedArtifact(options.taskGraphTask.id, 'publication-record', publicationRecordPath),
      ...draftArtifacts
    );
    return {
      status: 'blocked',
      reason: 'staged-changes-outside-scope',
      publication: publicationRecord,
      generatedArtifacts,
      notes: [
        'publication-blocked:staged-changes-outside-scope',
        ...(draftArtifacts.length > 0 ? [`publication-pr-draft:${draftArtifacts[0]?.path}`] : [])
      ]
    };
  }

  const branchName = buildBranchName(routeName);
  const commitMessage = buildCommitMessage(routeName, handoff);

  try {
    runGit(repoRoot, ['checkout', '-b', branchName]);
    stageScopedFiles(repoRoot, scopedChangedFiles);
    const stagedScopedFiles = getStagedScopedFiles(repoRoot, scopedChangedFiles);
    if (stagedScopedFiles.length === 0) {
      const publicationRecord = buildPublicationRecord(handoff, options.taskGraphTask.id, true, 'blocked', 'auto-commit', {
        branchName,
        commitMessage,
        gateReason: 'no-scoped-changes'
      });
      const draftArtifacts = writeDraftArtifact(publicationRecord);
      writePublicationRecord(options.artifactBaseDir, publicationRecordPath, publicationRecord);
      generatedArtifacts.push(
        buildGeneratedArtifact(options.taskGraphTask.id, 'publication-record', publicationRecordPath),
        ...draftArtifacts
      );
      return {
        status: 'blocked',
        reason: 'no-scoped-changes',
        publication: publicationRecord,
        generatedArtifacts,
        notes: [
          `publication-branch:${branchName}`,
          'publication-blocked:no-scoped-changes',
          ...(draftArtifacts.length > 0 ? [`publication-pr-draft:${draftArtifacts[0]?.path}`] : [])
        ]
      };
    }

    runGit(repoRoot, ['commit', '-m', commitMessage]);
    const commitSha = runGit(repoRoot, ['rev-parse', 'HEAD']);
    const publicationRecord = buildPublicationRecord(handoff, options.taskGraphTask.id, true, 'published', 'auto-commit', {
      branchName,
      commitSha,
      commitMessage
    });
    const draftArtifacts = writeDraftArtifact(publicationRecord);
    writePublicationRecord(options.artifactBaseDir, publicationRecordPath, publicationRecord);
    generatedArtifacts.push(
      buildGeneratedArtifact(options.taskGraphTask.id, 'publication-record', publicationRecordPath),
      ...draftArtifacts
    );
    return {
      status: 'published',
      publication: publicationRecord,
      generatedArtifacts,
      notes: [
        'publication-status:published',
        `publication-branch:${branchName}`,
        `publication-commit:${commitSha}`,
        ...(draftArtifacts.length > 0 ? [`publication-pr-draft:${draftArtifacts[0]?.path}`] : [])
      ]
    };
  } catch {
    const publicationRecord = buildPublicationRecord(handoff, options.taskGraphTask.id, true, 'blocked', 'auto-commit', {
      branchName,
      commitMessage,
      gateReason: 'publish-command-failed'
    });
    const draftArtifacts = writeDraftArtifact(publicationRecord);
    writePublicationRecord(options.artifactBaseDir, publicationRecordPath, publicationRecord);
    generatedArtifacts.push(
      buildGeneratedArtifact(options.taskGraphTask.id, 'publication-record', publicationRecordPath),
      ...draftArtifacts
    );
    return {
      status: 'blocked',
      reason: 'publish-command-failed',
      publication: publicationRecord,
      generatedArtifacts,
      notes: [
        `publication-branch:${branchName}`,
        'publication-blocked:publish-command-failed',
        ...(draftArtifacts.length > 0 ? [`publication-pr-draft:${draftArtifacts[0]?.path}`] : [])
      ]
    };
  }
}
