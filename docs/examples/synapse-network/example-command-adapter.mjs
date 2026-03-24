#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { resolveCopilotSession } from './copilot-session-store.mjs';

const copilotCliMaxBufferBytes = 16 * 1024 * 1024;

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

function extractCopilotAssistantContent(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const events = [];

  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      return content;
    }
  }

  const assistantMessages = events.filter((event) => event?.type === 'assistant.message');
  const finalMessage = assistantMessages.at(-1)?.data?.content;

  if (typeof finalMessage === 'string' && finalMessage.trim()) {
    return finalMessage;
  }

  return content;
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

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getSessionStoreDir() {
  return path.resolve(process.cwd(), getOptionalEnv('SPEC2FLOW_COPILOT_SESSION_DIR', '.spec2flow/runtime/copilot-sessions'));
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
    repositoryContext.requirementRef,
    repositoryContext.projectAdapterRef,
    repositoryContext.topologyRef,
    repositoryContext.riskPolicyRef,
    ...(repositoryContext.docs ?? [])
  ].filter(Boolean);
}

function isEnabled(value, fallback = false) {
  if (typeof value !== 'string') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function getExecutionToggles() {
  return {
    allowFileWrites: isEnabled(process.env.SPEC2FLOW_ALLOW_FILE_WRITES, true),
    allowTestRuns: isEnabled(process.env.SPEC2FLOW_ALLOW_TEST_RUNS, true),
    allowGitWrite: isEnabled(process.env.SPEC2FLOW_ALLOW_GIT_WRITE, false),
    allowPrCreate: isEnabled(process.env.SPEC2FLOW_ALLOW_PR_CREATE, false)
  };
}

function createStagePlan(artifactsDir, options = {}) {
  const {
    allowShell = false,
    allowWrite = false,
    instructions = []
  } = options;

  return {
    allowShell,
    allowWrite,
    instructions: [`Store any generated analysis artifacts under ${artifactsDir}.`, ...instructions]
  };
}

function buildRequirementsPlan(artifactsDir, toggles) {
  if (toggles.allowFileWrites) {
    return createStagePlan(artifactsDir, {
      allowWrite: true,
      instructions: [
      `You may create or update requirement analysis documents under ${artifactsDir}, but do not change source code.`,
      'Do not run tests in this stage.'
      ]
    });
  }

  return createStagePlan(artifactsDir, {
    instructions: [
      'Do not modify files because file writes are disabled.',
      'Do not run tests in this stage.'
    ]
  });
}

function buildCodeImplementationPlan(artifactsDir, toggles) {
  if (toggles.allowFileWrites) {
    return createStagePlan(artifactsDir, {
      allowShell: true,
      allowWrite: true,
      instructions: [
        'Modify only files needed for the claimed implementation scope, including directly related unit tests.',
        'Implement the required code changes in the repository, not just analysis.',
        'Do not create commits or pull requests in this stage.'
      ]
    });
  }

  return createStagePlan(artifactsDir, {
    allowShell: true,
    instructions: [
      'Return blocked if implementation requires file modification, because file writes are disabled.',
      'Do not create commits or pull requests in this stage.'
    ]
  });
}

function buildTestDesignPlan(artifactsDir, toggles) {
  if (toggles.allowFileWrites) {
    return createStagePlan(artifactsDir, {
      allowShell: true,
      allowWrite: true,
      instructions: [
        'Add or update unit tests and test-case artifacts needed for the claimed scope.',
        'Do not run the full test suite in this stage unless a very small check is required to validate syntax.'
      ]
    });
  }

  return createStagePlan(artifactsDir, {
    allowShell: true,
    instructions: [
      'Return blocked if test files need to be created or updated, because file writes are disabled.',
      'Do not run the full test suite in this stage unless a very small check is required to validate syntax.'
    ]
  });
}

function buildAutomatedExecutionPlan(artifactsDir, toggles) {
  if (toggles.allowTestRuns) {
    return createStagePlan(artifactsDir, {
      allowShell: true,
      instructions: [
        'Run the smallest relevant verification commands and unit tests for the claimed scope.',
        `Store test outputs, logs, and summaries under ${artifactsDir}.`,
        'Do not modify source files in this stage except when a command naturally produces generated outputs.'
      ]
    });
  }

  return createStagePlan(artifactsDir, {
    instructions: [
      'Return blocked if verification requires running tests, because test execution is disabled.',
      'Do not modify source files in this stage.'
    ]
  });
}

function buildCollaborationPlan(artifactsDir, toggles) {
  if (!toggles.allowGitWrite) {
    return createStagePlan(artifactsDir, {
      allowShell: true,
      allowWrite: toggles.allowFileWrites,
      instructions: [
        ...(toggles.allowFileWrites ? [`Write the collaboration handoff artifact under ${artifactsDir} before returning the final handoff summary.`] : []),
        'Do not commit or push because git write operations are disabled; prepare a PR-ready summary instead.'
      ]
    });
  }

  const prInstruction = toggles.allowPrCreate
    ? 'Push the branch and open or update a pull request for the claimed scope.'
    : 'Do not open a pull request because PR creation is disabled; prepare a PR-ready summary instead.';

  return createStagePlan(artifactsDir, {
    allowShell: true,
    allowWrite: toggles.allowFileWrites,
    instructions: [
      ...(toggles.allowFileWrites ? [`Write the collaboration handoff artifact under ${artifactsDir} before returning the final handoff summary.`] : []),
      'Prepare the final collaboration output from the implemented changes and validation results.',
      'Create a commit for the claimed scope only.',
      prInstruction
    ]
  });
}

function getStageExecutionPlan(claim) {
  const stage = claim.stage;
  const artifactsDir = claim.runtimeContext?.artifactsDir || 'spec2flow/outputs/execution';
  const toggles = getExecutionToggles();

  if (stage === 'environment-preparation') {
    return createStagePlan(artifactsDir, {
      allowShell: true,
      instructions: [
        'Read repository context, bootstrap commands, and constraints.',
        'You may run bootstrap or verification shell commands needed to validate the environment.',
        'Do not modify repository source files in this stage.'
      ]
    });
  }

  if (stage === 'requirements-analysis') {
    return buildRequirementsPlan(artifactsDir, toggles);
  }

  if (stage === 'code-implementation') {
    return buildCodeImplementationPlan(artifactsDir, toggles);
  }

  if (stage === 'test-design') {
    return buildTestDesignPlan(artifactsDir, toggles);
  }

  if (stage === 'automated-execution') {
    return buildAutomatedExecutionPlan(artifactsDir, toggles);
  }

  if (stage === 'defect-feedback') {
    return createStagePlan(
      artifactsDir,
      {
        allowWrite: toggles.allowFileWrites,
        instructions: [
          ...(toggles.allowFileWrites ? [`Write bug summaries or failure analysis artifacts under ${artifactsDir} when useful.`] : []),
          'Do not change application source code in this stage.'
        ]
      }
    );
  }

  if (stage === 'collaboration') {
    return buildCollaborationPlan(artifactsDir, toggles);
  }

  return createStagePlan(artifactsDir);
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
}

function normalizeActivity(value) {
  if (!value || typeof value !== 'object') {
    return {
      commands: [],
      editedFiles: [],
      artifactFiles: [],
      collaborationActions: []
    };
  }

  return {
    commands: normalizeStringList(value.commands),
    editedFiles: normalizeStringList(value.editedFiles),
    artifactFiles: normalizeStringList(value.artifactFiles),
    collaborationActions: normalizeStringList(value.collaborationActions)
  };
}

function buildCopilotPrompt(claimPayload, claimPath) {
  const claim = claimPayload.taskClaim;
  const refs = getContextReferences(claimPayload, claimPath).map((filePath) => `@${filePath}`);
  const verificationSummary = (claim.repositoryContext?.verifyCommands ?? []).join(', ') || 'none';
  const targetFiles = (claim.repositoryContext?.targetFiles ?? []).join(', ') || 'none';
  const stagePlan = getStageExecutionPlan(claim);

  return [
    'Execute exactly one Spec2Flow task claim and return JSON only.',
    'Use the repository instructions automatically loaded by Copilot CLI.',
    'Return a JSON object with keys: status, summary, notes, activity, deliverable, errors.',
    'status must be one of completed, blocked, or failed.',
    'summary must be a short sentence.',
    'notes must be an array of short strings.',
    'activity must be an object with arrays: commands, editedFiles, artifactFiles, collaborationActions.',
    'activity must describe only the actions you actually performed with Copilot tools during this task.',
    'deliverable must be JSON-compatible and should contain the useful task output.',
    'errors must be an array of objects with code, message, and optional recoverable.',
    'Use Copilot CLI tools when needed; do not pretend to have executed commands or edited files.',
    'The Spec2Flow adapter wrapper persists execution-state and output artifacts after your JSON response, so do not block on editing .spec2flow state files unless the claimed task explicitly targets them.',
    `Task id: ${claim.taskId}.`,
    `Stage: ${claim.stage}.`,
    `Goal: ${claim.goal}.`,
    `Role profile: ${claim.roleProfile.profileId}.`,
    `Command policy: ${claim.roleProfile.commandPolicy}.`,
    `Repository edits allowed: ${claim.roleProfile.canEditFiles}.`,
    `Command execution allowed: ${claim.roleProfile.canRunCommands}.`,
    `Collaboration actions allowed: ${claim.roleProfile.canOpenCollaboration}.`,
    `Target files: ${targetFiles}.`,
    `Verify commands: ${verificationSummary}.`,
    `Context files: ${refs.join(' ')}.`,
    ...stagePlan.instructions,
    'If the context is insufficient or authentication/tooling blocks execution, return blocked or failed with a precise error message.',
    '',
    JSON.stringify(claimPayload, null, 2)
  ].join('\n');
}

function callCopilotCli(claimPayload, claimPath) {
  const adapterName = getOptionalEnv('SPEC2FLOW_COPILOT_ADAPTER_NAME', 'github-copilot-cli-adapter');
  const model = getOptionalEnv('SPEC2FLOW_COPILOT_MODEL', '');
  const session = resolveCopilotSession({
    explicitSessionId: getOptionalEnv('SPEC2FLOW_COPILOT_SESSION_ID', ''),
    sessionKey: getOptionalEnv('SPEC2FLOW_COPILOT_SESSION_KEY', ''),
    sessionStoreDir: getSessionStoreDir(),
    persistMode: getOptionalEnv('SPEC2FLOW_COPILOT_SESSION_PERSIST_MODE', 'auto')
  });
  const claim = claimPayload.taskClaim;
  const stagePlan = getStageExecutionPlan(claim);
  const toggles = getExecutionToggles();
  const prompt = buildCopilotPrompt(claimPayload, claimPath);
  const cwd = getOptionalEnv('SPEC2FLOW_COPILOT_CWD', process.cwd());
  const args = [
    'copilot',
    '--',
    '--output-format',
    'json',
    '-p',
    prompt,
    '-s',
    '--stream',
    'off',
    '--no-color',
    '--allow-all-paths',
    '--allow-all-tools',
    '--no-ask-user',
    '--disable-builtin-mcps',
    '--disallow-temp-dir'
  ];

  if (!stagePlan.allowShell) {
    args.push('--deny-tool=shell');
  }

  if (!stagePlan.allowWrite) {
    args.push('--deny-tool=write');
  }

  if (!toggles.allowGitWrite) {
    args.push(
      '--deny-tool=shell(git add)',
      '--deny-tool=shell(git commit)',
      '--deny-tool=shell(git push)',
      '--deny-tool=shell(git merge)',
      '--deny-tool=shell(git rebase)',
      '--deny-tool=shell(git reset)',
      '--deny-tool=shell(git checkout)'
    );
  }

  if (!toggles.allowPrCreate) {
    args.push('--deny-tool=shell(gh pr:*)');
  }

  if (model) {
    args.push('--model', model);
  }

  args.push('--add-dir', cwd);

  if (session?.sessionId) {
    args.push(`--resume=${session.sessionId}`);
  }

  let stdout = '';

  try {
    stdout = execFileSync('gh', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: copilotCliMaxBufferBytes,
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
    const assistantContent = extractCopilotAssistantContent(stdout);
    taskResult = JSON.parse(extractJsonPayload(assistantContent));
  } catch (error) {
    throw new Error(`copilot cli output is not valid JSON: ${error.message}`);
  }

  return {
    provider: 'github-copilot-cli',
    model: model || 'default',
    adapterName,
    session,
    taskResult
  };
}

function buildAdapterRun(claimPayload, runResult) {
  const claim = claimPayload.taskClaim;
  const stageName = sanitizeStageName(claim.stage);
  const artifactPath = buildArtifactPath(claim);
  const resolvedArtifactPath = path.resolve(process.cwd(), artifactPath);
  const taskResult = runResult.taskResult ?? {};
  const activity = normalizeActivity(taskResult.activity);

  ensureDirForFile(resolvedArtifactPath);
  fs.writeFileSync(
    resolvedArtifactPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      adapter: runResult.adapterName,
      provider: runResult.provider,
      model: runResult.model,
      sessionId: runResult.session?.sessionId ?? null,
      sessionKey: runResult.session?.sessionKey ?? null,
      taskId: claim.taskId,
      stage: claim.stage,
      summary: taskResult.summary ?? `${claim.taskId}-completed`,
      notes: taskResult.notes ?? [],
      activity,
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
        ...(runResult.session?.sessionId ? [`session-id:${runResult.session.sessionId}`] : []),
        ...(runResult.session?.sessionKey ? [`session-key:${runResult.session.sessionKey}`] : []),
        ...(runResult.session?.persistence === 'ephemeral' ? ['session-persistence:ephemeral'] : []),
        ...(runResult.session?.legacyRecordRemoved ? ['session-cleanup:removed-legacy-record'] : []),
        ...(Array.isArray(taskResult.notes) ? taskResult.notes : [])
      ],
      activity,
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
      activity: {
        commands: [],
        editedFiles: [],
        artifactFiles: [],
        collaborationActions: []
      },
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