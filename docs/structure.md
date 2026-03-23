# Proposed Repository Structure

## Goal

Keep the repository simple for a solo maintainer while leaving room for future expansion across the six workflow stages.

## Proposed Layout

```text
Spec2Flow/
├─ package.json
├─ README.md
├─ docs/
│  ├─ mvp.md
│  ├─ structure.md
│  ├─ roadmap.md
│  ├─ architecture.md
│  ├─ collaboration.md
│  ├─ implementation-plan.md
│  ├─ full-implementation-plan.md
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
│  │  │  └─ generated/
│  │  │     ├─ onboarding-validator-result.json
│  │  │     ├─ task-graph.json
│  │  │     ├─ task-graph-frontend-change.json
│  │  │     └─ task-graph-withdrawal-change.json
│  │  ├─ sample-spec.md
│  │  ├─ sample-requirement-summary.md
│  │  ├─ sample-implementation-tasks.md
│  │  ├─ sample-test-plan.md
│  │  ├─ sample-test-cases.yaml
│  │  └─ sample-bug-report.md
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
│  └─ bug-report.schema.json
├─ packages/
│  └─ cli/
│     └─ src/
│        └─ spec2flow.mjs
├─ playwright/
│  ├─ tests/
│  ├─ fixtures/
│  └─ playwright.config.ts
├─ scripts/
│  ├─ start-service.sh
│  ├─ run-smoke.sh
│  └─ collect-artifacts.sh
├─ .github/
│  ├─ ISSUE_TEMPLATE/
│  │  └─ bug-report.md
│  └─ workflows/
│     ├─ ci.yml
│     └─ playwright.yml
├─ reports/
│  ├─ execution/
│  └─ bugs/
└─ examples/
   └─ demo-project/
```

## Directory Responsibilities

### `docs/`
Project documentation, process definitions, examples, and architecture notes.

### `schemas/`
Structured definitions for:
- project adapters
- system topologies
- risk policies
- task graphs
- environment preparation reports
- onboarding validator results
- execution states
- requirement summaries
- implementation tasks
- test plans
- test cases
- execution reports
- model adapter capabilities
- bug reports

### `docs/examples/synapse-network/`
Reference onboarding configuration for a complex multi-service target system, plus generated validator and task graph outputs.

### `docs/examples/synapse-network/changes/`
Sample changed-file lists for diff-aware risk evaluation.

### `packages/core/`
Shared domain models, interfaces, config loading, and common utilities.

### `packages/planner/`
Spec/code analysis, requirement summarization, and test planning logic.

### `packages/implementer/`
Implementation task generation and code-change orchestration helpers.

### `packages/executor/`
Service startup, test execution orchestration, and artifact handling.

### `packages/reporter/`
Result summarization and bug draft generation.

### `packages/cli/`
Developer-facing CLI entrypoints. The current minimal implementation validates onboarding configs and generates task graphs from example adapters.

### `playwright/`
UI automation tests and configuration.

### `scripts/`
Simple shell helpers for local execution and debugging.

### `.github/workflows/`
CI workflows for validation and automated execution.

### `.github/ISSUE_TEMPLATE/`
GitHub Issues templates for bug intake and collaboration.

### `reports/`
Generated execution summaries and bug drafts.

## Solo Maintainer Recommendation

For the first implementation, do not fully build every package.
Start with:
- `docs/`
- `schemas/`
- `playwright/`
- `.github/workflows/`
- `.github/ISSUE_TEMPLATE/`
- a lightweight `packages/cli/` or `scripts/` entrypoint

Then expand only when real usage appears.