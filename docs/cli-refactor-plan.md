# CLI Refactor Plan

## Goal

Split the original CLI monolith by domain responsibility while keeping the CLI surface stable during the migration.

The target was a thin entrypoint plus focused modules for:

- CLI wiring
- shared filesystem and schema utilities
- onboarding validation
- planning and task-graph generation
- runtime state transitions
- adapter execution and preflight

## Why This Split Is Needed

The original CLI file mixed too many responsibilities:

- argument parsing
- filesystem and JSON/YAML IO
- schema registry
- onboarding validation rules
- route selection and planning
- execution-state transitions
- adapter integration
- workflow loop orchestration

This makes the file hard to read, hard to test, and hard to change safely.

## Phase 1

Low-risk extraction with no intended behavior change.

Move into dedicated modules:

- `cli/parse-args.ts`
- `cli/command-dispatch.ts`
- `shared/fs-utils.ts`
- `shared/schema-registry.ts`
- `onboarding/validator-service.ts`

Expected outcome:

- shared IO and onboarding rules are no longer embedded in the CLI shell
- future planning and runtime extraction can build on stable modules

## Phase 2

Extract planning domain logic:

- requirement text normalization
- route selection
- risk matching
- task bundle construction
- task graph generation

Suggested target modules:

- `planning/requirement-selection.ts`
- `planning/route-selection.ts`
- `planning/task-bundle-builder.ts`
- `planning/task-graph-service.ts`

Current implementation:

- `planning/task-graph-service.ts`
- `shared/collection-utils.ts`

Expected outcome:

- the CLI entrypoint no longer owns route selection and task-graph construction details
- planning behavior remains stable while the domain logic becomes easier to test and split further later

## Phase 3

Extract runtime state domain logic:

- execution-state initialization
- task indexes and status inference
- ready-task promotion
- claim generation
- task-result application
- workflow-loop state transitions

Suggested target modules:

- `runtime/execution-state-service.ts`
- `runtime/task-claim-service.ts`
- `runtime/task-result-service.ts`
- `runtime/workflow-loop-service.ts`

Current implementation:

- `runtime/execution-state-service.ts`
- `runtime/task-claim-service.ts`
- `runtime/task-result-service.ts`
- `runtime/workflow-loop-service.ts`

Expected outcome:

- the CLI entrypoint no longer owns execution-state mutation and workflow-loop transitions
- runtime state behavior stays centralized and reusable across direct commands and autonomous loop execution

## Phase 4

Extract adapter and preflight infrastructure:

- adapter template context
- external adapter runner
- adapter payload normalization
- Copilot preflight

Suggested target modules:

- `adapters/adapter-runner.ts`
- `adapters/adapter-normalizer.ts`
- `adapters/copilot-preflight.ts`

Current implementation:

- `adapters/adapter-runner.ts`
- `adapters/adapter-normalizer.ts`
- `adapters/copilot-preflight.ts`

Expected outcome:

- the CLI entrypoint no longer owns adapter command execution, adapter payload normalization, or Copilot CLI preflight details
- adapter behavior remains reusable across single-task execution and workflow-loop execution

## Completion Status

This refactor is complete.

- the legacy `packages/cli/src/spec2flow.mjs` monolith has been removed
- the source tree now keeps TypeScript modules only
- the default runtime is the compiled dist entrypoint under `packages/cli/dist/cli/spec2flow-dist-entrypoint.js`

## Rules For The Refactor

- keep the public CLI command names stable
- prefer moving existing logic over rewriting it
- separate pure domain logic from filesystem and process IO
- keep command handler files thin
- validate each phase with the smallest relevant CLI commands