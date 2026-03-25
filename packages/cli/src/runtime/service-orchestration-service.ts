import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ensureDirForFile, loadOptionalStructuredFileFrom, resolveFromBaseDir, writeJsonFrom } from '../shared/fs-utils.js';
import type { ExecutionArtifactStore } from './execution-artifact-store-service.js';

type HealthCheckType = 'http' | 'tcp' | 'command' | 'file';

interface ProjectServiceDefinition {
  path: string;
  type?: string;
  start?: string;
  stop?: string;
  health?: string;
  dependsOn?: string[];
}

interface ProjectAdapterPayload {
  spec2flow?: {
    infrastructure?: {
      stop?: string;
    };
    services?: Record<string, ProjectServiceDefinition>;
  };
}

interface TopologyHealthCheck {
  type: HealthCheckType;
  target: string;
  expect?: string | number;
  timeoutSeconds?: number;
}

interface TopologyServiceNode {
  name: string;
  kind?: string;
  dependsOn?: string[];
  healthChecks?: TopologyHealthCheck[];
}

interface TopologyPayload {
  topology?: {
    services?: TopologyServiceNode[];
    startupOrder?: string[];
  };
}

export interface DeterministicServiceEvidenceArtifact {
  id: string;
  kind: 'log' | 'report' | 'other';
  path: string;
  category: 'service-startup' | 'service-health' | 'service-teardown' | 'other';
  contentType?: string;
}

export interface DeterministicRepositoryGap {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface DeterministicServiceSummary {
  name: string;
  status: 'ready' | 'started' | 'failed' | 'skipped';
  healthTarget?: string;
  logPath?: string;
  notes: string[];
}

export interface ManagedServiceHandle {
  name: string;
  pid: number;
  stopCommand?: string;
  logPath: string;
}

export interface DeterministicServiceOrchestrationResult {
  services: DeterministicServiceSummary[];
  artifacts: DeterministicServiceEvidenceArtifact[];
  repositoryGaps: DeterministicRepositoryGap[];
  managedServices: ManagedServiceHandle[];
}

interface ServiceNodeContext {
  projectService: ProjectServiceDefinition | null;
  topologyService: TopologyServiceNode | null;
}

export interface RunServiceOrchestrationOptions {
  cwd: string;
  artifactsDir: string;
  entryServices: string[];
  projectAdapterRef?: string | null;
  topologyRef?: string | null;
  signal?: AbortSignal;
  artifactStore?: ExecutionArtifactStore;
}

export interface TeardownManagedServicesOptions {
  cwd: string;
  artifactsDir: string;
  managedServices: ManagedServiceHandle[];
  teardownTimeoutSeconds: number;
  artifactStore?: ExecutionArtifactStore;
}

const DEFAULT_HEALTH_TIMEOUT_SECONDS = 10;
const HEALTH_POLL_INTERVAL_MS = 250;

function sanitizeToken(value: string): string {
  return value.replaceAll(/[^a-z0-9-]+/gi, '-').replaceAll(/^-+|-+$/g, '').toLowerCase() || 'service';
}

function buildNodeContextMap(
  projectPayload: ProjectAdapterPayload | null,
  topologyPayload: TopologyPayload | null
): Map<string, ServiceNodeContext> {
  const serviceNames = new Set<string>([
    ...Object.keys(projectPayload?.spec2flow?.services ?? {}),
    ...((topologyPayload?.topology?.services ?? []).map((service) => service.name))
  ]);
  const topologyIndex = new Map((topologyPayload?.topology?.services ?? []).map((service) => [service.name, service] as const));
  const projectIndex = new Map(Object.entries(projectPayload?.spec2flow?.services ?? {}));

  return new Map(
    [...serviceNames].map((name) => [name, {
      projectService: projectIndex.get(name) ?? null,
      topologyService: topologyIndex.get(name) ?? null
    }] as const)
  );
}

function collectDependencies(
  serviceName: string,
  nodeMap: Map<string, ServiceNodeContext>,
  seen: Set<string>
): void {
  if (seen.has(serviceName)) {
    return;
  }

  seen.add(serviceName);
  const node = nodeMap.get(serviceName);
  const dependencies = [
    ...(node?.projectService?.dependsOn ?? []),
    ...(node?.topologyService?.dependsOn ?? [])
  ];

  for (const dependency of dependencies) {
    collectDependencies(dependency, nodeMap, seen);
  }
}

function getStartupOrder(topologyPayload: TopologyPayload | null, selectedServices: Set<string>): string[] {
  const startupOrder = topologyPayload?.topology?.startupOrder ?? [];
  const ordered = startupOrder.filter((serviceName) => selectedServices.has(serviceName));
  const remaining = [...selectedServices].filter((serviceName) => !ordered.includes(serviceName)).sort((left, right) => left.localeCompare(right));
  return [...ordered, ...remaining];
}

function getHealthChecksForService(serviceName: string, node: ServiceNodeContext): TopologyHealthCheck[] {
  const checks = node.topologyService?.healthChecks ?? [];
  if (checks.length > 0) {
    return checks;
  }

  const httpHealthTarget = node.projectService?.health;
  if (httpHealthTarget) {
    return [{
      type: 'http',
      target: httpHealthTarget,
      timeoutSeconds: DEFAULT_HEALTH_TIMEOUT_SECONDS
    }];
  }

  return [];
}

async function wait(durationMs: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);

    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('service orchestration aborted'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function runHttpHealthCheck(check: TopologyHealthCheck): Promise<boolean> {
  const controller = new AbortController();
  const timeoutMs = (check.timeoutSeconds ?? DEFAULT_HEALTH_TIMEOUT_SECONDS) * 1000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(check.target, { signal: controller.signal });
    if (typeof check.expect === 'number') {
      return response.status === check.expect;
    }

    if (typeof check.expect === 'string') {
      const body = await response.text();
      return body.includes(check.expect);
    }

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function runTcpHealthCheck(check: TopologyHealthCheck): Promise<boolean> {
  const [host, portValue] = check.target.split(':');
  const port = Number.parseInt(portValue ?? '', 10);
  if (!host || !Number.isInteger(port) || port < 1) {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    const timeoutMs = (check.timeoutSeconds ?? DEFAULT_HEALTH_TIMEOUT_SECONDS) * 1000;

    const finish = (status: boolean): void => {
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function runCommandHealthCheck(check: TopologyHealthCheck, cwd: string): Promise<boolean> {
  const result = spawnSync(check.target, {
    cwd,
    shell: true,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    return false;
  }

  if (typeof check.expect === 'string') {
    return (result.stdout ?? '').includes(check.expect) || (result.stderr ?? '').includes(check.expect);
  }

  return true;
}

async function runFileHealthCheck(check: TopologyHealthCheck, cwd: string): Promise<boolean> {
  return fs.existsSync(resolveFromBaseDir(cwd, check.target));
}

async function runHealthCheck(check: TopologyHealthCheck, cwd: string): Promise<boolean> {
  switch (check.type) {
    case 'http':
      return runHttpHealthCheck(check);
    case 'tcp':
      return runTcpHealthCheck(check);
    case 'command':
      return runCommandHealthCheck(check, cwd);
    case 'file':
      return runFileHealthCheck(check, cwd);
    default:
      return false;
  }
}

async function waitForHealthChecks(checks: TopologyHealthCheck[], cwd: string, signal?: AbortSignal): Promise<boolean> {
  if (checks.length === 0) {
    return true;
  }

  const timeoutSeconds = Math.max(...checks.map((check) => check.timeoutSeconds ?? DEFAULT_HEALTH_TIMEOUT_SECONDS));
  const deadline = Date.now() + (timeoutSeconds * 1000);

  while (Date.now() <= deadline) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('service orchestration aborted');
    }
    const statuses = await Promise.all(checks.map((check) => runHealthCheck(check, cwd)));
    if (statuses.every(Boolean)) {
      return true;
    }
    await wait(HEALTH_POLL_INTERVAL_MS, signal);
  }

  return false;
}

function escapeShellSingleQuotes(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function startServiceProcess(command: string, cwd: string, logPath: string): Promise<number> {
  const resolvedLogPath = resolveFromBaseDir(cwd, logPath);
  ensureDirForFile(resolvedLogPath);

  const shellCommand = `${command} > ${escapeShellSingleQuotes(resolvedLogPath)} 2>&1 & echo $!`;

  return await new Promise<number>((resolve, reject) => {
    const child = spawn('sh', ['-lc', shellCommand], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        const rawPid = Buffer.concat(stdoutChunks).toString('utf8').trim();
        const pid = Number.parseInt(rawPid, 10);
        if (!Number.isInteger(pid) || pid < 1) {
          reject(new Error(`service start did not return a valid PID: ${rawPid || 'empty output'}`));
          return;
        }
        resolve(pid);
        return;
      }

      reject(new Error(Buffer.concat(stderrChunks).toString('utf8') || `service start exited with code ${code}`));
    });
  });
}

function buildServiceHealthArtifact(serviceName: string, artifactPath: string, checks: TopologyHealthCheck[], status: boolean): Record<string, unknown> {
  return {
    serviceHealthReport: {
      service: serviceName,
      status: status ? 'ready' : 'failed',
      checks: checks.map((check) => ({
        type: check.type,
        target: check.target,
        ...(check.expect === undefined ? {} : { expect: check.expect }),
        timeoutSeconds: check.timeoutSeconds ?? DEFAULT_HEALTH_TIMEOUT_SECONDS
      }))
    }
  };
}

export function describeDetectedServices(
  cwd: string,
  projectAdapterRef?: string | null,
  topologyRef?: string | null
): Array<{ name: string; path: string; kind?: string; startCommand?: string }> {
  const projectPayload = loadOptionalStructuredFileFrom<ProjectAdapterPayload>(cwd, projectAdapterRef ?? undefined);
  const topologyPayload = loadOptionalStructuredFileFrom<TopologyPayload>(cwd, topologyRef ?? undefined);
  const topologyIndex = new Map((topologyPayload?.topology?.services ?? []).map((service) => [service.name, service] as const));

  return Object.entries(projectPayload?.spec2flow?.services ?? {}).map(([name, service]) => {
    const kind = topologyIndex.get(name)?.kind;

    return {
      name,
      path: service.path,
      ...(typeof kind === 'string' ? { kind } : {}),
      ...(service.start ? { startCommand: service.start } : {})
    };
  });
}

export async function runServiceOrchestration(options: RunServiceOrchestrationOptions): Promise<DeterministicServiceOrchestrationResult> {
  const projectPayload = loadOptionalStructuredFileFrom<ProjectAdapterPayload>(options.cwd, options.projectAdapterRef ?? undefined);
  const topologyPayload = loadOptionalStructuredFileFrom<TopologyPayload>(options.cwd, options.topologyRef ?? undefined);
  const nodeMap = buildNodeContextMap(projectPayload, topologyPayload);
  const selectedServices = new Set<string>();

  for (const entryService of options.entryServices) {
    collectDependencies(entryService, nodeMap, selectedServices);
  }

  const orderedServices = getStartupOrder(topologyPayload, selectedServices);
  const summaries: DeterministicServiceSummary[] = [];
  const artifacts: DeterministicServiceEvidenceArtifact[] = [];
  const repositoryGaps: DeterministicRepositoryGap[] = [];
  const managedServices: ManagedServiceHandle[] = [];

  for (const serviceName of orderedServices) {
    const node = nodeMap.get(serviceName);
    const checks = node ? getHealthChecksForService(serviceName, node) : [];
    const startCommand = node?.projectService?.start;
    const logPath = path.join(options.artifactsDir, 'services', `${sanitizeToken(serviceName)}-startup.log`);
    const healthArtifactPath = path.join(options.artifactsDir, 'services', `${sanitizeToken(serviceName)}-health.json`);
    const notes: string[] = [];

    const initiallyHealthy = await waitForHealthChecks(checks, options.cwd, options.signal);
    if (initiallyHealthy) {
      const healthPayload = buildServiceHealthArtifact(serviceName, healthArtifactPath, checks, true);
      if (options.artifactStore) {
        options.artifactStore.writeJsonArtifact({
          id: `service-health-${sanitizeToken(serviceName)}`,
          path: healthArtifactPath,
          kind: 'report',
          category: 'service-health',
          contentType: 'application/json',
          payload: healthPayload
        });
      } else {
        writeJsonFrom(options.cwd, healthArtifactPath, healthPayload);
      }
      summaries.push({
        name: serviceName,
        status: 'ready',
        ...(checks[0]?.target ? { healthTarget: checks[0].target } : {}),
        notes: ['service already healthy before execution']
      });
      const artifact = {
        id: `service-health-${sanitizeToken(serviceName)}`,
        kind: 'report',
        path: healthArtifactPath,
        category: 'service-health',
        contentType: 'application/json'
      } as const;
      artifacts.push(artifact);
      options.artifactStore?.registerArtifact(artifact);
      continue;
    }

    if (!startCommand) {
      const healthPayload = buildServiceHealthArtifact(serviceName, healthArtifactPath, checks, false);
      if (options.artifactStore) {
        options.artifactStore.writeJsonArtifact({
          id: `service-health-${sanitizeToken(serviceName)}`,
          path: healthArtifactPath,
          kind: 'report',
          category: 'service-health',
          contentType: 'application/json',
          payload: healthPayload
        });
      } else {
        writeJsonFrom(options.cwd, healthArtifactPath, healthPayload);
      }
      summaries.push({
        name: serviceName,
        status: 'failed',
        ...(checks[0]?.target ? { healthTarget: checks[0].target } : {}),
        notes: ['service is not healthy and no start command was declared']
      });
      const artifact = {
        id: `service-health-${sanitizeToken(serviceName)}`,
        kind: 'report',
        path: healthArtifactPath,
        category: 'service-health',
        contentType: 'application/json'
      } as const;
      artifacts.push(artifact);
      options.artifactStore?.registerArtifact(artifact);
      repositoryGaps.push({
        code: 'service-start-command-missing',
        message: `Service ${serviceName} is required for execution but does not declare a start command.`,
        recoverable: true
      });
      continue;
    }

    try {
      const pid = await startServiceProcess(startCommand, options.cwd, logPath);
      const startupArtifact = {
        id: `service-startup-${sanitizeToken(serviceName)}`,
        kind: 'log',
        path: logPath,
        category: 'service-startup',
        contentType: 'text/plain'
      } as const;
      artifacts.push(startupArtifact);
      options.artifactStore?.registerArtifact(startupArtifact);
      const healthyAfterStart = await waitForHealthChecks(checks, options.cwd, options.signal);
      const healthPayload = buildServiceHealthArtifact(serviceName, healthArtifactPath, checks, healthyAfterStart);
      if (options.artifactStore) {
        options.artifactStore.writeJsonArtifact({
          id: `service-health-${sanitizeToken(serviceName)}`,
          path: healthArtifactPath,
          kind: 'report',
          category: 'service-health',
          contentType: 'application/json',
          payload: healthPayload
        });
      } else {
        writeJsonFrom(options.cwd, healthArtifactPath, healthPayload);
      }
      const healthArtifact = {
        id: `service-health-${sanitizeToken(serviceName)}`,
        kind: 'report',
        path: healthArtifactPath,
        category: 'service-health',
        contentType: 'application/json'
      } as const;
      artifacts.push(healthArtifact);
      options.artifactStore?.registerArtifact(healthArtifact);

      summaries.push({
        name: serviceName,
        status: healthyAfterStart ? 'started' : 'failed',
        ...(checks[0]?.target ? { healthTarget: checks[0].target } : {}),
        logPath,
        notes: healthyAfterStart ? ['service started and passed health checks'] : ['service start command ran but health checks still failed']
      });
      managedServices.push({
        name: serviceName,
        pid,
        ...(node?.projectService?.stop ? { stopCommand: node.projectService.stop } : {}),
        logPath
      });

      if (!healthyAfterStart) {
        repositoryGaps.push({
          code: 'service-health-check-failed',
          message: `Service ${serviceName} did not pass health checks after startup.`,
          recoverable: true
        });
      }
    } catch (error) {
      notes.push(error instanceof Error ? error.message : String(error));
      const healthPayload = buildServiceHealthArtifact(serviceName, healthArtifactPath, checks, false);
      if (options.artifactStore) {
        options.artifactStore.writeJsonArtifact({
          id: `service-health-${sanitizeToken(serviceName)}`,
          path: healthArtifactPath,
          kind: 'report',
          category: 'service-health',
          contentType: 'application/json',
          payload: healthPayload
        });
      } else {
        writeJsonFrom(options.cwd, healthArtifactPath, healthPayload);
      }
      const artifact = {
        id: `service-health-${sanitizeToken(serviceName)}`,
        kind: 'report',
        path: healthArtifactPath,
        category: 'service-health',
        contentType: 'application/json'
      } as const;
      artifacts.push(artifact);
      options.artifactStore?.registerArtifact(artifact);
      summaries.push({
        name: serviceName,
        status: 'failed',
        ...(checks[0]?.target ? { healthTarget: checks[0].target } : {}),
        logPath,
        notes
      });
      repositoryGaps.push({
        code: 'service-start-command-failed',
        message: `Service ${serviceName} failed to start: ${notes.join('; ') || 'unknown error'}`,
        recoverable: true
      });
    }
  }

  return {
    services: summaries,
    artifacts,
    repositoryGaps,
    managedServices
  };
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutSeconds: number): Promise<boolean> {
  const deadline = Date.now() + (timeoutSeconds * 1000);
  while (Date.now() <= deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await wait(100);
  }
  return !isProcessRunning(pid);
}

export async function teardownManagedServices(options: TeardownManagedServicesOptions): Promise<DeterministicServiceOrchestrationResult> {
  const summaries: DeterministicServiceSummary[] = [];
  const artifacts: DeterministicServiceEvidenceArtifact[] = [];
  const repositoryGaps: DeterministicRepositoryGap[] = [];

  for (const service of [...options.managedServices].reverse()) {
    const teardownLogPath = path.join(options.artifactsDir, 'services', `${sanitizeToken(service.name)}-teardown.log`);
    const teardownReportPath = path.join(options.artifactsDir, 'services', `${sanitizeToken(service.name)}-teardown.json`);
    const notes: string[] = [];
    let stopped = false;

    if (service.stopCommand) {
      const result = spawnSync(service.stopCommand, {
        cwd: options.cwd,
        shell: true,
        encoding: 'utf8',
        timeout: options.teardownTimeoutSeconds * 1000
      });
      const combinedOutput = [result.stdout ?? '', result.stderr ?? ''].filter(Boolean).join('\n').trim();
      if (options.artifactStore) {
        options.artifactStore.writeTextArtifact({
          id: `service-teardown-log-${sanitizeToken(service.name)}`,
          path: teardownLogPath,
          kind: 'log',
          category: 'service-teardown',
          contentType: 'text/plain',
          content: `${combinedOutput}\n`
        });
      } else {
        ensureDirForFile(resolveFromBaseDir(options.cwd, teardownLogPath));
        fs.writeFileSync(resolveFromBaseDir(options.cwd, teardownLogPath), `${combinedOutput}\n`, 'utf8');
      }
      stopped = result.status === 0 || !isProcessRunning(service.pid);
      if (!stopped) {
        notes.push(`stop command exited with status ${result.status ?? 'unknown'}`);
      }
    } else if (isProcessRunning(service.pid)) {
      try {
        process.kill(service.pid, 'SIGTERM');
        stopped = await waitForProcessExit(service.pid, options.teardownTimeoutSeconds);
        if (!stopped && isProcessRunning(service.pid)) {
          process.kill(service.pid, 'SIGKILL');
          stopped = await waitForProcessExit(service.pid, 1);
        }
      } catch (error) {
        notes.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      stopped = true;
      notes.push('process had already exited before teardown');
    }

    const reportPayload = {
      serviceTeardownReport: {
        service: service.name,
        pid: service.pid,
        status: stopped ? 'stopped' : 'failed',
        ...(service.stopCommand ? { stopCommand: service.stopCommand } : {}),
        notes
      }
    };

    if (options.artifactStore) {
      options.artifactStore.writeJsonArtifact({
        id: `service-teardown-${sanitizeToken(service.name)}`,
        path: teardownReportPath,
        kind: 'report',
        category: 'service-teardown',
        contentType: 'application/json',
        payload: reportPayload
      });
    } else {
      writeJsonFrom(options.cwd, teardownReportPath, reportPayload);
    }

    const artifact = {
      id: `service-teardown-${sanitizeToken(service.name)}`,
      kind: 'report',
      path: teardownReportPath,
      category: 'service-teardown',
      contentType: 'application/json'
    } as const;
    artifacts.push(artifact);
    options.artifactStore?.registerArtifact(artifact);

    summaries.push({
      name: service.name,
      status: stopped ? 'skipped' : 'failed',
      logPath: teardownLogPath,
      notes: stopped ? ['service stopped after deterministic execution'] : notes
    });

    if (!stopped) {
      repositoryGaps.push({
        code: 'service-teardown-failed',
        message: `Service ${service.name} did not stop cleanly after deterministic execution.`,
        recoverable: true
      });
    }
  }

  return {
    services: summaries,
    artifacts,
    repositoryGaps,
    managedServices: []
  };
}
