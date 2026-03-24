import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ensureDirForFile, loadOptionalStructuredFileFrom, resolveFromBaseDir, writeJsonFrom } from '../shared/fs-utils.js';
import type { AdapterRunDocument, TaskClaimPayload } from '../types/index.js';

interface ProjectAdapterSummary {
  spec2flow?: {
    project?: {
      name?: string;
      type?: string;
    };
  };
}

interface CommandRunResult {
  command: string;
  status: 'passed' | 'failed' | 'blocked';
  exitCode: number | null;
  logPath: string;
}

export interface DeterministicExecutionOptions {
  signal?: AbortSignal;
}

function sanitizeFileToken(value: string): string {
  return value.replaceAll(/[^a-z0-9-]+/gi, '-').replaceAll(/^-+|-+$/g, '').toLowerCase() || 'task';
}

function formatCommandSummary(result: CommandRunResult): string {
  const exitSuffix = result.exitCode === null ? '' : ` (exit ${result.exitCode})`;
  return `${result.command}: ${result.status}${exitSuffix}`;
}

function getArtifactsDir(claimPayload: TaskClaimPayload): string {
  return claimPayload.taskClaim?.runtimeContext.artifactsDir
    ?? `spec2flow/outputs/execution/${sanitizeFileToken(claimPayload.taskClaim?.taskId ?? 'task')}`;
}

function writeCommandLog(cwd: string, logPath: string, stdout: string, stderr: string): void {
  const combinedOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
  const resolvedLogPath = resolveFromBaseDir(cwd, logPath);
  ensureDirForFile(resolvedLogPath);
  fs.writeFileSync(resolvedLogPath, `${combinedOutput}\n`, 'utf8');
}

function runShellCommand(command: string, cwd: string, logPath: string): CommandRunResult {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8'
  });

  writeCommandLog(cwd, logPath, result.stdout ?? '', result.stderr ?? '');

  if (typeof result.status === 'number' && result.status === 0) {
    return {
      command,
      status: 'passed',
      exitCode: result.status,
      logPath
    };
  }

  return {
    command,
    status: 'failed',
    exitCode: result.status,
    logPath
  };
}

function createAbortError(message: string): Error & { code: string; name: string; } {
  const error = new Error(message) as Error & { code: string; name: string; };
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function runShellCommandAsync(command: string, cwd: string, logPath: string, options: DeterministicExecutionOptions = {}): Promise<CommandRunResult> {
  if (options.signal?.aborted) {
    return Promise.reject(createAbortError(`deterministic command aborted before start: ${command}`));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
      callback();
    };

    const onAbort = (): void => {
      child.kill('SIGTERM');
      finish(() => reject(createAbortError(`deterministic command aborted: ${command}`)));
    };

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.on('error', (error) => {
      finish(() => reject(error));
    });
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      writeCommandLog(cwd, logPath, stdout, stderr);
      finish(() => resolve({
        command,
        status: code === 0 ? 'passed' : 'failed',
        exitCode: code,
        logPath
      }));
    });

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function buildEnvironmentPreparationReport(
  claimPayload: TaskClaimPayload,
  cwd: string,
  reportPath: string,
  commandResults: CommandRunResult[]
): Record<string, unknown> {
  const claim = claimPayload.taskClaim;
  const projectPayload = loadOptionalStructuredFileFrom<ProjectAdapterSummary>(cwd, claim?.repositoryContext.projectAdapterRef ?? undefined);
  const hasFailures = commandResults.some((result) => result.status !== 'passed');

  return {
    environmentPreparationReport: {
      repository: {
        path: cwd,
        name: projectPayload?.spec2flow?.project?.name ?? path.basename(cwd),
        type: projectPayload?.spec2flow?.project?.type ?? 'repository'
      },
      summary: {
        status: hasFailures ? 'blocked' : 'ready',
        notes: commandResults.map((result) => formatCommandSummary(result))
      },
      detected: {
        docs: (claim?.repositoryContext.docs ?? []).map((docPath) => ({
          path: docPath,
          kind: 'doc',
          confidence: 1
        })),
        scripts: [],
        tests: (claim?.repositoryContext.verifyCommands ?? []).map((command) => ({
          path: command,
          kind: 'verification-command',
          confidence: 1
        })),
        ci: [],
        services: []
      },
      generated: [
        {
          path: reportPath,
          kind: 'environment-preparation-report',
          generated: true
        },
        ...commandResults.map((result) => ({
          path: result.logPath,
          kind: 'log',
          generated: true
        }))
      ],
      gaps: hasFailures
        ? commandResults
          .filter((result) => result.status !== 'passed')
          .map((result, index) => ({
            id: `environment-command-${index + 1}`,
            severity: 'error',
            message: `Command failed during environment preparation: ${result.command}`,
            suggestedFix: 'Fix the failing bootstrap or verification command before resuming the workflow.',
            requiresHumanConfirmation: false
          }))
        : []
    }
  };
}

function buildExecutionReport(
  claimPayload: TaskClaimPayload,
  reportPath: string,
  commandResults: CommandRunResult[]
): Record<string, unknown> {
  const claim = claimPayload.taskClaim;
  const hasFailures = commandResults.some((result) => result.status !== 'passed');

  return {
    taskId: claim?.taskId,
    stage: 'automated-execution',
    goal: claim?.goal ?? 'Run verification commands',
    summary: hasFailures ? 'One or more verification commands failed.' : 'All verification commands passed.',
    outcome: hasFailures ? 'failed' : 'passed',
    commands: commandResults.map((result, index) => ({
      command: result.command,
      status: result.status,
      ...(result.exitCode === null ? {} : { exitCode: result.exitCode }),
      evidenceRefs: [`verification-evidence-${index + 1}`]
    })),
    evidence: commandResults.map((result, index) => ({
      id: `verification-evidence-${index + 1}`,
      path: result.logPath,
      kind: 'log'
    }))
  };
}

function buildUnsupportedStageResult(claim: NonNullable<TaskClaimPayload['taskClaim']>): AdapterRunDocument {
  return {
    adapterRun: {
      adapterName: 'spec2flow-deterministic-runner',
      provider: 'spec2flow-deterministic',
      taskId: claim.taskId,
      runId: claim.runId,
      stage: claim.stage,
      status: 'blocked',
      summary: `deterministic execution is not supported for ${claim.stage}`,
      notes: ['deterministic-runner:unsupported-stage'],
      activity: {
        commands: [],
        editedFiles: [],
        artifactFiles: [],
        collaborationActions: []
      },
      artifacts: [],
      errors: [
        {
          code: 'deterministic-unsupported-stage',
          message: `deterministic execution currently supports only environment-preparation and automated-execution, not ${claim.stage}`,
          taskId: claim.taskId,
          recoverable: true
        }
      ]
    }
  };
}

function buildNoCommandsResult(claim: NonNullable<TaskClaimPayload['taskClaim']>): AdapterRunDocument {
  return {
    adapterRun: {
      adapterName: 'spec2flow-deterministic-runner',
      provider: 'spec2flow-deterministic',
      taskId: claim.taskId,
      runId: claim.runId,
      stage: claim.stage,
      status: 'blocked',
      summary: 'no deterministic commands were declared for this task',
      notes: ['deterministic-runner:no-commands'],
      activity: {
        commands: [],
        editedFiles: [],
        artifactFiles: [],
        collaborationActions: []
      },
      artifacts: [],
      errors: [
        {
          code: 'deterministic-no-commands',
          message: 'The claimed task does not declare any verifyCommands for deterministic execution.',
          taskId: claim.taskId,
          recoverable: true
        }
      ]
    }
  };
}

function buildDeterministicResult(
  claimPayload: TaskClaimPayload,
  cwd: string,
  commandResults: CommandRunResult[]
): AdapterRunDocument {
  const claim = claimPayload.taskClaim;
  if (!claim) {
    throw new Error('deterministic execution requires a task claim');
  }

  const commands = claim.repositoryContext.verifyCommands ?? [];
  const artifactsDir = getArtifactsDir(claimPayload);
  const hasFailures = commandResults.some((result) => result.status !== 'passed');

  if (claim.stage === 'environment-preparation') {
    const reportPath = path.join(artifactsDir, 'environment-preparation-report.json');
    const reportPayload = buildEnvironmentPreparationReport(claimPayload, cwd, reportPath, commandResults);
    writeJsonFrom(cwd, reportPath, reportPayload);

    return {
      adapterRun: {
        adapterName: 'spec2flow-deterministic-runner',
        provider: 'spec2flow-deterministic',
        taskId: claim.taskId,
        runId: claim.runId,
        stage: claim.stage,
        status: hasFailures ? 'blocked' : 'completed',
        summary: hasFailures ? 'environment preparation reported a blocking command failure' : 'environment preparation completed deterministically',
        notes: commandResults.map((result) => `${result.command}:${result.status}`),
        activity: {
          commands,
          editedFiles: [],
          artifactFiles: [reportPath, ...commandResults.map((result) => result.logPath)],
          collaborationActions: []
        },
        artifacts: [
          {
            id: 'environment-preparation-report',
            kind: 'report',
            path: reportPath,
            taskId: claim.taskId
          }
        ],
        errors: hasFailures
          ? commandResults
            .filter((result) => result.status !== 'passed')
            .map((result) => ({
              code: 'deterministic-command-failed',
              message: `Command failed during environment preparation: ${result.command}`,
              taskId: claim.taskId,
              recoverable: true
            }))
          : []
      }
    };
  }

  const reportPath = path.join(artifactsDir, 'execution-report.json');
  const reportPayload = buildExecutionReport(claimPayload, reportPath, commandResults);
  writeJsonFrom(cwd, reportPath, reportPayload);

  return {
    adapterRun: {
      adapterName: 'spec2flow-deterministic-runner',
      provider: 'spec2flow-deterministic',
      taskId: claim.taskId,
      runId: claim.runId,
      stage: claim.stage,
      status: hasFailures ? 'failed' : 'completed',
      summary: hasFailures ? 'deterministic verification failed' : 'deterministic verification passed',
      notes: commandResults.map((result) => `${result.command}:${result.status}`),
      activity: {
        commands,
        editedFiles: [],
        artifactFiles: [reportPath, ...commandResults.map((result) => result.logPath)],
        collaborationActions: []
      },
      artifacts: [
        {
          id: 'execution-report',
          kind: 'report',
          path: reportPath,
          taskId: claim.taskId
        },
        ...commandResults.map((result, index) => ({
          id: `verification-evidence-${index + 1}`,
          kind: 'log' as const,
          path: result.logPath,
          taskId: claim.taskId
        }))
      ],
      errors: hasFailures
        ? commandResults
          .filter((result) => result.status !== 'passed')
          .map((result) => ({
            code: 'deterministic-command-failed',
            message: `Verification command failed: ${result.command}`,
            taskId: claim.taskId,
            recoverable: true
          }))
        : []
    }
  };
}

export function runDeterministicTask(claimPayload: TaskClaimPayload, cwd = process.cwd()): AdapterRunDocument {
  const claim = claimPayload.taskClaim;

  if (!claim) {
    throw new Error('deterministic execution requires a task claim');
  }

  if (!['environment-preparation', 'automated-execution'].includes(claim.stage)) {
    return buildUnsupportedStageResult(claim);
  }

  const commands = claim.repositoryContext.verifyCommands ?? [];
  if (commands.length === 0) {
    return buildNoCommandsResult(claim);
  }

  const artifactsDir = getArtifactsDir(claimPayload);
  const commandResults = commands.map((command, index) =>
    runShellCommand(command, cwd, path.join(artifactsDir, `${sanitizeFileToken(claim.taskId)}-verification-evidence-${index + 1}.log`))
  );

  return buildDeterministicResult(claimPayload, cwd, commandResults);
}

export async function runDeterministicTaskAsync(
  claimPayload: TaskClaimPayload,
  cwd = process.cwd(),
  options: DeterministicExecutionOptions = {}
): Promise<AdapterRunDocument> {
  const claim = claimPayload.taskClaim;

  if (!claim) {
    throw new Error('deterministic execution requires a task claim');
  }

  if (!['environment-preparation', 'automated-execution'].includes(claim.stage)) {
    return buildUnsupportedStageResult(claim);
  }

  const commands = claim.repositoryContext.verifyCommands ?? [];
  if (commands.length === 0) {
    return buildNoCommandsResult(claim);
  }

  const artifactsDir = getArtifactsDir(claimPayload);
  const commandResults: CommandRunResult[] = [];

  for (const [index, command] of commands.entries()) {
    commandResults.push(await runShellCommandAsync(
      command,
      cwd,
      path.join(artifactsDir, `${sanitizeFileToken(claim.taskId)}-verification-evidence-${index + 1}.log`),
      options
    ));
  }

  return buildDeterministicResult(claimPayload, cwd, commandResults);
}
