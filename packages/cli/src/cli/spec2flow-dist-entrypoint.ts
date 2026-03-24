#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { dispatchCommand } from './command-dispatch.js';
import { parseArgs } from './parse-args.js';
import { fail, parseCsvOption, printJson, readStructuredFile, rootDir, writeJson } from '../shared/fs-utils.js';
import { getSchemaValidators } from '../shared/schema-registry.js';
import { buildDistCommandHandlers } from './dist-command-handlers.js';
import { ensureAdapterPreflight } from '../adapters/copilot-preflight.js';
import { getRouteNameFromTaskId } from '../runtime/task-claim-service.js';
import type { AdapterRuntimeDocument } from '../types/index.js';

function validateAdapterRuntimePayload(adapterRuntimePayload: AdapterRuntimeDocument, runtimePath: string): void {
  const validators = getSchemaValidators();
  const valid = validators.adapterRuntime(adapterRuntimePayload);
  if (!valid) {
    fail(`adapter runtime validation failed for ${runtimePath}: ${JSON.stringify(validators.adapterRuntime.errors ?? [])}`);
  }
}

function sanitizeStageName(stage: string): string {
  return stage.replaceAll(/[^a-z0-9-]/gi, '-').toLowerCase();
}

const usage = 'usage: spec2flow <validate-onboarding|validate-docs|generate-task-graph|migrate-platform-db|init-platform-run|init-execution-state|update-execution-state|claim-next-task|submit-task-result|simulate-model-run|preflight-copilot-cli|run-task-with-adapter|run-deterministic-task|run-workflow-loop> --project <file> --topology <file> --risk <file> [--repo-root <dir>] [--repository-id <id>] [--repository-name <name>] [--default-branch <name>] [--database-url <url>] [--database-schema <name>] [--migrations-dir <dir>] [--requirement <text>] [--requirement-file <file>] [--changed-files <a,b>] [--changed-files-file <file>] [--changed-files-from-git] [--git-diff-repo <path>] [--git-base <ref>] [--git-head <ref>] [--git-staged] [--task-graph <file>] [--state <file>] [--task-id <id>] [--task-status <status>] [--result-status <status>] [--claim <file>] [--adapter-capability <file>] [--adapter-runtime <file>] [--adapter-output <file>] [--preflight-output <file>] [--summary <text>] [--notes <a,b>] [--artifact-refs <a,b>] [--add-artifacts <id|kind|path>] [--add-errors <code|message>] [--executor <name>] [--status <workflow-status>] [--stage <workflow-stage>] [--increment-attempts] [--run-id <id>] [--adapter <name>] [--model <name>] [--session-id <id>] [--max-steps <n>] [--output-base <dir>] [--output <file>]';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { command, options } = parseArgs(argv);

  const handled = await dispatchCommand(command, options, buildDistCommandHandlers({
    ensureAdapterPreflight: (preflightOptions, adapterRuntimePayload) =>
      ensureAdapterPreflight(preflightOptions, adapterRuntimePayload, {
        execFileSync
      }),
    execFileSync,
    fail,
    getRouteNameFromTaskId,
    parseCsvOption,
    printJson,
    readStructuredFile,
    sanitizeStageName,
    setExitCode: (code) => {
      process.exitCode = code;
    },
    rootDir,
    validateAdapterRuntimePayload,
    writeJson
  }));

  if (handled) {
    return;
  }

  fail(usage);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
