import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDirForFile, loadOptionalStructuredFileFrom, resolveFromBaseDir, writeJsonFrom } from '../shared/fs-utils.js';
import type { DeterministicRepositoryGap } from './service-orchestration-service.js';

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

function detectPlaywright(cwd: string): boolean {
  const result = spawnSync('node', ['-e', 'require.resolve("playwright")'], {
    cwd,
    stdio: 'ignore'
  });
  return result.status === 0;
}

function maybeCaptureWithPlaywright(
  cwd: string,
  url: string,
  check: BrowserCheckConfig,
  screenshotPath: string | null,
  tracePath: string | null,
  videoDir: string | null
): { screenshotPath?: string; tracePath?: string; videoPath?: string; error?: string } {
  if (!detectPlaywright(cwd)) {
    return { error: 'playwright-not-installed' };
  }

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
  title: string | null
): Record<string, unknown> {
  return {
    browserCheckReport: {
      id: check.id,
      url,
      status,
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

      const captureResult = maybeCaptureWithPlaywright(options.cwd, url, check, screenshotPath, tracePath, videoDir);
      if (captureResult.error && (check.captureScreenshot || check.captureTrace || check.captureVideo)) {
        repositoryGaps.push({
          code: 'browser-automation-unavailable',
          message: `Browser check ${check.id} could not capture Playwright evidence: ${captureResult.error}`,
          recoverable: true
        });
        if (check.required) {
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
      repositoryGaps.push({
        code: 'browser-check-request-failed',
        message: `Browser check ${check.id} failed to load ${url}: ${error instanceof Error ? error.message : String(error)}`,
        recoverable: true
      });
    }

    writeJsonFrom(options.cwd, reportPath, buildBrowserCheckReport(check, url, status, htmlSnapshotPath, pageTitle));
    summaries.push({
      ...buildBrowserAutomationSummary(
        check,
        url,
        status,
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
