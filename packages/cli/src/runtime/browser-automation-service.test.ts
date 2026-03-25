import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runBrowserAutomation } from './browser-automation-service.js';

const tempDirs: string[] = [];
const servers: Server[] = [];

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-browser-automation-'));
  tempDirs.push(tempDir);
  return tempDir;
}

async function startFixtureServer(): Promise<string> {
  const server = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<html><head><title>Spec2Flow Smoke</title></head><body>frontend ready</body></html>');
  });
  servers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('expected TCP server address');
  }

  return `http://127.0.0.1:${address.port}/`;
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }

  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('browser-automation-service', () => {
  it('captures html evidence and passes required browser checks without Playwright', async () => {
    const tempDir = createTempDir();
    const baseUrl = await startFixtureServer();

    const result = await runBrowserAutomation({
      cwd: tempDir,
      artifactsDir: 'spec2flow/outputs/execution/frontend-smoke',
      browserChecks: [
        {
          id: 'smoke-home',
          url: baseUrl,
          expectText: 'frontend ready',
          expectTitle: 'Spec2Flow Smoke',
          required: true
        }
      ]
    });

    expect(result.requiredFailureCount).toBe(0);
    expect(result.repositoryGaps).toEqual([]);
    expect(result.summaries).toEqual([
      expect.objectContaining({
        id: 'smoke-home',
        url: baseUrl,
        status: 'passed'
      })
    ]);

    const htmlPath = result.summaries[0]?.htmlSnapshotPath;
    expect(htmlPath).toBeTruthy();
    expect(fs.existsSync(path.join(tempDir, htmlPath ?? 'missing'))).toBe(true);
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'browser-check' })
    ]));
  });

  it('degrades gracefully when capture is requested but Playwright is unavailable or unsupported', async () => {
    const tempDir = createTempDir();
    const baseUrl = await startFixtureServer();

    const result = await runBrowserAutomation({
      cwd: tempDir,
      artifactsDir: 'spec2flow/outputs/execution/frontend-smoke',
      browserChecks: [
        {
          id: 'smoke-home-capture',
          url: baseUrl,
          expectText: 'frontend ready',
          captureScreenshot: true,
          required: true,
          requireEvidenceCapture: false
        }
      ]
    });

    expect(result.summaries[0]).toEqual(expect.objectContaining({
      id: 'smoke-home-capture',
      status: 'passed'
    }));
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'playwright-capability-report' }),
      expect.objectContaining({ id: 'browser-check-smoke-home-capture' })
    ]));
  });
});
