import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createExecutionArtifactStore } from './execution-artifact-store-service.js';

const tempDirs: string[] = [];
const servers: Server[] = [];

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-artifact-store-'));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      server.close();
    }
  }

  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('execution-artifact-store-service', () => {
  it('writes, uploads, and registers artifacts through one store abstraction', async () => {
    const tempDir = createTempDir();
    const uploads: Array<{ url: string; body: string }> = [];
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        uploads.push({
          url: request.url ?? '',
          body
        });
        response.statusCode = 201;
        response.end('ok');
      });
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected upload fixture address');
    }

    const store = createExecutionArtifactStore(tempDir, {
      mode: 'remote-catalog',
      provider: 'generic-http',
      publicBaseUrl: 'https://artifacts.example.com/spec2flow/',
      keyPrefix: 'frontend-smoke/',
      upload: {
        endpointTemplate: `http://127.0.0.1:${address.port}/upload/{objectKey}`,
        method: 'PUT'
      }
    });

    store.writeJsonArtifact({
      id: 'report',
      path: 'spec2flow/outputs/execution/report.json',
      kind: 'report',
      category: 'other',
      contentType: 'application/json',
      payload: { ok: true }
    });
    store.writeTextArtifact({
      id: 'log',
      path: 'spec2flow/outputs/execution/report.log',
      kind: 'log',
      category: 'verification-command',
      contentType: 'text/plain',
      content: 'ok\n'
    });

    await store.flushUploads();

    expect(fs.existsSync(path.join(tempDir, 'spec2flow/outputs/execution/report.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'spec2flow/outputs/execution/report.log'))).toBe(true);
    expect(uploads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: '/upload/frontend-smoke/spec2flow/outputs/execution/report.json'
      }),
      expect.objectContaining({
        url: '/upload/frontend-smoke/spec2flow/outputs/execution/report.log',
        body: 'ok\n'
      })
    ]));
    expect(store.listArtifacts()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'report',
        category: 'other',
        storage: expect.objectContaining({
          mode: 'remote-catalog',
          objectKey: 'frontend-smoke/spec2flow/outputs/execution/report.json'
        }),
        upload: expect.objectContaining({
          status: 'uploaded',
          httpStatus: 201
        })
      }),
      expect.objectContaining({
        id: 'log',
        category: 'verification-command',
        upload: expect.objectContaining({
          status: 'uploaded',
          httpStatus: 201
        })
      })
    ]));
  });
});
