import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function resolveFromCwd(value: string): string {
  return path.resolve(process.cwd(), value);
}

export function readStructuredFile(filePath: string): unknown {
  const resolvedPath = resolveFromCwd(filePath);
  const content = fs.readFileSync(resolvedPath, 'utf8');

  if (resolvedPath.endsWith('.json')) {
    return JSON.parse(content) as unknown;
  }

  return yaml.load(content, { schema: yaml.JSON_SCHEMA });
}

export function readJsonFile<T = unknown>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function readTextFile(filePath: string): string {
  return fs.readFileSync(resolveFromCwd(filePath), 'utf8');
}

export function readChangedFilesContent(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export function ensureDirForFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeJson(filePath: string, data: unknown): void {
  const resolvedPath = resolveFromCwd(filePath);
  ensureDirForFile(resolvedPath);
  fs.writeFileSync(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function resolveMaybeFromCwd(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  return resolveFromCwd(value);
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function loadOptionalStructuredFile<T = unknown>(filePath: string | undefined): T | null {
  const resolvedPath = resolveMaybeFromCwd(filePath);
  if (!resolvedPath || !fileExists(resolvedPath)) {
    return null;
  }

  const existingFilePath = filePath as string;

  return readStructuredFile(existingFilePath) as T;
}

export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function parseCsvOption(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}