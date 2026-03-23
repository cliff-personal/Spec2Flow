# Defect Feedback Playbook

- Status: active
- Source of truth: `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/shared/task-role-profile.ts`, `packages/cli/src/runtime/task-result-service.ts`
- Verified with: `npm run build`, `npm run test:unit`, `npm run run:synapse-copilot-cli-loop`

## Starts When

This stage starts when the route's `automated-execution` task fails, blocks, or completes without the required artifact contract.

In the task graph it is created as `<route-name>--defect-feedback` and depends on `<route-name>--automated-execution`.

## Consumes

- `execution-report`
- `verification-evidence`
- execution errors and task notes recorded in execution state
- route-trigger notes added by runtime routing

## Emits

- `defect-summary`
- `bug-draft`

These artifacts should convert raw execution evidence into structured defect handoff material.

## Allowed Actions

- read repository: yes
- edit files: no
- run commands: no
- write artifacts: yes
- open collaboration: no

The role profile is `defect-feedback-specialist` with command policy `none`.

## Fails When

- the stage does not preserve the execution evidence needed for review or remediation
- `defect-summary` or `bug-draft` is missing
- the output tries to patch code or rerun commands instead of summarizing the defect state

## Handoff

The next stage is `collaboration`.

This stage may also be auto-skipped when `automated-execution` succeeds with the expected artifact contract. In that case collaboration can open without a defect artifact.

## Validation Path

- `npm run build`
- `npm run test:unit`
- `npm run run:synapse-copilot-cli-loop`

The main runtime regression to protect here is that defect handling must complete before collaboration is promoted when a defect route is active.