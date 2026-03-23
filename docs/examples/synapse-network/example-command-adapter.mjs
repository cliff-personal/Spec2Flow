#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function sanitizeStageName(stage) {
  return stage.replaceAll(/[^a-z0-9-]/gi, '-').toLowerCase();
}

function getRouteNameFromTaskId(taskId) {
  return taskId.includes('--') ? taskId.split('--')[0] : taskId;
}

function stripCodeFence(content) {
  const trimmed = content.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function extractJsonPayload(content) {
  const normalized = stripCodeFence(content).trim();
  const firstObjectStart = normalized.indexOf('{');
  const lastObjectEnd = normalized.lastIndexOf('}');

  if (firstObjectStart === -1 || lastObjectEnd === -1 || lastObjectEnd < firstObjectStart) {
    return normalized;
  }

  return normalized.slice(firstObjectStart, lastObjectEnd + 1);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8'));
}

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name, fallback = '') {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim() || fallback;
}

function buildArtifactPath(claim) {
  const routeName = getRouteNameFromTaskId(claim.taskId);
  const stageName = sanitizeStageName(claim.stage);
  const artifactsDir = claim.runtimeContext?.artifactsDir || `spec2flow/outputs/execution/${routeName}`;
  return path.join(artifactsDir, `${stageName}-copilot-cli-output.json`);
}

function normalizePathForPrompt(filePath) {
  return filePath.replaceAll('\\', '/');
}

function getContextReferences(claimPayload, claimPath) {
  const repositoryContext = claimPayload.taskClaim?.repositoryContext ?? {};
  return [
    normalizePathForPrompt(claimPath),
    repositoryContext.projectAdapterRef,
    repositoryContext.topologyRef,
    repositoryContext.riskPolicyRef
  ].filter(Boolean);
}

function buildCopilotPrompt(claimPayload, claimPath) {
  const claim = claimPayload.taskClaim;
  const refs = getContextReferences(claimPayload, claimPath).map((filePath) => `@${filePath}`);
  const verificationSummary = (claim.repositoryContext?.verifyCommands ?? []).join(', ') || 'none';
  const targetFiles = (claim.repositoryContext?.targetFiles ?? []).join(', ') || 'none';

  return [
    'Execute exactly one Spec2Flow task claim and return JSON only.',
    'Use the repository instructions automatically loaded by Copilot CLI.',
    'Do not modify files. Do not run tests. Produce analysis/output only for the claimed task.',
    'Return a JSON object with keys: status, summary, notes, deliverable, errors.',
    'status must be one of completed, blocked, or failed.',
    'summary must be a short sentence.',
    'notes must be an array of short strings.',
    'deliverable must be JSON-compatible and should contain the useful task output.',
    'errors must be an array of objects with code, message, and optional recoverable.',
    `Task id: ${claim.taskId}.`,
    `Stage: ${claim.stage}.`,
    `Goal: ${claim.goal}.`,
    `Target files: ${targetFiles}.`,
    `Verify commands: ${verificationSummary}.`,
    `Context files: ${refs.join(' ')}.`,
    'If the context is insufficient or authentication/tooling blocks execution, return blocked or failed with a precise error message.',
    '',
    JSON.stringify(claimPayload, null, 2)
  ].join('\n');
}

function callCopilotCli(claimPayload, claimPath) {
  const adapterName = getOptionalEnv('SPEC2FLOW_COPILOT_ADAPTER_NAME', 'github-copilot-cli-adapter');
  const model = getOptionalEnv('SPEC2FLOW_COPILOT_MODEL', '');
  const prompt = buildCopilotPrompt(claimPayload, claimPath);
  const cwd = getOptionalEnv('SPEC2FLOW_COPILOT_CWD', process.cwd());
  const args = [
    'copilot',
    '--',
    '-p',
    prompt,
    '-s',
    '--stream',
    'off',
    '--no-color',
    '--allow-all-tools',
    '--no-ask-user',
    '--disable-builtin-mcps',
    '--disallow-temp-dir',
    '--available-tools',
    'view,grep,glob'
  ];

  if (model) {
    args.push('--model', model);
  }

  let stdout = '';

  try {
    stdout = execFileSync('gh', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        COPILOT_ALLOW_ALL: 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const stdoutText = error.stdout?.toString().trim();
    throw new Error(stderr || stdoutText || error.message);
  }

  let taskResult;
  try {
    taskResult = JSON.parse(extractJsonPayload(stdout));
  } catch (error) {
    throw new Error(`copilot cli output is not valid JSON: ${error.message}`);
  }

  return {
    provider: 'github-copilot-cli',
    model: model || 'default',
    adapterName,
    taskResult
  };
}

function buildAdapterRun(claimPayload, runResult) {
  const claim = claimPayload.taskClaim;
  const stageName = sanitizeStageName(claim.stage);
  const artifactPath = buildArtifactPath(claim);
  const resolvedArtifactPath = path.resolve(process.cwd(), artifactPath);
  const taskResult = runResult.taskResult ?? {};

  ensureDirForFile(resolvedArtifactPath);
  fs.writeFileSync(
    resolvedArtifactPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      adapter: runResult.adapterName,
      provider: runResult.provider,
      model: runResult.model,
      taskId: claim.taskId,
      stage: claim.stage,
      summary: taskResult.summary ?? `${claim.taskId}-completed`,
      notes: taskResult.notes ?? [],
      deliverable: taskResult.deliverable ?? null,
      integration: 'copilot-cli'
    }, null, 2)}\n`,
    'utf8'
  );

  return {
    adapterRun: {
      adapterName: runResult.adapterName,
      provider: runResult.provider,
      taskId: claim.taskId,
      runId: claim.runId,
      stage: claim.stage,
      status: taskResult.status ?? 'completed',
      summary: taskResult.summary ?? `${claim.stage}-completed`,
      notes: [
        `provider:${runResult.provider}`,
        `model:${runResult.model}`,
        `task:${claim.taskId}`,
        ...(Array.isArray(taskResult.notes) ? taskResult.notes : [])
      ],
      artifacts: [
        {
          id: `${claim.taskId}-${stageName}-model-output`,
          kind: 'report',
          path: artifactPath.replaceAll('\\', '/'),
          taskId: claim.taskId
        }
      ],
      errors: (taskResult.errors ?? []).map((error, index) => ({
        id: `${claim.taskId}-${stageName}-error-${index + 1}`,
        code: error.code ?? 'model-error',
        message: error.message ?? 'unknown model adapter error',
        taskId: claim.taskId,
        recoverable: error.recoverable ?? false
      }))
    }
  };
}

function buildFailureRun(claimPayload, error) {
  const claim = claimPayload?.taskClaim ?? {};
  return {
    adapterRun: {
      adapterName: getOptionalEnv('SPEC2FLOW_COPILOT_ADAPTER_NAME', 'github-copilot-cli-adapter'),
      provider: 'github-copilot-cli',
      taskId: claim.taskId ?? 'unknown-task',
      runId: claim.runId ?? 'unknown-run',
      stage: claim.stage ?? 'unknown-stage',
      status: 'failed',
      summary: `adapter failed for ${claim.taskId ?? 'unknown-task'}`,
      notes: [
        `task:${claim.taskId ?? 'unknown-task'}`,
        'adapter-execution-failed'
      ],
      artifacts: [],
      errors: [
        {
          id: `${claim.taskId ?? 'unknown-task'}-adapter-error-1`,
          code: 'adapter-execution-failed',
          message: error.message,
          taskId: claim.taskId ?? 'unknown-task',
          recoverable: false
        }
      ]
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const claimPath = options.claim;

  if (!claimPath) {
    throw new Error('example-command-adapter requires --claim');
  }

  const claimPayload = readJsonFile(claimPath);
  const runResult = callCopilotCli(claimPayload, claimPath);
  const result = buildAdapterRun(claimPayload, runResult);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  let claimPayload = null;
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.claim) {
      claimPayload = readJsonFile(options.claim);
    }
  } catch {
    claimPayload = null;
  }

  process.stdout.write(`${JSON.stringify(buildFailureRun(claimPayload, error), null, 2)}\n`);
}