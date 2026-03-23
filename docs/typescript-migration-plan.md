# TypeScript Migration Plan

## Goal

Migrate Spec2Flow to TypeScript incrementally while preserving:

- ESM only
- NodeNext module behavior
- existing JSON schema and Ajv runtime validation
- gradual replacement of `.mjs` files instead of a full rewrite

The migration goal is not TypeScript for its own sake. The goal is to make the repository safer to evolve for:

- long-term maintenance by more than one contributor
- multiple providers and multiple repositories
- more complex workflow state transitions and resume behavior
- lower refactor risk as the orchestration model grows

## Non-Goals

- do not switch back to CommonJS
- do not replace JSON schema with TypeScript types
- do not rewrite all `.mjs` files in one pass
- do not bundle the CLI unless a later packaging need appears

## Core Rule

Keep two validation layers permanently:

1. TypeScript types for development-time constraints
2. JSON schema plus Ajv for runtime input validation

TypeScript should describe trusted in-memory shapes.
Ajv should continue to validate external inputs, persisted files, and provider outputs.

These layers solve different problems and should both remain.

## Recommended Compiler Mode

Use NodeNext from the start:

- `module: "NodeNext"`
- `moduleResolution: "NodeNext"`

Why NodeNext fits this repository:

- it matches Node's native ESM rules instead of inventing a parallel resolution model
- it makes extension handling explicit, which matters in a mixed `.mjs` and `.ts` codebase
- it is the least surprising path for a CLI that already runs as native ESM

Default new source files should be `.ts`.
Reserve `.mts` only for rare cases where emitted `.mjs` is explicitly required at a boundary.

## Migration Strategy

Use a staged migration with three parallel tracks:

1. type introduction
2. build and execution transition
3. module-by-module source replacement

The important constraint is runtime compatibility during the transition.
Because Node cannot execute `.ts` files directly in the current CLI path, the repository should not jump straight from source `.mjs` execution to mixed direct `.ts` execution.

## Phase 0: Introduce TypeScript Without Runtime Risk

Add TypeScript tooling first, but do not change the production execution path yet.

Recommended additions:

- `typescript`
- `@types/node`
- root `tsconfig.json`
- `npm run typecheck`

Recommended initial compiler settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowJs": true,
    "checkJs": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "useUnknownInCatchVariables": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": [
    "packages/**/*.ts",
    "packages/**/*.mts",
    "packages/**/*.cts",
    "packages/**/*.mjs"
  ]
}
```

Why this is the right first step:

- it introduces editor and CI typechecking immediately
- it does not force a build output strategy before the domain types exist
- it keeps the current `.mjs` CLI working unchanged

## Phase 1: Add Domain Types First

Before converting runtime modules, add explicit domain types for the core workflow model.

Recommended location:

- `packages/cli/src/types/`

Recommended file layout:

- `packages/cli/src/types/review-policy.ts`
- `packages/cli/src/types/task-graph.ts`
- `packages/cli/src/types/execution-state.ts`
- `packages/cli/src/types/task-claim.ts`
- `packages/cli/src/types/task-result.ts`
- `packages/cli/src/types/adapter-runtime.ts`
- `packages/cli/src/types/adapter-run.ts`
- `packages/cli/src/types/workflow-loop-summary.ts`
- `packages/cli/src/types/index.ts`

Current implementation:

- `packages/cli/src/types/review-policy.ts`
- `packages/cli/src/types/task-graph.ts`
- `packages/cli/src/types/execution-state.ts`
- `packages/cli/src/types/task-claim.ts`
- `packages/cli/src/types/task-result.ts`
- `packages/cli/src/types/adapter-runtime.ts`
- `packages/cli/src/types/adapter-run.ts`
- `packages/cli/src/types/workflow-loop-summary.ts`
- `packages/cli/src/types/index.ts`

Priority order for initial type definitions:

1. `ReviewPolicy`
2. `Task`
3. `TaskGraph`
4. `ExecutionState`
5. `TaskClaim`
6. `TaskResult`
7. `AdapterRuntime`
8. `AdapterRun`
9. `WorkflowLoopSummary`

This order is deliberate:

- `ReviewPolicy` is a small reusable building block
- `Task` and `TaskGraph` define the orchestration contract
- `ExecutionState` is the mutable runtime core
- `TaskClaim` and `TaskResult` define execution boundaries
- `AdapterRuntime` and `AdapterRun` define provider integration boundaries
- `WorkflowLoopSummary` depends on the others but is operationally secondary

## Phase 1A: Use Types From Existing `.mjs`

Do not convert modules immediately after adding the types.
Instead, start consuming them from existing `.mjs` files through JSDoc imports.

Example pattern:

```js
/** @typedef {import('../types/execution-state.js').ExecutionState} ExecutionState */
```

Or for parameter annotations:

```js
/**
 * @param {import('../types/task-claim.js').TaskClaimPayload} claimPayload
 */
```

This stage gives immediate value:

- editors understand the domain model
- function signatures become clearer before runtime conversion
- the team can discover missing concepts and naming problems cheaply

Current implementation status:

- phase 1A is complete and historical: the temporary JSDoc-on-`.mjs` bridge has been removed
- all runtime-relevant source modules now live in `.ts`
- the repository no longer depends on mixed `.mjs` and `.ts` source execution

## Phase 2: Introduce a Build Path

Once the type layer is stable, introduce a real build step.

Recommended direction:

- keep source under `packages/cli/src/`
- emit runnable output under `packages/cli/dist/`
- move scripts gradually from `node packages/cli/src/spec2flow.mjs` to the compiled dist CLI entrypoint

Recommended build files:

- `tsconfig.json` for shared settings and editor support
- `tsconfig.build.json` for emitted output

Recommended build config shape:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "packages/cli/dist",
    "rootDir": "packages/cli/src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["packages/cli/src/**/*.ts"]
}
```

Recommended scripts after this phase:

- `typecheck`: `tsc -p tsconfig.json --noEmit`
- `build`: `tsc -p tsconfig.build.json`
- `validate:synapse-example`: run the emitted CLI after build

Minimal build path now in repository:

- `tsconfig.build.json` emits the TypeScript source tree into `packages/cli/dist/`
- `npm run build` is the canonical first build command
- `npm run validate:synapse-example:dist` is the first explicit dist-runtime verification command
- `packages/cli/dist/` is ignored from git and treated as generated output
- the runtime switch phase is complete: the package `bin`, primary example scripts, and default `npm run spec2flow -- ...` path now target the compiled dist CLI

Important rule for this phase:

- switch command execution to `dist` before mixing runtime `.ts` imports into the live CLI entrypoint

That rule avoided the unstable middle state where `.mjs` source would import `.ts` source directly.

Current phase 1B status:

- phase 1B is complete and historical
- the temporary dual-file pattern has been removed
- the repository now keeps only TypeScript source plus generated dist output for the CLI runtime

Dist output strategy:

- `.ts` source files emit sibling `.js` files into `dist/`
- runtime execution happens through the compiled dist entrypoint
- the old dual-source bridge is no longer part of the repository runtime model

First progressive dist entrypoint:

- `packages/cli/dist/cli/spec2flow-dist-entrypoint.js`
- command handlers registered in `packages/cli/dist/cli/dist-command-handlers.js`
- migrated TS command paths can run directly from compiled `.js`
- all supported commands now execute directly through the compiled dist entrypoint without falling back to `spec2flow.mjs`

Initial commands routed through the shared dist entrypoint:

- `validate-onboarding`
- `preflight-copilot-cli`
- `generate-task-graph`
- `init-execution-state`
- `claim-next-task`
- `simulate-model-run`
- `run-task-with-adapter`
- `run-workflow-loop`
- `submit-task-result`

This keeps one compiled CLI surface growing over time instead of multiplying one-off dist-only entrypoints.

## Phase 3: Convert Leaf Modules First

Start with modules that are easiest to type and least entangled.

Recommended conversion order:

1. `packages/cli/src/shared/collection-utils.mjs`
2. `packages/cli/src/cli/parse-args.mjs`
3. `packages/cli/src/cli/command-dispatch.mjs`
4. `packages/cli/src/shared/fs-utils.mjs`
5. `packages/cli/src/shared/schema-registry.mjs`
6. `packages/cli/src/onboarding/validator-service.mjs`

Why this order works:

- small utility modules establish import style and TS conventions
- shared modules produce immediate benefits from stricter return and parameter typing
- onboarding validation is mostly deterministic and schema-shaped

Current phase 3 progress:

- `packages/cli/src/cli/parse-args.ts` now exists and the shared dist entrypoint consumes its compiled `.js` output
- `packages/cli/src/cli/command-dispatch.ts` now exists and the shared dist entrypoint consumes its compiled `.js` output
- `packages/cli/src/shared/fs-utils.ts` now exists and the current compiled-surface TypeScript modules consume its compiled `.js` output
- `packages/cli/src/shared/schema-registry.ts` now exists and the shared dist entrypoint consumes its compiled `.js` output for schema validation
- `packages/cli/src/onboarding/validator-service.ts` now exists and the compiled validate/generate command paths consume its compiled `.js` output
- `packages/cli/src/shared/collection-utils.ts` now exists as the first shared utility supporting a converted runtime service
- `packages/cli/src/runtime/execution-state-service.ts` now exists and the compiled init/submit command paths consume its compiled `.js` output
- `packages/cli/src/runtime/task-claim-service.ts` now exists and the compiled claim/submit/workflow-loop command paths consume its compiled `.js` output
- `packages/cli/src/runtime/task-result-service.ts` now exists and the compiled submit command path consumes its compiled `.js` output
- `packages/cli/src/runtime/workflow-loop-service.ts` now exists and the compiled run-workflow-loop command path consumes its compiled `.js` output
- `packages/cli/src/adapters/adapter-normalizer.ts` now exists and the compiled preflight/adapter execution paths consume its compiled `.js` output
- `packages/cli/src/adapters/adapter-runner.ts` now exists and the compiled simulate/run-task/run-workflow-loop command paths consume its compiled `.js` output
- `packages/cli/src/planning/task-graph-service.ts` now exists and the compiled generate-task-graph command path consumes its compiled `.js` output
- `packages/cli/src/cli/update-execution-state-command.ts` now exists and the compiled dist entrypoint no longer falls back to `spec2flow.mjs`
- the compiled command surface is now self-contained
- the default package runtime has switched: `package.json` `bin` now points to `packages/cli/dist/cli/spec2flow-dist-entrypoint.js`, `prepare` builds dist on install, and the primary repository scripts no longer call `src/spec2flow.mjs`
- the legacy `.mjs` compatibility chain has been deleted from `packages/cli/src/`

## Phase 4: Convert Core Domain Modules

After the leaf modules are stable in `.ts`, convert the modules that benefit most from strong domain typing.

Recommended order:

1. `packages/cli/src/runtime/execution-state-service.ts`
2. `packages/cli/src/runtime/task-claim-service.ts`
3. `packages/cli/src/runtime/task-result-service.ts`
4. `packages/cli/src/planning/task-graph-service.ts`
5. `packages/cli/src/runtime/workflow-loop-service.ts`

Why runtime comes before planning here:

- `ExecutionState`, `TaskClaim`, and `TaskResult` are the most error-prone mutation boundaries
- future state machine and resume logic will depend heavily on sound state typing
- strong typing here will reduce refactor risk faster than typing route-selection heuristics first

## Phase 5: Convert Provider Integration Modules

Convert adapter-related modules only after core domain types are established.

Recommended order:

1. `packages/cli/src/adapters/adapter-normalizer.ts`
2. `packages/cli/src/adapters/copilot-preflight.ts`
3. `packages/cli/src/adapters/adapter-runner.ts`

Why these should come later:

- provider boundaries are easier to model once `TaskClaim`, `TaskResult`, and `ExecutionState` are already typed
- multiple provider support will benefit from explicit discriminated unions introduced at this stage

## Phase 6: Convert the CLI Entrypoint Last

The legacy `packages/cli/src/spec2flow.mjs` entrypoint was intentionally left until the runtime switch was complete, and has now been removed.

Rationale:

- it is a boundary file that depends on almost every domain module
- converting it too early creates churn while internal APIs are still stabilizing
- after the earlier phases, the default runtime moved to the compiled entrypoint and the legacy source entrypoint could be deleted cleanly

## Type Design Guidance

### 1. Separate Persisted Payload Types From Internal State Types

The same conceptual object often has two forms:

- persisted JSON payload shape
- normalized in-memory shape used by services

Do not collapse these automatically if the code begins to diverge.

Recommended naming pattern:

- `ExecutionStateDocument`
- `ExecutionState`
- `TaskGraphDocument`
- `TaskGraph`

If the shapes are still identical today, keep one type for now, but preserve room to split them later.

### 2. Use Discriminated Unions For Status-Heavy Objects

Objects that will grow into a more explicit state machine should not stay as wide string bags forever.

Good candidates:

- task status
- execution status
- review policy mode
- adapter provider mode

This matters for future resume and recovery logic.

### 3. Keep Schema Validation Functions Explicit

Do not hide Ajv behind implicit generic helpers too early.

Prefer explicit functions such as:

- `validateExecutionStatePayload(...)`
- `validateAdapterRuntimePayload(...)`

TypeScript should narrow the type after validation, but the runtime validation call should remain visible in code.

### 4. Model Providers As Extensible Contracts

For multiple providers, avoid overfitting the first TypeScript pass to GitHub Copilot.

Recommended direction:

- shared `AdapterRuntimeBase`
- provider-specific extensions through discriminated unions
- provider capability and run-result types that support future implementations without rewriting controller logic

## Schema and Type Alignment Rule

For each priority object, keep a clear mapping:

- TypeScript type file
- JSON schema file if the object is persisted or externally supplied
- validator function location

Suggested first mapping table:

- `TaskGraph` -> `schemas/task-graph.schema.json` -> planning and runtime services
- `ExecutionState` -> `schemas/execution-state.schema.json` -> runtime services
- `AdapterRuntime` -> `schemas/model-adapter-runtime.schema.json` -> adapter runtime validation
- `TaskClaim` -> no schema yet, candidate for future schema if persisted independently across tools
- `TaskResult` -> no schema yet, candidate for future schema if exchanged across process boundaries
- `WorkflowLoopSummary` -> candidate for future schema if loop outputs become integration inputs

Where a persisted JSON artifact has no schema today and is starting to matter operationally, add a schema rather than relying only on TypeScript.

## Conventions For Gradual Replacement

- new runtime modules should be created as `.ts`
- when converting a file, replace one `.mjs` file with one `.ts` file where possible
- do not mix broad behavior changes with language migration in the same patch
- keep imports explicit with file extensions compatible with NodeNext output
- keep existing schema validators during and after each conversion

## Validation Plan Per Phase

Each migration phase should keep the smallest relevant verification path.

Recommended checks:

### After Phase 0

- `npm run typecheck`

### After Phase 2

- `npm run build`
- `npm run validate:synapse-example`

### After Core Runtime Conversions

- `npm run generate:synapse-task-graph`
- `npm run generate:synapse-execution-state`
- claim and submit result flows on the example inputs

### After Adapter Conversions

- simulated model run path
- external adapter path with available provider runtime
- workflow loop regression path

## Suggested First Implementation Slice

The best first slice is not converting the whole CLI.

The best first slice is:

1. add TS tooling and NodeNext config
2. add `packages/cli/src/types/` with the priority objects
3. annotate existing runtime and planning `.mjs` files with imported JSDoc types
4. make `typecheck` pass

That slice delivers immediate maintenance value with minimal runtime risk.

## Recommended Execution Sequence

Use this exact order unless a concrete blocker appears:

1. bootstrap TypeScript config and scripts
2. add domain types for the priority objects
3. annotate existing `.mjs` modules with those types
4. switch CLI execution to a built `dist` path
5. migrate leaf modules to `.ts`
6. migrate runtime and planning modules to `.ts`
7. migrate adapter modules to `.ts`
8. migrate `spec2flow.mjs` last

## Decision Summary

Recommended approach:

- ESM only
- NodeNext mode
- new files default to `.ts`
- old `.mjs` files replaced incrementally
- JSON schema and Ajv retained as runtime contract enforcement
- TypeScript added as a second, development-time safety layer

This approach is the best fit for Spec2Flow because it improves maintainability and refactor safety without breaking the existing CLI or collapsing orchestration and runtime validation into a single mechanism.