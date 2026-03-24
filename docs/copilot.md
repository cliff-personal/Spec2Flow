# Copilot Customization and Maintenance Strategy

- Status: active
- Source of truth: `.github/copilot-instructions.md`, `.github/instructions/`, `package.json`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`

## Purpose

This document defines how Spec2Flow should use Copilot customization files, TypeScript constraints, and tests to keep the repository maintainable over time.

The goal is to avoid four recurring failure modes:

- complexity growth without clear boundaries
- architecture drift between modules
- documentation drift from the real runtime
- changes that cannot be verified with a small deterministic command path

## Customization Model

Spec2Flow should use three layers of repository guidance instead of placing every rule in one file.

### 1. `AGENTS.md`

`AGENTS.md` is the repository constitution.

It should answer:

- why the repository exists
- what the core orchestration boundary is
- what architectural constraints must remain stable
- what quality bar a change must meet
- where contributors should navigate first

It should stay short, stable, and architecture-oriented.

### 2. `.github/copilot-instructions.md`

`.github/copilot-instructions.md` is the execution policy for day-to-day changes.

It should answer:

- how an agent should approach changes in this repository
- what must be validated after a change
- which artifacts must stay in sync
- what testing obligations exist
- which anti-patterns are unacceptable

It should be procedural rather than architectural.

### 3. Scoped instructions under `.github/instructions/`

Scoped instructions should carry rules that apply only to specific file families.

Spec2Flow should keep at least three scoped instruction files:

- a TypeScript CLI instruction for `packages/cli/src/**/*.ts`
- a schema instruction for `schemas/**/*.json`
- a docs instruction for `docs/**/*.md`

This keeps the always-on instruction set small while making the most important rules available exactly where they are needed.

## TypeScript Maintenance Constraints

TypeScript constraints should optimize for explicit contracts, simple reading paths, and easy verification.

### Boundary rules

- CLI command modules should stay thin and delegate business logic into domain services.
- Runtime state transitions should live in runtime or domain services, not in command handlers or adapter templates.
- Adapter modules should normalize provider-specific behavior, not own controller decisions.
- Shared utility modules should not absorb domain rules that belong in planning, runtime, or adapter layers.

### Contract rules

- Exported functions should declare explicit return types.
- New `any` usage is not allowed; use `unknown` plus narrowing when dynamic input is unavoidable.
- External inputs must be validated at the boundary with schemas or deterministic validation helpers.
- Public runtime contracts must stay aligned across TypeScript types, JSON schemas, and example artifacts.

### Complexity rules

- One file should serve one primary responsibility.
- If a feature requires changes across parsing, state mutation, schema validation, and formatting, extract shared domain logic rather than embedding more branching in one file.
- If a function mixes IO, policy decisions, and output formatting, split it before adding more behavior.
- When a change introduces a new workflow concept, define its persistence shape and validation path before wiring more orchestration around it.

## Verification Model

Spec2Flow should keep a small deterministic validation path for every meaningful change.

### Minimum verification matrix

- Type or module-structure only change: `npm run build`
- Contract or schema change: `npm run build` plus the smallest example generation command that exercises that contract
- Execution-state or routing change: `npm run build`, `npm run generate:synapse-execution-state`, and the smallest workflow-loop or task-result regression path
- Adapter change: `npm run build` plus the smallest adapter or preflight regression path
- Documentation that describes runtime behavior: verify referenced commands, contracts, and examples still match the implementation

### Sync requirements

When behavior changes, update all affected layers in the same change when practical:

- implementation
- schema
- examples or fixtures
- documentation
- tests

If a rule matters repeatedly, move it closer to enforcement:

- from narrative docs to scoped instructions
- from scoped instructions to tests or validation
- from convention to schema or runtime checks

## Testing Strategy

Spec2Flow should use tests to protect behavior contracts, not to chase line coverage.

### What must be unit tested

The first priority is modules that encode invariants or state transitions:

- execution-state construction and promotion rules
- task-result routing and artifact-contract behavior
- adapter normalization and policy enforcement
- schema validation boundary behavior
- route selection or requirement interpretation logic when it becomes more complex

### What does not need blanket unit tests

- trivial pass-through CLI wrappers
- simple data mappers with no branching or invariants
- generated build output

### Test policy

- New state transitions, validation rules, or policy decisions require unit tests.
- Bug fixes should add a failing test or regression fixture before or alongside the fix.
- Contract changes should update fixtures or contract tests in the same change.
- If a change cannot be tested deterministically, the reason should be stated explicitly in the change summary.

### Test layers

Spec2Flow should keep four layers of verification, but introduce them in phases:

1. unit tests for pure or mostly pure domain behavior
2. contract tests for schema-backed payloads
3. fixture regression tests for example workflows
4. small command-level integration tests for critical CLI paths

The initial rollout should prioritize unit tests plus the existing example-driven commands.

## Decision on test framework

Spec2Flow should use Vitest for the TypeScript source tree.

Reasons:

- it fits TypeScript module testing without adding much ceremony
- it works well for pure logic and small fixture regressions
- it lowers the cost of adding tests close to source modules

The repository should expose a small set of stable scripts for validation:

- `npm run build`
- `npm run typecheck`
- `npm run test:unit`
- `npm run validate:docs`

Additional verification commands can grow around these without replacing them.

## Rollout Plan

### Phase 1. clarify repository guidance

- keep `AGENTS.md` as the architecture constitution
- turn `.github/copilot-instructions.md` into an execution policy
- add scoped instructions for TypeScript, schemas, and docs
- add this document as the durable rationale

### Phase 2. add unit-test infrastructure

- introduce Vitest
- add `test:unit` to `package.json`
- keep the test surface focused on domain behavior, not generated output

### Phase 3. protect current invariants

- add unit tests for execution-state helpers
- add unit tests for task-result routing
- add unit tests for adapter role-policy enforcement

### Phase 4. expand contract safety

- add contract tests for schema-backed adapter or task payloads when behavior continues to grow
- extend fixture regressions only where command-level behavior is difficult to isolate with unit tests

## Initial deliverables

The initial implementation of this strategy should include:

- refined `AGENTS.md`
- refined `.github/copilot-instructions.md`
- scoped instructions in `.github/instructions/`
- Vitest-based unit test support
- first unit tests for runtime and adapter policy behavior

These deliverables establish the long-term maintenance baseline without over-expanding the repository.