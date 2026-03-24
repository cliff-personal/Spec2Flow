# Collaboration Playbook

- Status: active
- Source of truth: `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/shared/task-role-profile.ts`, `packages/cli/src/runtime/task-result-service.ts`
- Verified with: `npm run build`, `npm run test:unit`, `npm run run:synapse-copilot-cli-loop`

## Starts When

This stage starts after the route's `defect-feedback` task is completed or skipped.

In the task graph it is created as `<route-name>--collaboration` and depends on `<route-name>--defect-feedback`.

The executor is always `collaboration-agent`.

If the route review policy requires human approval, that requirement stays in `reviewPolicy` and gates the handoff, but it does not change the executor type.

## Consumes

- route completion notes from earlier stages
- defect artifacts when a defect route was active
- review policy from the task graph
- execution-state evidence that the route is ready for handoff

## Emits

- `collaboration-handoff`

These artifacts should be ready for PR, issue, or review workflow handoff.

## Allowed Actions

- read repository: yes
- edit files: no
- run commands: no
- write artifacts: yes
- open collaboration: yes

The role profile uses command policy `collaboration-only`.

## Fails When

- the stage uses shell commands or repository edits under collaboration-only policy
- collaboration is opened before defect handling is completed or explicitly skipped
- the final handoff artifact is missing

## Handoff

This is the terminal route stage. It packages the route for review, approval, or external collaboration without mutating repository state.

## Validation Path

- `npm run build`
- `npm run test:unit`
- `npm run run:synapse-copilot-cli-loop`

The most important regression here is gating: collaboration should open only after the route is either green or has completed its defect-handling path.