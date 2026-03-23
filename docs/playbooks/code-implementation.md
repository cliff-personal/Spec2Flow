# Code Implementation Playbook

- Status: active
- Source of truth: `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/shared/task-role-profile.ts`
- Verified with: `npm run build`, `npm run test:unit`, `npm run run:synapse-copilot-cli-loop`

## Starts When

This stage starts after the route's `requirements-analysis` task is completed.

In the task graph it is created as `<route-name>--code-implementation` and depends on `<route-name>--requirements-analysis`.

## Consumes

- the route-scoped `requirements-summary`
- matched risk rules and requirement text passed through task inputs
- target file boundaries from the selected route

## Emits

- `implementation-summary`
- `code-diff`

These artifacts should describe what changed and keep the change inside the route's declared service boundaries.

## Allowed Actions

- read repository: yes
- edit files: yes
- run commands: yes
- write artifacts: yes
- open collaboration: no

The role profile is `code-implementation-specialist` with command policy `safe-repo-commands`.

## Fails When

- the task edits files outside the route boundary without an explicit graph change
- the stage completes without both required artifacts
- the implementation changes behavior but leaves the repository without a buildable or testable state

## Handoff

The next stage is `test-design`. That handoff assumes implementation evidence exists and target files now reflect the intended route change.

## Validation Path

- `npm run build`
- `npm run test:unit`
- `npm run run:synapse-copilot-cli-loop`

Use the loop command for end-to-end validation of the task claim, adapter execution, and state progression. Use unit tests when changing implementation-stage routing or permissions.