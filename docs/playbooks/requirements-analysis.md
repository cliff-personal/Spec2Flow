# Requirements Analysis Playbook

- Status: active
- Source of truth: `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/shared/task-role-profile.ts`
- Verified with: `npm run build`, `npm run test:unit`, `npm run submit:synapse-task-result`

## Starts When

This stage starts after `environment-preparation` is ready or completed for a selected route.

In the task graph it is created as `<route-name>--requirements-analysis` and depends on `environment-preparation`.

## Consumes

- route name and entry services from the task graph
- changed files, matched risk rules, and optional requirement text from task inputs
- project, topology, and risk context already loaded by `environment-preparation`

## Emits

- `requirements-summary`

The output should capture scope, impacted services, and acceptance criteria for the route.

## Allowed Actions

- read repository: yes
- edit files: no
- run commands: no
- write artifacts: yes
- open collaboration: no

The role profile is `requirements-analysis-specialist` with command policy `none`.

## Fails When

- the stage omits the required `requirements-summary` artifact
- the output does not produce route-scoped requirements that downstream stages can consume
- the task reports command execution or repository edits that exceed the stage contract

## Handoff

The next stage is `code-implementation`. That task becomes ready only after this stage is submitted as complete and dependencies are promoted in execution state.

## Validation Path

- `npm run generate:synapse-task-graph`
- `npm run generate:synapse-execution-state`
- `npm run claim:synapse-next-task`
- `npm run submit:synapse-task-result`
- `npm run test:unit`