# Test Design Playbook

- Status: active
- Source of truth: `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/shared/task-role-profile.ts`
- Verified with: `npm run build`, `npm run test:unit`, `npm run run:synapse-copilot-cli-loop`
- Last verified: 2026-03-25

## Starts When

This stage starts after the route's `code-implementation` task is completed.

In the task graph it is created as `<route-name>--test-design` and depends on `<route-name>--code-implementation`.

## Consumes

- implementation outputs from the route
- `verifyCommands` attached to the route in the task graph
- route risk signals and target file boundaries

## Emits

- `test-plan`
- `test-cases`

These artifacts should explain what route-specific smoke or regression coverage is required and how it maps to runnable verification commands.

## Allowed Actions

- read repository: yes
- edit files: yes
- run commands: yes
- write artifacts: yes
- open collaboration: no

The role profile is `test-design-specialist` with command policy `safe-repo-commands`.

## Fails When

- the stage produces generic tests that are not tied to the selected route
- declared route verify commands are missing or no longer map to the designed coverage
- required test artifacts are missing from the result

## Handoff

The next stage is `automated-execution`. That stage expects runnable verification commands and enough evidence to execute the designed checks.

## Validation Path

- `npm run build`
- `npm run test:unit`
- `npm run run:synapse-copilot-cli-loop`

If a route-specific verify command is documented in the task graph, that command is part of the execution-stage validation surface and should stay aligned with the designed coverage.
