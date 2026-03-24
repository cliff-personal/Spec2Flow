import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { runDeterministicTask } from './deterministic-execution-service.js';
import type { TaskClaimPayload } from '../types/index.js';

const tempDirs: string[] = [];

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
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

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
});