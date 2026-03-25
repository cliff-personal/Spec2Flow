import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { runDeterministicTask, runDeterministicTaskAsync } from './deterministic-execution-service.js';
import type { TaskClaimPayload } from '../types/index.js';

const tempDirs: string[] = [];
const servers: Server[] = [];

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec2flow-deterministic-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function createClaim(tempDir: string, stage: 'environment-preparation' | 'automated-execution', command: string): TaskClaimPayload {
  return {
    taskClaim: {
      runId: 'run-1',
      workflowName: 'workflow',
      taskId: `frontend-smoke--${stage}`,
      title: 'Run deterministic task',
      stage,
      goal: 'Run deterministic task',
      executorType: stage === 'environment-preparation' ? 'controller-agent' : 'execution-agent',
      roleProfile: {
        profileId: stage === 'environment-preparation' ? 'environment-preparation-controller' : 'automated-execution-specialist',
        specialistRole: stage === 'environment-preparation' ? 'controller-agent' : 'execution-agent',
        commandPolicy: stage === 'environment-preparation' ? 'bootstrap-only' : 'verification-only',
        canReadRepository: true,
        canEditFiles: false,
        canRunCommands: true,
        canWriteArtifacts: true,
        canOpenCollaboration: false,
        requiredAdapterSupports: ['toolCalling'],
        expectedArtifacts: stage === 'environment-preparation' ? ['environment-preparation-report'] : ['execution-report', 'verification-evidence']
      },
      repositoryContext: {
        docs: ['AGENTS.md', '.github/copilot-instructions.md'],
        changedFiles: [],
        targetFiles: [],
        verifyCommands: [command],
        taskInputs: {},
        projectAdapterRef: null,
        requirementRef: null,
        requirementText: null,
        riskPolicyRef: null,
        routeSelectionMode: null,
        selectedRoutes: ['frontend-smoke'],
        topologyRef: null
      },
      runtimeContext: {
        executionStateRef: path.join(tempDir, 'execution-state.json'),
        taskGraphRef: path.join(tempDir, 'task-graph.json'),
        currentRunStatus: 'running',
        attempt: 1,
        artifactRefs: [],
        taskArtifacts: [],
        taskErrors: [],
        artifactsDir: path.join(tempDir, 'artifacts'),
        dependsOn: []
      },
      instructions: []
    }
  };
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

async function startFixtureServer(): Promise<string> {
  const server = createServer((_request, response) => {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<html><head><title>Spec2Flow Fixture</title></head><body>fixture ready</body></html>');
  });
  servers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('expected fixture server address');
  }

  return `http://127.0.0.1:${address.port}`;
}

describe('deterministic-execution-service', () => {
  it('runs environment preparation commands and writes a schema-backed report', () => {
    const tempDir = createTempDir();
    const claim = createClaim(tempDir, 'environment-preparation', 'node -e "process.stdout.write(\'ready\')"');

    const result = runDeterministicTask(claim, tempDir);

    expect(result.adapterRun.status).toBe('completed');
    expect(result.adapterRun.artifacts).toEqual([
      expect.objectContaining({ id: 'environment-preparation-report' })
    ]);
    const reportPath = result.adapterRun.artifacts[0]?.path;
    expect(reportPath).toBeTruthy();
    expect(fs.existsSync(reportPath ?? '')).toBe(true);
  });

  it('runs automated execution commands and emits execution report plus verification evidence', () => {
    const tempDir = createTempDir();
    const claim = createClaim(tempDir, 'automated-execution', 'node -e "process.stdout.write(\'ok\')"');

    const result = runDeterministicTask(claim, tempDir);

    expect(result.adapterRun.status).toBe('completed');
    expect(result.adapterRun.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'execution-report' }),
      expect.objectContaining({ id: 'verification-evidence-1' })
    ]));
  });

  it('writes relative deterministic artifacts under the provided task cwd', () => {
    const tempDir = createTempDir();
    const sandboxDir = createTempDir();
    const repoRoot = path.join(tempDir, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });

    const claim = createClaim(repoRoot, 'environment-preparation', 'node -e "process.stdout.write(\'ready\')"');
    if (!claim.taskClaim) {
      throw new Error('expected deterministic claim');
    }

    claim.taskClaim.runtimeContext.artifactsDir = 'spec2flow/outputs/execution/frontend-smoke';

    const expectedReportPath = path.join(repoRoot, 'spec2flow', 'outputs', 'execution', 'frontend-smoke', 'environment-preparation-report.json');
    const unexpectedReportPath = path.join(sandboxDir, 'spec2flow', 'outputs', 'execution', 'frontend-smoke', 'environment-preparation-report.json');
    const originalCwd = process.cwd();

    process.chdir(sandboxDir);

    try {
      const result = runDeterministicTask(claim, repoRoot);
      expect(result.adapterRun.artifacts[0]?.path).toBe('spec2flow/outputs/execution/frontend-smoke/environment-preparation-report.json');
      expect(fs.existsSync(expectedReportPath)).toBe(true);
      expect(fs.existsSync(unexpectedReportPath)).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('returns blocked for unsupported deterministic stages', () => {
    const tempDir = createTempDir();
    const unsupportedClaim = createClaim(tempDir, 'automated-execution', 'node -e "process.stdout.write(\'ok\')"');
    if (unsupportedClaim.taskClaim) {
      unsupportedClaim.taskClaim.stage = 'requirements-analysis';
      unsupportedClaim.taskClaim.taskId = 'frontend-smoke--requirements-analysis';
      unsupportedClaim.taskClaim.executorType = 'requirements-agent';
      unsupportedClaim.taskClaim.roleProfile.specialistRole = 'requirements-agent';
      unsupportedClaim.taskClaim.roleProfile.profileId = 'requirements-analysis-specialist';
      unsupportedClaim.taskClaim.roleProfile.commandPolicy = 'none';
      unsupportedClaim.taskClaim.roleProfile.expectedArtifacts = ['requirements-summary'];
    }

    const result = runDeterministicTask(unsupportedClaim, tempDir);

    expect(result.adapterRun.status).toBe('blocked');
    expect(result.adapterRun.errors[0]?.code).toBe('deterministic-unsupported-stage');
  });

  it('runs the async execution path with service orchestration, browser checks, and evidence indexing', async () => {
    const tempDir = createTempDir();
    const baseUrl = await startFixtureServer();
    const claim = createClaim(tempDir, 'automated-execution', 'node -e "process.stdout.write(\'ok\')"');

    if (!claim.taskClaim) {
      throw new Error('expected deterministic claim');
    }

    const projectAdapterPath = path.join(tempDir, 'project.json');
    const topologyPath = path.join(tempDir, 'topology.json');
    fs.writeFileSync(projectAdapterPath, JSON.stringify({
      spec2flow: {
        services: {
          frontend: {
            path: 'apps/frontend',
            health: `${baseUrl}/healthz`
          }
        }
      }
    }, null, 2));
    fs.writeFileSync(topologyPath, JSON.stringify({
      topology: {
        services: [
          {
            name: 'frontend',
            healthChecks: [
              {
                type: 'http',
                target: `${baseUrl}/healthz`,
                timeoutSeconds: 1
              }
            ]
          }
        ],
        startupOrder: ['frontend']
      }
    }, null, 2));

    claim.taskClaim.repositoryContext.projectAdapterRef = 'project.json';
    claim.taskClaim.repositoryContext.topologyRef = 'topology.json';
    claim.taskClaim.repositoryContext.taskInputs = {
      entryServices: ['frontend'],
      browserChecks: [
        {
          id: 'smoke-home',
          url: `${baseUrl}/`,
          expectText: 'fixture ready',
          expectTitle: 'Spec2Flow Fixture',
          required: true
        }
      ]
    };

    const result = await runDeterministicTaskAsync(claim, tempDir);

    expect(result.adapterRun.status).toBe('completed');
    expect(result.adapterRun.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'execution-report' }),
      expect.objectContaining({ id: 'execution-evidence-index' }),
      expect.objectContaining({ id: 'browser-check-smoke-home' }),
      expect.objectContaining({ id: 'browser-html-smoke-home' }),
      expect.objectContaining({ id: 'service-health-frontend' })
    ]));

    const evidenceIndexPath = result.adapterRun.artifacts.find((artifact) => artifact.id === 'execution-evidence-index')?.path;
    expect(evidenceIndexPath).toBeTruthy();
    expect(fs.existsSync(evidenceIndexPath ?? 'missing')).toBe(true);
  });
});
