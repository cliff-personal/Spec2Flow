import fs from 'node:fs';
import path from 'node:path';

const EXCLUDED_DIRECTORY_NAMES = new Set(['.git', '.spec2flow', 'node_modules', 'spec2flow']);
const EXCLUDED_DIRECTORY_PATHS = new Set(['packages/cli/dist']);
const CANONICAL_DOCS = new Set(['AGENTS.md', '.github/copilot-instructions.md']);
const MARKDOWN_FILE_EXTENSION = '.md';

export interface DocsValidationIssue {
  file: string;
  kind: 'metadata' | 'source-of-truth' | 'script' | 'link' | 'layout';
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
}

export function buildDocsValidationReport(repoRoot: string): DocsValidationReportDocument {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { scripts?: Record<string, string> };
  const availableScripts = new Set(Object.keys(packageJson.scripts ?? {}));
  const markdownFiles = collectMarkdownFiles(repoRoot);
  const issues: DocsValidationIssue[] = [];
  const validatedFiles: string[] = [];

  for (const filePath of markdownFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const relativeFilePath = toRepoRelativePath(repoRoot, filePath);
    const metadata = parseMetadata(content);
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
    }

    if (isCanonicalDoc || isActiveDoc) {
      validateArchivedPlanReferences(relativeFilePath, metadata.sourceOfTruthLine, content, issues);
    }

    validateReferencedScripts(relativeFilePath, content, availableScripts, issues);
    validateMarkdownLinks(repoRoot, filePath, relativeFilePath, content, issues);
  }

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
    verifiedWithLine: matchMetadataValue(content, /^- Verified with:\s*(.+)$/m)
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

function validateReferencedScripts(
  relativeFilePath: string,
  content: string,
  availableScripts: Set<string>,
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
  relativeFilePath: string,
  sourceOfTruthLine: string | null,
  content: string,
  issues: DocsValidationIssue[]
): void {
  for (const sourcePath of extractBacktickedValues(sourceOfTruthLine ?? '')) {
    if (!isDirectArchivedPlanDocument(sourcePath)) {
      continue;
    }

    issues.push({
      file: relativeFilePath,
      kind: 'source-of-truth',
      message: `active or canonical docs cannot use archived plan files as source of truth: ${sourcePath}`
    });
  }

  for (const linkTarget of extractMarkdownLinkTargets(content)) {
    if (!isDirectArchivedPlanDocument(linkTarget)) {
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

function isDirectArchivedPlanDocument(targetPath: string): boolean {
  const normalizedTarget = targetPath.replace(/\\/g, '/');

  return /^docs\/plans\/(historical|completed)\/.+\.md$/i.test(normalizedTarget)
    && !/\/index\.md$/i.test(normalizedTarget);
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

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function toRepoRelativePathOrAbsolute(repoRoot: string, candidatePath: string): string {
  const relativePath = toRepoRelativePath(repoRoot, candidatePath);
  return relativePath.startsWith('..') ? candidatePath : relativePath;
}