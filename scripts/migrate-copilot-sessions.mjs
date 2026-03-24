#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  applySessionStoreMigration,
  loadSessionStoreRecords,
  planSessionStoreMigration
} from '../docs/examples/synapse-network/copilot-session-store.mjs';

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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const options = parseArgs(process.argv.slice(2));
const sessionStoreDir = path.resolve(process.cwd(), options.dir ?? '.spec2flow/runtime/copilot-sessions');
const reportPath = options.report ? path.resolve(process.cwd(), options.report) : null;
const dryRun = options['dry-run'] === true;

const records = loadSessionStoreRecords(sessionStoreDir);
const plan = planSessionStoreMigration(records, {
  now: new Date().toISOString(),
  sessionStoreDir
});
const execution = applySessionStoreMigration(plan, { dryRun });

const report = {
  generatedAt: new Date().toISOString(),
  sessionStoreDir,
  dryRun,
  summary: plan.summary,
  execution,
  actions: plan.actions
};

if (reportPath) {
  writeJson(reportPath, report);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);