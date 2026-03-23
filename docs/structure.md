# Repository Structure

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
│  ├─ mvp.md
│  ├─ index.md
│  ├─ structure.md
│  ├─ copilot.md
│  ├─ Harness_engineering.md
│  ├─ playbooks/
│  │  ├─ index.md
│  │  ├─ requirements-analysis.md
│  │  ├─ code-implementation.md
│  │  ├─ test-design.md
│  │  ├─ automated-execution.md
│  │  ├─ defect-feedback.md
│  │  └─ collaboration.md
│  ├─ roadmap.md
│  ├─ architecture.md
│  ├─ collaboration.md
│  ├─ implementation-plan.md
│  ├─ full-implementation-plan.md
│  ├─ typescript-migration-plan.md
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
- `docs/playbooks/index.md` for stage-scoped execution guidance
- `docs/architecture.md` for runtime boundaries
- `docs/usage-guide.md` for adoption flow
- `docs/synapse-integration-automation-design.md` for complex-system integration

### `docs/playbooks/`
Short operational guides for each route stage. These files are the preferred AI-facing context once a task has already been claimed and the stage is known.

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