import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeDetectedServices, runServiceOrchestration } from './service-orchestration-service.js';

const tempDirs: string[] = [];
const servers: Server[] = [];

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-service-orchestration-'));
  tempDirs.push(tempDir);
  return tempDir;
}

async function startHealthServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.end('ok');
  });
  servers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('expected TCP server address');
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/healthz`
  };
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

describe('service-orchestration-service', () => {
  it('detects services and records health artifacts when an entry service is already healthy', async () => {
    const tempDir = createTempDir();
    const { url } = await startHealthServer();
    const projectPath = path.join(tempDir, 'project.json');
    const topologyPath = path.join(tempDir, 'topology.json');

    fs.writeFileSync(projectPath, JSON.stringify({
      spec2flow: {
        services: {
          frontend: {
            path: 'apps/frontend',
            health: url
          }
        }
      }
    }, null, 2));
    fs.writeFileSync(topologyPath, JSON.stringify({
      topology: {
        services: [
          {
            name: 'frontend',
            kind: 'web',
            healthChecks: [
              {
                type: 'http',
                target: url,
                timeoutSeconds: 1
              }
            ]
          }
        ],
        startupOrder: ['frontend']
      }
    }, null, 2));

    expect(describeDetectedServices(tempDir, 'project.json', 'topology.json')).toEqual([
      {
        name: 'frontend',
        path: 'apps/frontend',
        kind: 'web'
      }
    ]);

    const result = await runServiceOrchestration({
      cwd: tempDir,
      artifactsDir: 'spec2flow/outputs/execution/frontend-smoke',
      entryServices: ['frontend'],
      projectAdapterRef: 'project.json',
      topologyRef: 'topology.json'
    });

    expect(result.repositoryGaps).toEqual([]);
    expect(result.services).toEqual([
      expect.objectContaining({
        name: 'frontend',
        status: 'ready',
        healthTarget: url
      })
    ]);

    const healthArtifact = result.artifacts.find((artifact) => artifact.category === 'service-health');
    expect(healthArtifact).toBeTruthy();
    expect(fs.existsSync(path.join(tempDir, healthArtifact?.path ?? 'missing'))).toBe(true);
  });
});
