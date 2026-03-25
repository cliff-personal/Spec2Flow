# Automated Execution Playbook

- Status: active
- Source of truth: `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/shared/task-role-profile.ts`, `packages/cli/src/runtime/task-result-service.ts`
- Verified with: `npm run build`, `npm run test:unit`, `npm run run:synapse-copilot-cli-loop`
- Last verified: 2026-03-25

## Starts When

This stage starts after the route's `test-design` task is completed.

In the task graph it is created as `<route-name>--automated-execution` and depends on `<route-name>--test-design`.

## Consumes

- route `verifyCommands`
- target files and route boundaries
- designed test artifacts and implementation outputs from earlier stages

## Emits

- `execution-report`
- `verification-evidence`

These artifacts are required even when commands run successfully. Passing execution without the artifact contract is treated as incomplete.

## Allowed Actions

- read repository: yes
- edit files: no
- run commands: yes
- write artifacts: yes
- open collaboration: no

The role profile is `automated-execution-specialist` with command policy `verification-only`.

## Fails Or Reroutes When

- the task result status is `failed` or `blocked`
- the required artifacts are missing
- verification-only execution reports repository edits or collaboration side effects

When any of those conditions happen, runtime routing sends the route into `defect-feedback` and keeps `collaboration` from opening early.

## Handoff

- success with satisfied artifact contract: `defect-feedback` is auto-skipped and `collaboration` can be promoted
- failed, blocked, or missing artifact contract: `defect-feedback` becomes the required next stage

## Validation Path

- `npm run build`
- `npm run test:unit`
- `npm run run:synapse-copilot-cli-loop`

The unit and integration tests around `task-result-service` are the main regression guard for this rerouting logic.
