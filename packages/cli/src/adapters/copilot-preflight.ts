import { createHash } from 'node:crypto';
import { execFileSync as defaultExecFileSync } from 'node:child_process';
import type { ExecFileSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ensureDirForFile, fail, writeJson } from '../shared/fs-utils.js';
import { extractCopilotAssistantContent, extractJsonPayload } from './adapter-normalizer.js';
import type { AdapterRuntimeDocument } from '../types/index.js';

export type CliOptions = Record<string, string | boolean | undefined>;

export interface CommandCaptureResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: unknown;
}

export interface PreflightCheck {
  name: string;
  status: 'passed' | 'failed';
  message: string;
}

export interface CopilotPreflightReport {
  adapterRuntimeRef: string;
  provider: string;
  configuredModel: string | null;
  effectiveModel: string;
  checks: PreflightCheck[];
  status?: 'passed' | 'failed';
}

export interface CopilotPreflightReportDocument {
  preflight: CopilotPreflightReport;
}

export interface PreflightDependencies {
  execFileSync?: typeof defaultExecFileSync;
  now?: () => number;
}

interface CachedCopilotPreflightReportRecord {
  fingerprint: string;
  cachedAt: string;
  report: CopilotPreflightReportDocument;
}

export interface ResolvedCopilotPreflightReport {
  report: CopilotPreflightReportDocument;
  blockingFailures: PreflightCheck[];
  cacheHit: boolean;
  cachePath: string;
}

export const defaultCopilotPreflightCacheTtlMs = 15 * 60 * 1000;

function getNowTimestamp(dependencies: PreflightDependencies): number {
  return dependencies.now?.() ?? Date.now();
}

function resolvePreflightBaseDir(adapterRuntimePath: string, adapterRuntimePayload: AdapterRuntimeDocument): string {
  const runtimePathDir = path.dirname(path.resolve(adapterRuntimePath));
  const runtimeCwd = adapterRuntimePayload.adapterRuntime.cwd?.trim();

  return runtimeCwd ? path.resolve(runtimePathDir, runtimeCwd) : runtimePathDir;
}

function buildCopilotPreflightCacheFingerprint(adapterRuntimePath: string, adapterRuntimePayload: AdapterRuntimeDocument): string {
  const adapterRuntime = adapterRuntimePayload.adapterRuntime;
  const fingerprintSource = JSON.stringify({
    version: 1,
    adapterRuntimeRef: path.resolve(adapterRuntimePath),
    provider: adapterRuntime.provider ?? 'unknown',
    model: adapterRuntime.model ?? '',
    cwd: resolvePreflightBaseDir(adapterRuntimePath, adapterRuntimePayload)
  });

  return createHash('sha256').update(fingerprintSource).digest('hex');
}

export function buildCopilotPreflightCachePath(adapterRuntimePath: string, adapterRuntimePayload: AdapterRuntimeDocument): string {
  const fingerprint = buildCopilotPreflightCacheFingerprint(adapterRuntimePath, adapterRuntimePayload);
  return path.join(
    resolvePreflightBaseDir(adapterRuntimePath, adapterRuntimePayload),
    '.spec2flow',
    'runtime',
    'copilot-preflight-cache',
    `${fingerprint}.json`
  );
}

function readCachedCopilotPreflightReport(
  adapterRuntimePath: string,
  adapterRuntimePayload: AdapterRuntimeDocument,
  dependencies: PreflightDependencies
): CopilotPreflightReportDocument | null {
  const cachePath = buildCopilotPreflightCachePath(adapterRuntimePath, adapterRuntimePayload);
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const cacheRecord = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CachedCopilotPreflightReportRecord;
    const expectedFingerprint = buildCopilotPreflightCacheFingerprint(adapterRuntimePath, adapterRuntimePayload);
    if (cacheRecord.fingerprint !== expectedFingerprint || cacheRecord.report?.preflight?.status !== 'passed') {
      return null;
    }

    const cachedAt = Date.parse(cacheRecord.cachedAt);
    if (Number.isNaN(cachedAt)) {
      return null;
    }

    if (getNowTimestamp(dependencies) - cachedAt > defaultCopilotPreflightCacheTtlMs) {
      return null;
    }

    return cacheRecord.report;
  } catch {
    return null;
  }
}

function writeCachedCopilotPreflightReport(
  adapterRuntimePath: string,
  adapterRuntimePayload: AdapterRuntimeDocument,
  report: CopilotPreflightReportDocument,
  dependencies: PreflightDependencies
): string {
  const cachePath = buildCopilotPreflightCachePath(adapterRuntimePath, adapterRuntimePayload);
  const cacheRecord: CachedCopilotPreflightReportRecord = {
    fingerprint: buildCopilotPreflightCacheFingerprint(adapterRuntimePath, adapterRuntimePayload),
    cachedAt: new Date(getNowTimestamp(dependencies)).toISOString(),
    report
  };

  ensureDirForFile(cachePath);
  fs.writeFileSync(cachePath, `${JSON.stringify(cacheRecord, null, 2)}\n`, 'utf8');
  return cachePath;
}

export function runCommandCapture(
  command: string,
  args: string[],
  execOptions: ExecFileSyncOptions | undefined,
  dependencies: PreflightDependencies = {}
): CommandCaptureResult {
  const execFileSync = dependencies.execFileSync ?? defaultExecFileSync;
  const resolvedExecOptions = execOptions ? { ...execOptions } : undefined;

  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...resolvedExecOptions
    });

    return {
      ok: true,
      stdout: String(stdout),
      stderr: ''
    };
  } catch (error) {
    const commandError = error as {
      stdout?: { toString(): string };
      stderr?: { toString(): string };
    };

    return {
      ok: false,
      stdout: commandError.stdout?.toString() ?? '',
      stderr: commandError.stderr?.toString() ?? '',
      error
    };
  }
}

export function buildCopilotPreflightPrompt(): string {
  return [
    'Run the shell command pwd using Copilot tools, then respond with exactly this JSON shape and nothing else.',
    'Set status to completed only if the shell command succeeded.',
    'Use summary ok when the shell command succeeded.',
    'Return JSON only with keys: status, summary, notes, deliverable, errors.',
    'Set deliverable.cwd to the command output.',
    'Set errors to an empty array on success.'
  ].join(' ');
}

export function getCommandResultMessage(commandResult: CommandCaptureResult, fallbackMessage: string): string {
  return commandResult.stderr.trim() || commandResult.stdout.trim() || String(commandResult.error ?? '') || fallbackMessage;
}

export function buildPreflightCheck(name: string, status: PreflightCheck['status'], message: string): PreflightCheck {
  return { name, status, message };
}

export function getBlockingPreflightFailures(checks: PreflightCheck[]): PreflightCheck[] {
  const blockingCheckNames = new Set(['gh copilot help', 'gh copilot agent probe']);
  return checks.filter((check) => blockingCheckNames.has(check.name) && check.status === 'failed');
}

export function buildCopilotProbeArgs(configuredModel: string): string[] {
  const args = [
    'copilot',
    '--',
    '--output-format',
    'json',
    '-p',
    buildCopilotPreflightPrompt(),
    '-s',
    '--stream',
    'off',
    '--no-color',
    '--allow-all-paths',
    '--allow-all-tools',
    '--no-ask-user'
  ];

  if (configuredModel) {
    args.push('--model', configuredModel);
  }

  return args;
}

export function evaluateCopilotProbe(probeResult: CommandCaptureResult): PreflightCheck {
  if (!probeResult.ok) {
    return buildPreflightCheck('gh copilot agent probe', 'failed', getCommandResultMessage(probeResult, 'gh copilot agent probe failed'));
  }

  try {
    const assistantContent = extractCopilotAssistantContent(probeResult.stdout);
    const payload = JSON.parse(extractJsonPayload(assistantContent)) as {
      status?: string;
      summary?: string;
      deliverable?: { cwd?: string };
    };

    if (payload.status === 'completed' && payload.summary === 'ok' && payload.deliverable?.cwd) {
      return buildPreflightCheck('gh copilot agent probe', 'passed', 'gh copilot completed a tool-enabled JSON probe');
    }

    return buildPreflightCheck('gh copilot agent probe', 'failed', 'gh copilot returned JSON but did not complete the tool-enabled probe as expected');
  } catch (error) {
    const probeError = error as { message?: string };
    return buildPreflightCheck('gh copilot agent probe', 'failed', `gh copilot returned non-JSON output: ${probeError.message ?? 'unknown error'}`);
  }
}

export function buildCopilotPreflightReport(
  adapterRuntimePath: string,
  adapterRuntimePayload: AdapterRuntimeDocument,
  dependencies: PreflightDependencies
): { report: CopilotPreflightReportDocument; blockingFailures: PreflightCheck[] } {
  const adapterRuntime = adapterRuntimePayload.adapterRuntime;
  const configuredModel = adapterRuntime.model ?? '';
  const report: CopilotPreflightReportDocument = {
    preflight: {
      adapterRuntimeRef: adapterRuntimePath,
      provider: adapterRuntime.provider ?? 'unknown',
      configuredModel: configuredModel || null,
      effectiveModel: configuredModel || 'copilot-default',
      checks: []
    }
  };

  const helpResult = runCommandCapture('gh', ['copilot', '--', '--help'], {}, dependencies);
  report.preflight.checks.push(buildPreflightCheck(
    'gh copilot help',
    helpResult.ok ? 'passed' : 'failed',
    helpResult.ok ? 'gh copilot command is available' : getCommandResultMessage(helpResult, 'gh copilot help failed')
  ));

  const authResult = runCommandCapture('gh', ['auth', 'status'], {}, dependencies);
  report.preflight.checks.push(buildPreflightCheck(
    'gh auth status',
    authResult.ok ? 'passed' : 'failed',
    authResult.ok ? 'gh auth status succeeded' : getCommandResultMessage(authResult, 'gh auth status failed')
  ));

  const probeResult = runCommandCapture(
    'gh',
    buildCopilotProbeArgs(configuredModel),
    {
      env: {
        ...process.env,
        COPILOT_ALLOW_ALL: 'true'
      }
    },
    dependencies
  );
  report.preflight.checks.push(evaluateCopilotProbe(probeResult));

  const blockingFailures = getBlockingPreflightFailures(report.preflight.checks);
  report.preflight.status = blockingFailures.length === 0 ? 'passed' : 'failed';

  return { report, blockingFailures };
}

export function resolveCopilotPreflightReport(
  adapterRuntimePath: string,
  adapterRuntimePayload: AdapterRuntimeDocument,
  dependencies: PreflightDependencies = {}
): ResolvedCopilotPreflightReport {
  const cachedReport = readCachedCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload, dependencies);
  if (cachedReport) {
    return {
      report: cachedReport,
      blockingFailures: [],
      cacheHit: true,
      cachePath: buildCopilotPreflightCachePath(adapterRuntimePath, adapterRuntimePayload)
    };
  }

  const { report, blockingFailures } = buildCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload, dependencies);
  const cachePath = buildCopilotPreflightCachePath(adapterRuntimePath, adapterRuntimePayload);
  if (blockingFailures.length === 0 && report.preflight.status === 'passed') {
    writeCachedCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload, report, dependencies);
  }

  return {
    report,
    blockingFailures,
    cacheHit: false,
    cachePath
  };
}

export function maybeWritePreflightReport(outputPath: string | undefined, report: CopilotPreflightReportDocument): void {
  if (!outputPath) {
    return;
  }

  writeJson(outputPath, report);
  console.log(`Wrote Copilot CLI preflight report to ${outputPath}`);
}

export function ensureAdapterPreflight(
  options: CliOptions,
  adapterRuntimePayload: AdapterRuntimeDocument,
  dependencies?: PreflightDependencies
): void {
  if (options['skip-preflight']) {
    return;
  }

  const adapterRuntimePath = options['adapter-runtime'];
  if (typeof adapterRuntimePath !== 'string' || adapterRuntimePayload.adapterRuntime.provider !== 'github-copilot-cli') {
    return;
  }

  const { report, blockingFailures } = resolveCopilotPreflightReport(adapterRuntimePath, adapterRuntimePayload, dependencies ?? {});
  const preflightOutput = typeof options['preflight-output'] === 'string' ? options['preflight-output'] : undefined;
  maybeWritePreflightReport(preflightOutput, report);

  if (blockingFailures.length > 0) {
    const failureSummary = blockingFailures.map((check) => `${check.name}: ${check.message}`).join(' | ');
    fail(`copilot cli preflight failed: ${failureSummary}`);
  }
}