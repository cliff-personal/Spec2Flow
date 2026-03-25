import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDirForFile, loadOptionalStructuredFileFrom, resolveFromBaseDir, writeJsonFrom } from '../shared/fs-utils.js';
import type { DeterministicRepositoryGap } from './service-orchestration-service.js';
import { probePlaywrightCapability, type PlaywrightCapabilitySummary } from './playwright-capability-service.js';
import type { ExecutionArtifactStore } from './execution-artifact-store-service.js';

interface ProjectServiceDefinition {
  health?: string;
}

interface ProjectAdapterPayload {
  spec2flow?: {
    services?: Record<string, ProjectServiceDefinition>;
  };
}

interface TopologyHealthCheck {
  type: 'http' | 'tcp' | 'command' | 'file';
  target: string;
}

interface TopologyServiceNode {
  name: string;
  healthChecks?: TopologyHealthCheck[];
}

interface TopologyPayload {
  topology?: {
    services?: TopologyServiceNode[];
  };
}

export interface BrowserCheckConfig {
  id: string;
  service?: string;
  url?: string;
  path?: string;
  expectText?: string;
  expectTitle?: string;
  captureScreenshot?: boolean;
  captureTrace?: boolean;
  captureVideo?: boolean;
  required?: boolean;
  requireEvidenceCapture?: boolean;
}

export interface BrowserAutomationArtifact {
  id: string;
  kind: 'report' | 'screenshot' | 'trace' | 'video' | 'other';
  path: string;
  category: 'browser-check' | 'browser-screenshot' | 'browser-trace' | 'browser-video';
  contentType?: string;
}

export interface BrowserAutomationSummary {
  id: string;
  url: string;
  status: 'passed' | 'failed' | 'skipped';
  captureStatus?: 'captured' | 'degraded' | 'not-requested';
  htmlSnapshotPath?: string;
  screenshotPath?: string;
  tracePath?: string;
  videoPath?: string;
}

export interface BrowserAutomationResult {
  summaries: BrowserAutomationSummary[];
  artifacts: BrowserAutomationArtifact[];
  repositoryGaps: DeterministicRepositoryGap[];
  requiredFailureCount: number;
}

export interface RunBrowserAutomationOptions {
  cwd: string;
  artifactsDir: string;
  browserChecks: BrowserCheckConfig[];
  projectAdapterRef?: string | null;
  topologyRef?: string | null;
  artifactStore?: ExecutionArtifactStore;
}

interface PlaywrightCaptureResult {
  screenshotPath?: string;
  tracePath?: string;
  videoPath?: string;
  error?: string;
}

function sanitizeToken(value: string): string {
  return value.replaceAll(/[^a-z0-9-]+/gi, '-').replaceAll(/^-+|-+$/g, '').toLowerCase() || 'browser-check';
}

function resolveBrowserUrl(
  check: BrowserCheckConfig,
  projectPayload: ProjectAdapterPayload | null,
  topologyPayload: TopologyPayload | null
): string | null {
  if (check.url) {
    return check.url;
  }

  if (!check.service) {
    return null;
  }

  const directHealth = projectPayload?.spec2flow?.services?.[check.service]?.health;
  if (directHealth) {
    return directHealth;
  }

  const topologyService = (topologyPayload?.topology?.services ?? []).find((service) => service.name === check.service);
  const httpHealth = topologyService?.healthChecks?.find((healthCheck) => healthCheck.type === 'http')?.target;
  return httpHealth ?? null;
}

function joinUrl(baseUrl: string, pathValue: string | undefined): string {
  if (!pathValue) {
    return baseUrl;
  }

  return new URL(pathValue, baseUrl).toString();
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/iu.exec(html);
  return match?.[1]?.trim() ?? null;
}

function maybeCaptureWithPlaywright(
  cwd: string,
  url: string,
  check: BrowserCheckConfig,
  screenshotPath: string | null,
  tracePath: string | null,
  videoDir: string | null
): PlaywrightCaptureResult {
  const runnerDir = path.join(cwd, '.spec2flow', 'tmp');
  const runnerPath = path.join(runnerDir, `playwright-capture-${sanitizeToken(check.id)}.mjs`);
  fs.mkdirSync(runnerDir, { recursive: true });

  const script = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { chromium } from 'playwright';
    const url = ${JSON.stringify(url)};
    const screenshotPath = ${JSON.stringify(screenshotPath)};
    const tracePath = ${JSON.stringify(tracePath)};
    const videoDir = ${JSON.stringify(videoDir)};
    const captureTrace = ${JSON.stringify(Boolean(check.captureTrace))};
    const captureVideo = ${JSON.stringify(Boolean(check.captureVideo))};
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(captureVideo && videoDir ? { recordVideo: { dir: videoDir } } : {});
    if (captureTrace && tracePath) {
      await context.tracing.start({ screenshots: true, snapshots: true });
    }
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    if (screenshotPath) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    if (captureTrace && tracePath) {
      await context.tracing.stop({ path: tracePath });
    }
    await context.close();
    await browser.close();
    if (captureVideo && videoDir) {
      const entries = fs.readdirSync(videoDir);
      const firstFile = entries.find((entry) => fs.statSync(path.join(videoDir, entry)).isFile());
      if (firstFile) {
        process.stdout.write(path.join(videoDir, firstFile));
      }
    }
  `;
  fs.writeFileSync(runnerPath, script, 'utf8');

  const result = spawnSync('node', [runnerPath], {
    cwd,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    return {
      error: (result.stderr ?? '').trim() || `playwright capture exited with code ${result.status}`
    };
  }

  const videoPath = (result.stdout ?? '').trim() || undefined;
  return {
    ...(screenshotPath ? { screenshotPath } : {}),
    ...(tracePath ? { tracePath } : {}),
    ...(videoPath ? { videoPath } : {})
  };
}

function buildBrowserCheckReport(
  check: BrowserCheckConfig,
  url: string,
  status: BrowserAutomationSummary['status'],
  htmlSnapshotPath: string | null,
  title: string | null,
  captureStatus: BrowserAutomationSummary['captureStatus']
): Record<string, unknown> {
  return {
    browserCheckReport: {
      id: check.id,
      url,
      status,
      ...(captureStatus ? { captureStatus } : {}),
      ...(check.expectText ? { expectText: check.expectText } : {}),
      ...(check.expectTitle ? { expectTitle: check.expectTitle } : {}),
      ...(htmlSnapshotPath ? { htmlSnapshotPath } : {}),
      ...(title ? { title } : {})
    }
  };
}

function buildBrowserAutomationSummary(
  check: BrowserCheckConfig,
  url: string,
  status: BrowserAutomationSummary['status'],
  captureStatus: BrowserAutomationSummary['captureStatus'],
  htmlSnapshotPath: string,
  cwd: string,
  paths: {
    screenshotPath: string | null;
    tracePath: string | null;
    videoPath: string | null;
  }
): BrowserAutomationSummary {
  return {
    id: check.id,
    url,
    status,
    ...(captureStatus ? { captureStatus } : {}),
    htmlSnapshotPath,
    ...(paths.screenshotPath && fs.existsSync(resolveFromBaseDir(cwd, paths.screenshotPath)) ? { screenshotPath: paths.screenshotPath } : {}),
    ...(paths.tracePath && fs.existsSync(resolveFromBaseDir(cwd, paths.tracePath)) ? { tracePath: paths.tracePath } : {}),
    ...(paths.videoPath && fs.existsSync(resolveFromBaseDir(cwd, paths.videoPath)) ? { videoPath: paths.videoPath } : {})
  };
}

export async function runBrowserAutomation(options: RunBrowserAutomationOptions): Promise<BrowserAutomationResult> {
  if (options.browserChecks.length === 0) {
    return {
      summaries: [],
      artifacts: [],
      repositoryGaps: [],
      requiredFailureCount: 0
    };
  }

  const projectPayload = loadOptionalStructuredFileFrom<ProjectAdapterPayload>(options.cwd, options.projectAdapterRef ?? undefined);
  const topologyPayload = loadOptionalStructuredFileFrom<TopologyPayload>(options.cwd, options.topologyRef ?? undefined);
  const summaries: BrowserAutomationSummary[] = [];
  const artifacts: BrowserAutomationArtifact[] = [];
  const repositoryGaps: DeterministicRepositoryGap[] = [];
  let requiredFailureCount = 0;
  const captureRequested = options.browserChecks.some((check) => check.captureScreenshot || check.captureTrace || check.captureVideo);
  const playwrightCapability = probePlaywrightCapability(options.cwd, captureRequested);
  const capabilityReportPath = path.join(options.artifactsDir, 'browser', 'playwright-capability.json');

  if (captureRequested) {
    if (options.artifactStore) {
      options.artifactStore.writeJsonArtifact({
        id: 'playwright-capability-report',
        path: capabilityReportPath,
        kind: 'report',
        category: 'browser-check',
        contentType: 'application/json',
        payload: { playwrightCapability }
      });
    } else {
      writeJsonFrom(options.cwd, capabilityReportPath, { playwrightCapability });
    }
    artifacts.push({
      id: 'playwright-capability-report',
      kind: 'report',
      path: capabilityReportPath,
      category: 'browser-check',
      contentType: 'application/json'
    });
  }

  for (const check of options.browserChecks) {
    const baseUrl = resolveBrowserUrl(check, projectPayload, topologyPayload);
    if (!baseUrl) {
      summaries.push({
        id: check.id,
        url: '',
        status: 'skipped'
      });
      repositoryGaps.push({
        code: 'browser-check-target-missing',
        message: `Browser check ${check.id} could not resolve a target URL.`,
        recoverable: true
      });
      if (check.required) {
        requiredFailureCount += 1;
      }
      continue;
    }

    const url = joinUrl(baseUrl, check.path);
    const browserDir = path.join(options.artifactsDir, 'browser');
    const htmlSnapshotPath = path.join(browserDir, `${sanitizeToken(check.id)}.html`);
    const reportPath = path.join(browserDir, `${sanitizeToken(check.id)}.json`);
    const screenshotPath = check.captureScreenshot ? path.join(browserDir, `${sanitizeToken(check.id)}.png`) : null;
    const tracePath = check.captureTrace ? path.join(browserDir, `${sanitizeToken(check.id)}-trace.zip`) : null;
    const videoDir = check.captureVideo ? path.join(browserDir, `${sanitizeToken(check.id)}-video`) : null;
    let status: BrowserAutomationSummary['status'] = 'passed';
    let captureStatus: BrowserAutomationSummary['captureStatus'] = check.captureScreenshot || check.captureTrace || check.captureVideo
      ? 'captured'
      : 'not-requested';
    let pageTitle: string | null = null;

    try {
      const response = await fetch(url);
      const html = await response.text();
      ensureDirForFile(resolveFromBaseDir(options.cwd, htmlSnapshotPath));
      fs.writeFileSync(resolveFromBaseDir(options.cwd, htmlSnapshotPath), html, 'utf8');
      pageTitle = extractTitle(html);

      if (!response.ok) {
        status = 'failed';
      }
      if (check.expectText && !html.includes(check.expectText)) {
        status = 'failed';
      }
      if (check.expectTitle && pageTitle !== check.expectTitle) {
        status = 'failed';
      }

      artifacts.push({
        id: `browser-check-${sanitizeToken(check.id)}`,
        kind: 'report',
        path: reportPath,
        category: 'browser-check',
        contentType: 'application/json'
      });
      artifacts.push({
        id: `browser-html-${sanitizeToken(check.id)}`,
        kind: 'other',
        path: htmlSnapshotPath,
        category: 'browser-check',
        contentType: 'text/html'
      });

      const captureRequestedForCheck = Boolean(check.captureScreenshot || check.captureTrace || check.captureVideo);
      const captureResult: PlaywrightCaptureResult = captureRequestedForCheck && playwrightCapability.available
        ? maybeCaptureWithPlaywright(options.cwd, url, check, screenshotPath, tracePath, videoDir)
        : (captureRequestedForCheck
          ? { error: playwrightCapability.reason ?? 'playwright-unavailable' }
          : {});
      if (captureResult.error && captureRequestedForCheck) {
        captureStatus = 'degraded';
        repositoryGaps.push({
          code: 'browser-automation-unavailable',
          message: `Browser check ${check.id} could not capture Playwright evidence: ${captureResult.error}`,
          recoverable: true
        });
        if (check.requireEvidenceCapture) {
          status = 'failed';
        }
      }

      if (captureResult.screenshotPath) {
        artifacts.push({
          id: `browser-screenshot-${sanitizeToken(check.id)}`,
          kind: 'screenshot',
          path: captureResult.screenshotPath,
          category: 'browser-screenshot',
          contentType: 'image/png'
        });
      }

      if (captureResult.tracePath) {
        artifacts.push({
          id: `browser-trace-${sanitizeToken(check.id)}`,
          kind: 'trace',
          path: captureResult.tracePath,
          category: 'browser-trace',
          contentType: 'application/zip'
        });
      }

      if (captureResult.videoPath) {
        artifacts.push({
          id: `browser-video-${sanitizeToken(check.id)}`,
          kind: 'video',
          path: captureResult.videoPath,
          category: 'browser-video',
          contentType: 'video/webm'
        });
      }
    } catch (error) {
      status = 'failed';
      captureStatus = captureStatus ?? 'not-requested';
      repositoryGaps.push({
        code: 'browser-check-request-failed',
        message: `Browser check ${check.id} failed to load ${url}: ${error instanceof Error ? error.message : String(error)}`,
        recoverable: true
      });
    }

    const reportPayload = buildBrowserCheckReport(check, url, status, htmlSnapshotPath, pageTitle, captureStatus);
    if (options.artifactStore) {
      options.artifactStore.writeJsonArtifact({
        id: `browser-check-${sanitizeToken(check.id)}`,
        path: reportPath,
        kind: 'report',
        category: 'browser-check',
        contentType: 'application/json',
        payload: reportPayload
      });
    } else {
      writeJsonFrom(options.cwd, reportPath, reportPayload);
    }
    summaries.push({
      ...buildBrowserAutomationSummary(
        check,
        url,
        status,
        captureStatus,
        htmlSnapshotPath,
        options.cwd,
        {
          screenshotPath,
          tracePath,
          videoPath: artifacts.find((artifact) => artifact.category === 'browser-video' && artifact.id === `browser-video-${sanitizeToken(check.id)}`)?.path ?? null
        }
      )
    });

    if (status === 'failed' && check.required) {
      requiredFailureCount += 1;
    }
  }

  return {
    summaries,
    artifacts,
    repositoryGaps,
    requiredFailureCount
  };
}
