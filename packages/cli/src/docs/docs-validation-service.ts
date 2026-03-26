import fs from 'node:fs';
import path from 'node:path';

const EXCLUDED_DIRECTORY_NAMES = new Set(['.git', '.spec2flow', 'node_modules', 'spec2flow']);
const EXCLUDED_DIRECTORY_PATHS = new Set(['packages/cli/dist']);
const CANONICAL_DOCS = new Set(['AGENTS.md', '.github/copilot-instructions.md']);
const MARKDOWN_FILE_EXTENSION = '.md';
const ACTIVE_DOC_FRESHNESS_WINDOW_DAYS = 120;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const OVERBROAD_SOURCE_OF_TRUTH_PATHS = new Set([
  'packages/cli/src/adapters',
  'packages/cli/src/planning',
  'packages/cli/src/platform',
  'packages/cli/src/runtime',
  'packages/cli/src/types',
  'packages/web',
  'schemas'
]);

export interface DocsValidationIssue {
  file: string;
  kind: 'metadata' | 'source-of-truth' | 'script' | 'link' | 'layout' | 'supersession';
  message: string;
}

export interface DocsValidationReportDocument {
  validator: 'docs';
  status: 'passed' | 'failed';
  repoRoot: string;
  summary: {
    scannedMarkdownFiles: number;
    validatedFiles: number;
    issueCount: number;
  };
  validatedFiles: string[];
  issues: DocsValidationIssue[];
}

interface ParsedMetadata {
  status: string | null;
  sourceOfTruthLine: string | null;
  verifiedWithLine: string | null;
  lastVerifiedLine: string | null;
  supersedesLine: string | null;
  supersededByLine: string | null;
}

interface DocsValidationConfig {
  deprecatedScripts: Map<string, string>;
}

interface MarkdownDocumentEntry {
  content: string;
  filePath: string;
  metadata: ParsedMetadata;
  relativeFilePath: string;
}

export function buildDocsValidationReport(
  repoRoot: string,
  options?: { now?: Date }
): DocsValidationReportDocument {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
    spec2flow?: { docsValidation?: { deprecatedScripts?: Record<string, string> } };
  };
  const availableScripts = new Set(Object.keys(packageJson.scripts ?? {}));
  const config = parseDocsValidationConfig(packageJson);
  const markdownFiles = collectMarkdownFiles(repoRoot);
  const issues: DocsValidationIssue[] = [];
  const validatedFiles: string[] = [];
  const now = normalizeToUtcDay(options?.now ?? new Date());
  const documentEntries: MarkdownDocumentEntry[] = [];

  for (const filePath of markdownFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const relativeFilePath = toRepoRelativePath(repoRoot, filePath);
    const metadata = parseMetadata(content);
    documentEntries.push({
      content,
      filePath,
      metadata,
      relativeFilePath
    });
    const isCanonicalDoc = CANONICAL_DOCS.has(relativeFilePath);
    const isActiveDoc = metadata.status === 'active';

    validateDocsLayout(relativeFilePath, metadata, issues);

    if (!isCanonicalDoc && !isActiveDoc) {
      continue;
    }

    validatedFiles.push(relativeFilePath);

    if (isActiveDoc) {
      validateRequiredMetadata(relativeFilePath, metadata, issues);
      validateSourceOfTruthPaths(repoRoot, relativeFilePath, metadata.sourceOfTruthLine, issues);
      validateSourceOfTruthScope(repoRoot, relativeFilePath, metadata.sourceOfTruthLine, issues);
      validateLastVerified(relativeFilePath, metadata.lastVerifiedLine, now, issues);
    }

    if (isCanonicalDoc || isActiveDoc) {
      validateArchivedPlanReferences(repoRoot, relativeFilePath, metadata.sourceOfTruthLine, content, issues);
    }

    validateReferencedScripts(relativeFilePath, content, availableScripts, config.deprecatedScripts, issues);
    validateMarkdownLinks(repoRoot, filePath, relativeFilePath, content, issues);
  }

  validateSupersessionRelationships(repoRoot, documentEntries, issues);

  validatedFiles.sort((left, right) => left.localeCompare(right));
  issues.sort((left, right) => {
    if (left.file === right.file) {
      return left.message.localeCompare(right.message);
    }

    return left.file.localeCompare(right.file);
  });

  return {
    validator: 'docs',
    status: issues.length === 0 ? 'passed' : 'failed',
    repoRoot,
    summary: {
      scannedMarkdownFiles: markdownFiles.length,
      validatedFiles: validatedFiles.length,
      issueCount: issues.length
    },
    validatedFiles,
    issues
  };
}

function collectMarkdownFiles(repoRoot: string): string[] {
  const collected: string[] = [];
  walk(repoRoot, repoRoot, collected);
  collected.sort((left, right) => left.localeCompare(right));
  return collected;
}

function walk(repoRoot: string, currentPath: string, collected: string[]): void {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = toRepoRelativePath(repoRoot, absolutePath);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name) || EXCLUDED_DIRECTORY_PATHS.has(relativePath)) {
        continue;
      }

      walk(repoRoot, absolutePath, collected);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(MARKDOWN_FILE_EXTENSION)) {
      continue;
    }

    collected.push(absolutePath);
  }
}

function parseMetadata(content: string): ParsedMetadata {
  return {
    status: matchMetadataValue(content, /^- Status:\s*(.+)$/m),
    sourceOfTruthLine: matchMetadataValue(content, /^- Source of truth:\s*(.+)$/m),
    verifiedWithLine: matchMetadataValue(content, /^- Verified with:\s*(.+)$/m),
    lastVerifiedLine: matchMetadataValue(content, /^- Last verified:\s*(.+)$/m),
    supersedesLine: matchMetadataValue(content, /^- Supersedes:\s*(.+)$/m),
    supersededByLine: matchMetadataValue(content, /^- Superseded by:\s*(.+)$/m)
  };
}

function matchMetadataValue(content: string, pattern: RegExp): string | null {
  const match = pattern.exec(content);
  return match?.[1]?.trim() ?? null;
}

function validateRequiredMetadata(
  relativeFilePath: string,
  metadata: ParsedMetadata,
  issues: DocsValidationIssue[]
): void {
  if (!metadata.status) {
    issues.push({
      file: relativeFilePath,
      kind: 'metadata',
      message: 'missing Status metadata'
    });
  }

  if (!metadata.sourceOfTruthLine) {
    issues.push({
      file: relativeFilePath,
      kind: 'metadata',
      message: 'missing Source of truth metadata'
    });
  }

  if (!metadata.verifiedWithLine) {
    issues.push({
      file: relativeFilePath,
      kind: 'metadata',
      message: 'missing Verified with metadata'
    });
  }

  if (!metadata.lastVerifiedLine) {
    issues.push({
      file: relativeFilePath,
      kind: 'metadata',
      message: 'missing Last verified metadata'
    });
  }
}

function validateSourceOfTruthPaths(
  repoRoot: string,
  relativeFilePath: string,
  sourceOfTruthLine: string | null,
  issues: DocsValidationIssue[]
): void {
  if (!sourceOfTruthLine) {
    return;
  }

  for (const sourcePath of extractBacktickedValues(sourceOfTruthLine)) {
    const resolvedPath = path.isAbsolute(sourcePath) ? sourcePath : path.join(repoRoot, sourcePath);
    if (fs.existsSync(resolvedPath)) {
      continue;
    }

    issues.push({
      file: relativeFilePath,
      kind: 'source-of-truth',
      message: `source of truth path does not exist: ${sourcePath}`
    });
  }
}

function validateSourceOfTruthScope(
  repoRoot: string,
  relativeFilePath: string,
  sourceOfTruthLine: string | null,
  issues: DocsValidationIssue[]
): void {
  if (!sourceOfTruthLine) {
    return;
  }

  for (const sourcePath of extractBacktickedValues(sourceOfTruthLine)) {
    if (!isOverbroadSourceOfTruthPath(repoRoot, sourcePath)) {
      continue;
    }

    issues.push({
      file: relativeFilePath,
      kind: 'source-of-truth',
      message: `source of truth path is too broad for an active doc; reference concrete files instead: ${sourcePath}`
    });
  }
}

function validateLastVerified(
  relativeFilePath: string,
  lastVerifiedLine: string | null,
  now: Date,
  issues: DocsValidationIssue[]
): void {
  if (!lastVerifiedLine) {
    return;
  }

  const parsedDate = parseIsoDay(lastVerifiedLine);
  if (!parsedDate) {
    issues.push({
      file: relativeFilePath,
      kind: 'metadata',
      message: 'Last verified metadata must use YYYY-MM-DD'
    });
    return;
  }

  if (parsedDate.getTime() > now.getTime()) {
    issues.push({
      file: relativeFilePath,
      kind: 'metadata',
      message: `Last verified date cannot be in the future: ${lastVerifiedLine}`
    });
    return;
  }

  const ageInDays = Math.floor((now.getTime() - parsedDate.getTime()) / MILLISECONDS_PER_DAY);
  if (ageInDays > ACTIVE_DOC_FRESHNESS_WINDOW_DAYS) {
    issues.push({
      file: relativeFilePath,
      kind: 'metadata',
      message: `active doc freshness window exceeded: ${lastVerifiedLine} is older than ${ACTIVE_DOC_FRESHNESS_WINDOW_DAYS} days`
    });
  }
}

function validateReferencedScripts(
  relativeFilePath: string,
  content: string,
  availableScripts: Set<string>,
  deprecatedScripts: Map<string, string>,
  issues: DocsValidationIssue[]
): void {
  const referencedScripts = new Set<string>();

  for (const match of content.matchAll(/npm run ([a-z0-9:-]+)/gi)) {
    const scriptName = match[1];
    if (scriptName) {
      referencedScripts.add(scriptName);
    }
  }

  for (const scriptName of referencedScripts) {
    if (deprecatedScripts.has(scriptName)) {
      issues.push({
        file: relativeFilePath,
        kind: 'script',
        message: `referenced npm script is deprecated: ${scriptName}; use ${deprecatedScripts.get(scriptName)}`
      });
      continue;
    }

    if (availableScripts.has(scriptName)) {
      continue;
    }

    issues.push({
      file: relativeFilePath,
      kind: 'script',
      message: `referenced npm script does not exist: ${scriptName}`
    });
  }
}

function validateSupersessionRelationships(
  repoRoot: string,
  documentEntries: MarkdownDocumentEntry[],
  issues: DocsValidationIssue[]
): void {
  const entriesByRelativePath = new Map(
    documentEntries.map((entry) => [entry.relativeFilePath, entry] as const)
  );

  for (const entry of documentEntries) {
    validateSupersessionDirection(
      repoRoot,
      entry,
      entry.metadata.supersedesLine,
      'Supersedes',
      'Superseded by',
      (peerMetadata) => peerMetadata.supersededByLine,
      entriesByRelativePath,
      issues
    );
    validateSupersessionDirection(
      repoRoot,
      entry,
      entry.metadata.supersededByLine,
      'Superseded by',
      'Supersedes',
      (peerMetadata) => peerMetadata.supersedesLine,
      entriesByRelativePath,
      issues
    );
  }
}

function validateSupersessionDirection(
  repoRoot: string,
  entry: MarkdownDocumentEntry,
  metadataLine: string | null,
  directionLabel: 'Supersedes' | 'Superseded by',
  reciprocalLabel: 'Supersedes' | 'Superseded by',
  reciprocalSelector: (metadata: ParsedMetadata) => string | null,
  entriesByRelativePath: Map<string, MarkdownDocumentEntry>,
  issues: DocsValidationIssue[]
): void {
  for (const rawTargetPath of extractBacktickedValues(metadataLine ?? '')) {
    const resolvedTargetPath = resolveRepoRelativePath(repoRoot, path.dirname(entry.filePath), rawTargetPath);
    if (!resolvedTargetPath) {
      issues.push({
        file: entry.relativeFilePath,
        kind: 'supersession',
        message: `${directionLabel} target does not exist: ${rawTargetPath}`
      });
      continue;
    }

    if (!resolvedTargetPath.endsWith(MARKDOWN_FILE_EXTENSION)) {
      issues.push({
        file: entry.relativeFilePath,
        kind: 'supersession',
        message: `${directionLabel} target must be a markdown file: ${rawTargetPath}`
      });
      continue;
    }

    if (resolvedTargetPath === entry.relativeFilePath) {
      issues.push({
        file: entry.relativeFilePath,
        kind: 'supersession',
        message: `${directionLabel} cannot reference the same file: ${rawTargetPath}`
      });
      continue;
    }

    const peerEntry = entriesByRelativePath.get(resolvedTargetPath);
    if (!peerEntry) {
      issues.push({
        file: entry.relativeFilePath,
        kind: 'supersession',
        message: `${directionLabel} target is outside the validated markdown set: ${rawTargetPath}`
      });
      continue;
    }

    const reciprocalTargets = extractBacktickedValues(reciprocalSelector(peerEntry.metadata) ?? '')
      .map((candidate) => resolveRepoRelativePath(repoRoot, path.dirname(peerEntry.filePath), candidate))
      .filter((candidate): candidate is string => Boolean(candidate));

    if (reciprocalTargets.includes(entry.relativeFilePath)) {
      continue;
    }

    issues.push({
      file: entry.relativeFilePath,
      kind: 'supersession',
      message: `${directionLabel} relationship must be reciprocal: ${entry.relativeFilePath} -> ${resolvedTargetPath} requires ${reciprocalLabel}`
    });
  }
}

function validateMarkdownLinks(
  repoRoot: string,
  absoluteFilePath: string,
  relativeFilePath: string,
  content: string,
  issues: DocsValidationIssue[]
): void {
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const rawTargetValue = match[1];
    if (!rawTargetValue) {
      continue;
    }

    const rawTarget = rawTargetValue.trim();
    if (!rawTarget || shouldIgnoreLinkTarget(rawTarget)) {
      continue;
    }

    const sanitizedTarget = decodeURIComponent(stripWrappingAngleBrackets(stripOptionalTitle(rawTarget)).split('#', 1)[0] ?? '');
    if (!sanitizedTarget) {
      continue;
    }

    const resolvedTarget = path.isAbsolute(sanitizedTarget)
      ? sanitizedTarget
      : path.resolve(path.dirname(absoluteFilePath), sanitizedTarget);

    if (fs.existsSync(resolvedTarget)) {
      continue;
    }

    const displayTarget = path.isAbsolute(sanitizedTarget)
      ? toRepoRelativePathOrAbsolute(repoRoot, sanitizedTarget)
      : toRepoRelativePathOrAbsolute(repoRoot, resolvedTarget);

    issues.push({
      file: relativeFilePath,
      kind: 'link',
      message: `linked file does not exist: ${displayTarget}`
    });
  }
}

function validateDocsLayout(relativeFilePath: string, metadata: ParsedMetadata, issues: DocsValidationIssue[]): void {
  if (!relativeFilePath.startsWith('docs/')) {
    return;
  }

  if (isHistoricalOrCompletedDocInDocsRoot(relativeFilePath, metadata.status)) {
    issues.push({
      file: relativeFilePath,
      kind: 'layout',
      message: 'completed or historical docs must live under docs/plans/ instead of docs root'
    });
  }

  if (isPlanLikeDocInDocsRoot(relativeFilePath)) {
    issues.push({
      file: relativeFilePath,
      kind: 'layout',
      message: 'plan, roadmap, migration, and rollout docs must live under docs/plans/'
    });
  }
}

function validateArchivedPlanReferences(
  repoRoot: string,
  relativeFilePath: string,
  sourceOfTruthLine: string | null,
  content: string,
  issues: DocsValidationIssue[]
): void {
  for (const sourcePath of extractBacktickedValues(sourceOfTruthLine ?? '')) {
    if (!isDirectArchivedPlanDocument(repoRoot, sourcePath)) {
      continue;
    }

    issues.push({
      file: relativeFilePath,
      kind: 'source-of-truth',
      message: `active or canonical docs cannot use archived plan files as source of truth: ${sourcePath}`
    });
  }

  for (const linkTarget of extractMarkdownLinkTargets(content)) {
    if (!isDirectArchivedPlanDocument(repoRoot, linkTarget)) {
      continue;
    }

    issues.push({
      file: relativeFilePath,
      kind: 'layout',
      message: `active or canonical docs must link to plan indexes instead of archived plan files: ${linkTarget}`
    });
  }
}

function isHistoricalOrCompletedDocInDocsRoot(relativeFilePath: string, status: string | null): boolean {
  return isDirectChildOfDocs(relativeFilePath) && (status === 'historical' || status === 'completed');
}

function isPlanLikeDocInDocsRoot(relativeFilePath: string): boolean {
  if (!isDirectChildOfDocs(relativeFilePath)) {
    return false;
  }

  const fileName = path.basename(relativeFilePath, MARKDOWN_FILE_EXTENSION).toLowerCase();
  return /(plan|roadmap|migration|rollout)/.test(fileName);
}

function isDirectChildOfDocs(relativeFilePath: string): boolean {
  const segments = relativeFilePath.split('/');
  return segments.length === 2;
}

function isDirectArchivedPlanDocument(repoRoot: string, targetPath: string): boolean {
  const normalizedTarget = normalizeReferencePath(repoRoot, targetPath);

  return /^docs\/plans\/(historical|completed)\/.+\.md$/i.test(normalizedTarget)
    && !/\/index\.md$/i.test(normalizedTarget);
}

function isOverbroadSourceOfTruthPath(repoRoot: string, sourcePath: string): boolean {
  const normalizedPath = normalizeReferencePath(repoRoot, sourcePath);
  return OVERBROAD_SOURCE_OF_TRUTH_PATHS.has(normalizedPath);
}

function normalizeReferencePath(repoRoot: string, targetPath: string): string {
  const normalizedPath = targetPath.replace(/\\/g, '/').trim();
  if (!normalizedPath) {
    return normalizedPath;
  }

  const normalizedRepoRoot = repoRoot.replace(/\\/g, '/').replace(/\/+$/g, '');
  const repoRootWithSlash = `${normalizedRepoRoot}/`;
  if (normalizedPath.startsWith(repoRootWithSlash)) {
    return normalizedPath.slice(repoRootWithSlash.length).replace(/\/+$/g, '');
  }

  return normalizedPath.replace(/^\.\/+/g, '').replace(/\/+$/g, '');
}

function shouldIgnoreLinkTarget(target: string): boolean {
  return target.startsWith('#')
    || /^https?:\/\//i.test(target)
    || /^mailto:/i.test(target);
}

function stripOptionalTitle(target: string): string {
  const titleMatch = /^([^\s]+)\s+".*"$/.exec(target);
  return titleMatch?.[1] ?? target;
}

function stripWrappingAngleBrackets(target: string): string {
  if (target.startsWith('<') && target.endsWith('>')) {
    return target.slice(1, -1);
  }

  return target;
}

function extractBacktickedValues(value: string): string[] {
  const matches = [...value.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);
  return matches;
}

function extractMarkdownLinkTargets(content: string): string[] {
  return [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
    .map((target) => decodeURIComponent(stripWrappingAngleBrackets(stripOptionalTitle(target)).split('#', 1)[0] ?? ''));
}

function parseDocsValidationConfig(packageJson: {
  spec2flow?: { docsValidation?: { deprecatedScripts?: Record<string, string> } };
}): DocsValidationConfig {
  return {
    deprecatedScripts: new Map(Object.entries(packageJson.spec2flow?.docsValidation?.deprecatedScripts ?? {}))
  };
}

function resolveRepoRelativePath(repoRoot: string, baseDirectory: string, targetPath: string): string | null {
  const resolvedPath = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(baseDirectory, targetPath);

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return toRepoRelativePathOrAbsolute(repoRoot, resolvedPath);
}

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function toRepoRelativePathOrAbsolute(repoRoot: string, candidatePath: string): string {
  const relativePath = toRepoRelativePath(repoRoot, candidatePath);
  return relativePath.startsWith('..') ? candidatePath : relativePath;
}

function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    return null;
  }

  return parsedDate;
}

function normalizeToUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
