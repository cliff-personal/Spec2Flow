# Stage Playbooks

- Status: active
- Source of truth: `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/shared/task-role-profile.ts`, `packages/cli/src/runtime/task-result-service.ts`
- Verified with: `npm run build`, `npm run test:unit`

## Purpose

This directory holds the shortest task-scoped execution guides for the six route stages in Spec2Flow.

Each playbook answers the same operational questions:

- when the stage starts
- which artifacts it consumes
- which artifacts it must emit
- which actions are allowed
- what fails or reroutes the stage
- which command path validates the behavior

## Reading Order

1. [requirements-analysis.md](requirements-analysis.md)
2. [code-implementation.md](code-implementation.md)
3. [test-design.md](test-design.md)
4. [automated-execution.md](automated-execution.md)
5. [defect-feedback.md](defect-feedback.md)
6. [collaboration.md](collaboration.md)

## Shared Rules

- Route stages are created in `packages/cli/src/planning/task-graph-service.ts`.
- Stage permissions and required artifacts come from `packages/cli/src/shared/task-role-profile.ts`.
- Task completion, rerouting, and promotion of downstream tasks are enforced in `packages/cli/src/runtime/task-result-service.ts` and `packages/cli/src/runtime/execution-state-service.ts`.
- Checked-in commands in `package.json` are the stable repo entrypoints for example generation and loop execution.

## Smallest Stable Validation Path

- `npm run build`
- `npm run test:unit`
- `npm run generate:synapse-task-graph`
- `npm run generate:synapse-execution-state`
- `npm run run:synapse-copilot-cli-loop`