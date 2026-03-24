import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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

function runShellCommand(command: string, cwd: string, logPath: string): CommandRunResult {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8'
  });
  const combinedOutput = [result.stdout ?? '', result.stderr ?? ''].filter(Boolean).join('\n').trim();
  const resolvedLogPath = resolveFromBaseDir(cwd, logPath);
  ensureDirForFile(resolvedLogPath);
  fs.writeFileSync(resolvedLogPath, `${combinedOutput}\n`, 'utf8');

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

export function runDeterministicTask(claimPayload: TaskClaimPayload, cwd = process.cwd()): AdapterRunDocument {
  const claim = claimPayload.taskClaim;

  if (!claim) {
    throw new Error('deterministic execution requires a task claim');
  }

  if (!['environment-preparation', 'automated-execution'].includes(claim.stage)) {
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

  const commands = claim.repositoryContext.verifyCommands ?? [];
  if (commands.length === 0) {
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

  const artifactsDir = getArtifactsDir(claimPayload);
  const commandResults = commands.map((command, index) =>
    runShellCommand(command, cwd, path.join(artifactsDir, `${sanitizeFileToken(claim.taskId)}-verification-evidence-${index + 1}.log`))
  );
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