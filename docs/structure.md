# Repository Structure

- Status: active
- Source of truth: `package.json`, `AGENTS.md`, `llms.txt`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`

## Goal

Keep the repository simple to navigate for both humans and agents while leaving room for future expansion.

## Current Layout

```text
Spec2Flow/
├─ .github/
│  ├─ copilot-instructions.md
│  └─ instructions/
│     ├─ typescript-cli.instructions.md
│     ├─ schemas.instructions.md
│     └─ docs.instructions.md
├─ AGENTS.md
├─ llms.txt
├─ package.json
├─ tsconfig.json
├─ tsconfig.build.json
├─ vitest.config.ts
├─ README.md
├─ docs/
│  ├─ index.md
│  ├─ structure.md
│  ├─ copilot.md
│  ├─ Harness_engineering.md
│  ├─ adr/
│  │  ├─ index.md
│  │  ├─ 0001-orchestrator-is-system-of-record.md
│  │  ├─ 0002-adapter-execution-is-task-scoped.md
│  │  ├─ 0003-runtime-contracts-are-schema-backed.md
│  │  └─ 0004-compiled-dist-cli-is-the-default-runtime.md
│  ├─ playbooks/
│  │  ├─ index.md
│  │  ├─ requirements-analysis.md
│  │  ├─ code-implementation.md
│  │  ├─ test-design.md
│  │  ├─ automated-execution.md
│  │  ├─ defect-feedback.md
│  │  └─ collaboration.md
│  ├─ plans/
│  │  ├─ index.md
│  │  ├─ completed/
│  │  │  └─ index.md
│  │  └─ historical/
│  │     ├─ index.md
│  │     ├─ mvp.md
│  │     ├─ roadmap.md
│  │     ├─ implementation-plan.md
│  │     ├─ full-implementation-plan.md
│  │     ├─ typescript-migration-plan.md
│  │     └─ cli-refactor-plan.md
│  ├─ architecture.md
│  ├─ collaboration.md
│  ├─ runtime-config-reference.md
│  ├─ usage-guide.md
│  ├─ synapse-integration-automation-design.md
│  ├─ examples/
│  │  ├─ synapse-network/
│  │  │  ├─ README.md
│  │  │  ├─ changes/
│  │  │  │  ├─ frontend-change.txt
│  │  │  │  └─ withdrawal-change.txt
│  │  │  ├─ project.yaml
│  │  │  ├─ topology.yaml
│  │  │  ├─ risk.yaml
│  │  │  ├─ model-adapter-capability.json
│  │  │  ├─ model-adapter-runtime.json
│  │  │  └─ generated/
│  │  │     ├─ onboarding-validator-result.json
│  │  │     ├─ task-graph.json
│  │  │     ├─ task-graph-frontend-change.json
│  │  │     ├─ task-graph-withdrawal-change.json
│  │  │     ├─ execution-state.json
│  │  │     └─ workflow-loop-summary.json
├─ schemas/
│  ├─ project-adapter.schema.json
│  ├─ system-topology.schema.json
│  ├─ risk-policy.schema.json
│  ├─ task-graph.schema.json
│  ├─ environment-preparation-report.schema.json
│  ├─ onboarding-validator-result.schema.json
│  ├─ execution-state.schema.json
│  ├─ requirement-summary.schema.json
│  ├─ implementation-task.schema.json
│  ├─ test-plan.schema.json
│  ├─ test-case.schema.json
│  ├─ execution-report.schema.json
│  ├─ model-adapter-capability.schema.json
│  └─ model-adapter-runtime.schema.json
├─ packages/
│  └─ cli/
│     ├─ dist/
│     └─ src/
│        ├─ adapters/
│        ├─ cli/
│        ├─ onboarding/
│        ├─ planning/
│        ├─ runtime/
│        ├─ shared/
│        └─ types/
```

This file should describe the current repository map first. Future package splits or optional integrations belong in architecture or roadmap docs, not in the primary structure map.

## Directory Responsibilities

### Root Files

- `.github/copilot-instructions.md`: repository-wide Copilot execution rules
- `.github/instructions/`: scoped instructions for TypeScript, schemas, and docs
- `README.md`: product overview and quick start context
- `AGENTS.md`: repository rules, design principles, and documentation discipline
- `llms.txt`: machine-readable repository map for AI agents and external tooling
- `package.json`: CLI entrypoints and example workflow commands
- `tsconfig.json`: phase 0 TypeScript configuration for NodeNext typechecking without changing the current runtime entrypoint
- `tsconfig.build.json`: build configuration that emits runnable CLI artifacts into `packages/cli/dist/`
- `vitest.config.ts`: unit-test runner configuration for the TypeScript source tree

### `docs/`
Versioned record system for product intent, architecture, usage, and examples.

Recommended reading order:
- `README.md` for product overview
- `AGENTS.md` for repository rules and doc governance
- `llms.txt` for machine-readable repository discovery
- `docs/index.md` for the shortest AI-facing docs map
- `docs/copilot.md` for Copilot customization and maintenance policy
- `docs/Harness_engineering.md` for AI-facing repository optimization guidance
- `docs/adr/index.md` for stable architecture decisions
- `docs/playbooks/index.md` for stage-scoped execution guidance
- `docs/plans/index.md` for plan placement and archive rules
- `docs/architecture.md` for runtime boundaries
- `docs/runtime-config-reference.md` for runtime field semantics and override rules
- `docs/usage-guide.md` for adoption flow
- `docs/synapse-integration-automation-design.md` for complex-system integration

### `docs/adr/`
Small accepted decisions that should remain stable across refactors. These files are the shortest durable answer when a contributor or agent asks why a major architectural boundary exists.

### `docs/playbooks/`
Short operational guides for each route stage. These files are the preferred AI-facing context once a task has already been claimed and the stage is known.

### `docs/plans/`
Planning and migration material that should not crowd the active docs root.

- `docs/plans/index.md`: placement rules and archive policy for plan docs
- `docs/plans/completed/`: short-lived holding area for plans that were just completed
- `docs/plans/historical/`: superseded or completed plans kept only for archaeology

### `schemas/`
Structured definitions for:
- project adapters
- system topologies
- risk policies
- task graphs
- environment preparation reports
- onboarding validator results
- execution states
- model adapter capabilities
- model adapter runtimes

### `docs/examples/synapse-network/`
Reference onboarding configuration for a complex multi-service target system, plus generated validator, task graph, and runtime outputs.

### `docs/examples/synapse-network/changes/`
Sample changed-file lists for diff-aware and requirement-aware route selection examples.

### `packages/cli/`
Developer-facing CLI entrypoints. This is the current implementation surface for validation, task graph generation, execution-state lifecycle, task claiming, adapter execution, and workflow-loop orchestration.

### `packages/cli/dist/`
Generated build output for the TypeScript runtime. This directory is now the default CLI runtime surface used by the package bin and repository scripts.

The primary CLI entrypoint is `packages/cli/dist/cli/spec2flow-dist-entrypoint.js`.

### `packages/cli/src/cli/`
Thin CLI shell helpers such as argument parsing, command dispatch, and the TypeScript source entrypoint that emits the compiled runtime.

### `packages/cli/src/onboarding/`
Onboarding validation rules and repository configuration checks.

### `packages/cli/src/planning/`
Planning-domain logic for requirement interpretation, route selection, risk-aware task bundling, and task graph construction.

### `packages/cli/src/runtime/`
Runtime-domain logic for execution-state initialization, task claims, task results, and workflow-loop progression.

This directory also contains the first unit tests for runtime state and routing behavior.

### `packages/cli/src/adapters/`
Adapter infrastructure for external model/runtime invocation, adapter payload normalization, and Copilot CLI preflight checks.

This directory also contains adapter policy enforcement unit tests.

### `packages/cli/src/types/`
Phase 1 TypeScript domain types for the workflow model, execution state, task claims, task results, adapter contracts, and workflow loop summaries.

### `packages/cli/src/shared/`
Shared infrastructure utilities for filesystem IO, schema loading, and common output helpers.

## Documentation Layout Rules

- Keep `docs/` root for active source-of-truth docs, indexes, ADRs, playbooks, and examples.
- Put new plan, migration, and rollout documents under `docs/plans/`, not in the docs root.
- Move completed plans out of the root as soon as stable docs, code, and commands reflect the result.
- Archive superseded plans under `docs/plans/historical/` instead of leaving them in primary navigation.
- When two docs overlap, one must defer to the other and link outward rather than repeating behavior.
- New top-level docs should answer one dominant question and be wired into `README.md`, `llms.txt`, or `docs/index.md` only if they are active navigation targets.

These placement rules are not advisory only. `npm run validate:docs` fails when plan-like docs appear directly under `docs/` root or when root-level docs are marked `completed` or `historical`.

`npm run validate:docs` also fails when active or canonical docs link directly to specific archived plan files or cite them as source of truth. Historical references must flow through the plan index pages instead.

## Solo Maintainer Recommendation

For the first implementation, keep the map narrow and current.
Start with:
- `README.md`
- `AGENTS.md`
- `docs/`
- `schemas/`
- `packages/cli/`

Then expand only when real usage appears.

If future package splits become real, add them after the implementation exists and after the docs, commands, and contracts all point to the same structure.