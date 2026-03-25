# Automated Execution Playbook

- Status: active
- Source of truth: `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/shared/task-role-profile.ts`, `packages/cli/src/runtime/task-result-service.ts`, `packages/cli/src/runtime/deterministic-execution-service.ts`, `packages/cli/src/runtime/execution-artifact-store-service.ts`
- Verified with: `npm run build`, `npm run test:unit`, `npm run run:synapse-copilot-cli-loop`
- Last verified: 2026-03-25

## Starts When

This stage starts after the route's `test-design` task is completed.

In the task graph it is created as `<route-name>--automated-execution` and depends on `<route-name>--test-design`.

## Consumes

- route `verifyCommands`
- route `entryServices` when service orchestration is required
- route `browserChecks` when browser validation is declared
- route `executionPolicy` for timeout and teardown behavior
- target files and route boundaries
- designed test artifacts and implementation outputs from earlier stages

## Emits

- `execution-report`
- `verification-evidence`
- `execution-evidence-index`
- `execution-lifecycle-report`

These artifacts are required even when commands run successfully. Passing execution without the artifact contract is treated as incomplete.

When route metadata declares service or browser coverage, the deterministic execution runtime may also emit:

- service startup and health reports
- service teardown reports for services started by Spec2Flow
- browser HTML snapshots
- optional Playwright screenshot, trace, or video evidence when the repository runtime supports it
- `execution-artifact-catalog` with remote storage descriptors and upload lifecycle status when `artifactStore` is declared

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

Execution hardening rules:

- services that were already healthy before execution are observed but not torn down by Spec2Flow
- services started by deterministic execution are torn down according to `executionPolicy.teardownPolicy`
- long-running commands are stopped by the execution lifecycle guard when `executionPolicy.maxDurationSeconds` is exceeded
- `artifactStore.mode: local` should now be written explicitly as `provider: local-fs` when local repository storage is intended
- when `artifactStore.publicBaseUrl` points at `serve-platform-control-plane`, the task's catalog-backed `remoteUrl` can resolve through `/artifacts/<objectKey>` even in local mode
- `artifactStore.mode: remote-catalog` can now push artifacts to a generic HTTP object store and expose retrieval metadata through the control plane

## Validation Path

- `npm run build`
- `npm run test:unit`
- `npm run run:synapse-copilot-cli-loop`

The unit and integration tests around `task-result-service` are the main regression guard for this rerouting logic.
