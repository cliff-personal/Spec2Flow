# Spec2Flow

- Status: active
- Source of truth: `AGENTS.md`, `package.json`, `schemas/task-graph.schema.json`, `schemas/execution-state.schema.json`, `schemas/risk-policy.schema.json`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`, `npm run validate:synapse-example`
- Last verified: 2026-03-25

**Spec2Flow** is an open-source AI workflow framework for turning product requirements and repository context into a repeatable engineering loop.

It is the control plane for an agent-friendly development workflow:

**Requirements -> Implement -> Design Tests -> Execute -> Report -> Collaborate**

## Why Spec2Flow?

Modern development is no longer just about writing code. Teams need a repeatable workflow that can:

- understand product and design documents
- read and reason about an existing codebase
- translate requirements into implementation tasks
- generate test plans and test cases
- run repository-native validation commands
- run browser automation when UI coverage is needed
- collect evidence and draft bug reports
- connect execution results back into collaboration workflows

Spec2Flow aims to provide a practical foundation for that loop.

## Vision

Spec2Flow is designed to start simple and grow into a modular AI-driven development and testing workflow framework.

At the top level, the model is intentionally narrow:

- the CLI orchestrates work
- adapters connect external model runtimes
- schemas define contracts
- docs explain the system and remain part of the product

## Workflow

Spec2Flow is organized around a simple six-stage workflow:

1. **Requirements Analysis**: read docs and repository context, then produce a scoped requirement summary, assumptions, and impacted modules.
2. **Code Implementation**: turn approved requirements into implementation tasks, code changes, and reviewable outputs.
3. **Test Design**: generate structured test scope, risk areas, smoke coverage, regression coverage, and edge cases.
4. **Automated Execution**: run deterministic validation commands, start environments when needed, and use Playwright for browser validation and evidence capture.
5. **Defect Feedback**: turn failed execution results into evidence-backed bug drafts.
6. **Collaboration Workflow**: route results through GitHub Actions, GitHub Issues, and pull request review.

## Primary Outputs

Spec2Flow should produce structured outputs for each stage:

- requirement summaries
- implementation tasks
- test plans
- test cases
- execution reports
- bug drafts
- collaboration updates

## MVP Goals

The first version is intentionally narrow. It should be able to:

1. read product docs and repository context
2. produce implementation tasks and test plans
3. run canonical validation commands and browser checks when needed
4. capture evidence and draft bug reports
5. feed results back into a collaboration workflow

## Tooling Direction

The current baseline is explicitly built around:

- **Copilot-compatible adapters** for requirements analysis, implementation support, and test design
- **Repository-native command execution** for deterministic validation
- **Playwright** for browser automation and evidence capture when needed
- **GitHub Actions** for repeatable CI execution and artifact upload
- **GitHub Issues** for defect tracking and workflow coordination

## Suggested Architecture

Spec2Flow follows a workflow-centered architecture with explicit orchestration boundaries:

### Orchestration Layer
Responsible for:
- generating task graphs
- persisting execution state
- claiming ready tasks
- recording task results and artifacts

### Adapter Layer
Responsible for:
- mapping one claimed task into a provider-specific runtime
- managing task-scoped agent execution
- returning structured task results

### Agent Workflow Layer
Responsible for:
- understanding specs
- understanding code
- generating implementation tasks
- generating plans and test cases
- interpreting failures
- drafting bugs

### Execution Layer
Responsible for:
- starting services or test environments
- running validation commands
- running Playwright tests when needed
- collecting artifacts
- producing structured execution results

### Collaboration Layer
Responsible for:
- publishing CI results
- retaining artifacts
- routing failures into GitHub Issues
- supporting pull request validation and team visibility

## Principles

- **Simple first** - prefer explicit, explainable workflow boundaries
- **Execution over demos** - reliable automation matters more than impressive prompts
- **Docs and code stay in sync** - contracts, examples, and docs should reflect real behavior
- **Modular by default** - orchestration, adapters, execution, and collaboration should evolve independently
- **Verifiable by default** - meaningful changes should have a concrete validation path

## Roadmap Snapshot

### Phase 1 - Workflow Definition
- align docs with the six-stage workflow
- define schemas for plans, cases, execution reports, and bug drafts
- add collaboration conventions

### Phase 2 - Execution Baseline
- bootstrap Playwright
- define local startup flow
- capture evidence and execution summaries

### Phase 3 - Collaboration Integration
- add GitHub Actions workflows
- publish artifacts from CI
- map failed runs into GitHub Issues drafts

### Phase 4 - End-to-End Demo
- run a sample spec through requirement analysis, implementation planning, execution, and defect feedback

## Current Focus

Spec2Flow is still in the bootstrap stage.

The next implementation target is to establish:
- stable document structure
- workflow schemas
- a minimal execution baseline through canonical validation commands and Playwright where needed
- a GitHub Issues-based defect feedback loop

## Key Docs

- Docs governance lives in two places: use [docs/structure.md](docs/structure.md) for active documentation layout rules and [docs/plans/index.md](docs/plans/index.md) for archived and plan-only placement rules.
- [AGENTS.md](AGENTS.md)
- [llms.txt](llms.txt)
- [docs/index.md](docs/index.md)
- [docs/copilot.md](docs/copilot.md)
- [docs/Harness_engineering.md](docs/Harness_engineering.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/structure.md](docs/structure.md)
- [docs/collaboration.md](docs/collaboration.md)
- [docs/usage-guide.md](docs/usage-guide.md)
- [docs/plans/index.md](docs/plans/index.md)
- [docs/plans/historical/index.md](docs/plans/historical/index.md)
- [docs/synapse-integration-automation-design.md](docs/synapse-integration-automation-design.md)

## Current Contracts

- [schemas/project-adapter.schema.json](schemas/project-adapter.schema.json)
- [schemas/system-topology.schema.json](schemas/system-topology.schema.json)
- [schemas/risk-policy.schema.json](schemas/risk-policy.schema.json)
- [schemas/task-graph.schema.json](schemas/task-graph.schema.json)
- [schemas/environment-preparation-report.schema.json](schemas/environment-preparation-report.schema.json)
- [schemas/onboarding-validator-result.schema.json](schemas/onboarding-validator-result.schema.json)
- [schemas/execution-state.schema.json](schemas/execution-state.schema.json)
- [schemas/model-adapter-capability.schema.json](schemas/model-adapter-capability.schema.json)
- [schemas/model-adapter-runtime.schema.json](schemas/model-adapter-runtime.schema.json)

## Integration Examples

- [docs/examples/synapse-network/README.md](docs/examples/synapse-network/README.md)
- [docs/examples/synapse-network/project.yaml](docs/examples/synapse-network/project.yaml)
- [docs/examples/synapse-network/topology.yaml](docs/examples/synapse-network/topology.yaml)
- [docs/examples/synapse-network/risk.yaml](docs/examples/synapse-network/risk.yaml)
- [docs/examples/synapse-network/generated/onboarding-validator-result.json](docs/examples/synapse-network/generated/onboarding-validator-result.json)
- [docs/examples/synapse-network/generated/task-graph.json](docs/examples/synapse-network/generated/task-graph.json)
- [docs/examples/synapse-network/generated/execution-state.json](docs/examples/synapse-network/generated/execution-state.json)
- [docs/examples/synapse-network/generated/task-graph-frontend-change.json](docs/examples/synapse-network/generated/task-graph-frontend-change.json)
- [docs/examples/synapse-network/generated/task-graph-withdrawal-change.json](docs/examples/synapse-network/generated/task-graph-withdrawal-change.json)

## Minimal Runtime

Spec2Flow now includes a minimal CLI runtime for onboarding validation, task graph generation, and execution-state lifecycle management.

- [package.json](package.json)
- [packages/cli/src/cli/spec2flow-dist-entrypoint.ts](packages/cli/src/cli/spec2flow-dist-entrypoint.ts)

The default runtime now executes the compiled CLI under `packages/cli/dist/cli/spec2flow-dist-entrypoint.js`. `npm install` triggers `prepare`, so the dist entrypoint is built before the example scripts run.

Example commands:

```bash
npm install
npm run build
npm run test:unit
npm run migrate:platform-db -- --database-url postgresql://localhost:5432/spec2flow --database-schema spec2flow_platform
npm run validate:docs
npm run validate:synapse-example
npm run generate:synapse-task-graph
npm run generate:synapse-execution-state
npm run preflight:copilot-cli
npm run claim:synapse-next-task
npm run submit:synapse-task-result
npm run simulate:synapse-model-run
npm run run:synapse-task-with-adapter
npm run run:synapse-copilot-cli-loop
npm run run:synapse-workflow-loop
npm run init:platform-run -- --database-url postgresql://localhost:5432/spec2flow --database-schema spec2flow_platform --task-graph docs/examples/synapse-network/generated/task-graph.json --repository-id spec2flow --repository-name Spec2Flow --repo-root .
npm run lease:platform-task -- --database-url postgresql://localhost:5432/spec2flow --database-schema spec2flow_platform --run-id spec2flow-platform --worker-id worker-1
npm run heartbeat:platform-task -- --database-url postgresql://localhost:5432/spec2flow --database-schema spec2flow_platform --run-id spec2flow-platform --task-id some-task-id --worker-id worker-1
npm run start:platform-task -- --database-url postgresql://localhost:5432/spec2flow --database-schema spec2flow_platform --run-id spec2flow-platform --task-id some-task-id --worker-id worker-1
npm run expire:platform-leases -- --database-url postgresql://localhost:5432/spec2flow --database-schema spec2flow_platform --run-id spec2flow-platform
npm run get:platform-run-state -- --database-url postgresql://localhost:5432/spec2flow --database-schema spec2flow_platform --run-id spec2flow-platform
npm run spec2flow -- run-platform-worker-task --database-url postgresql://localhost:5432/spec2flow --database-schema spec2flow_platform --run-id spec2flow-platform --task-id environment-preparation --worker-id worker-1
npm run generate:synapse-task-graph:frontend-change
npm run generate:synapse-task-graph:withdrawal-change
```

`run-platform-worker-task` now includes execution-time lease protection:

- it starts a background heartbeat loop while the task is running
- it auto-renews the active lease on the configured heartbeat cadence
- it stops work if lease ownership is lost or if heartbeat transport failures hit the configured threshold

Spec2Flow now supports two adapter integration modes:

- capability-only simulation through `simulate-model-run`
- real external adapter execution through `run-task-with-adapter` or `run-workflow-loop --adapter-runtime <file>`

The example adapter is now wired to GitHub Copilot CLI through `gh copilot -p`, using the programmatic prompt mode documented in the Copilot CLI command reference.

Copilot CLI integration assumptions:

- `gh` is installed
- `gh copilot` is available on the machine
- the user is authenticated for Copilot CLI

Recommended bootstrap commands:

```bash
gh copilot -- --help
gh copilot login
gh auth status
```

Optional environment variables for the example adapter:

- `SPEC2FLOW_COPILOT_MODEL`
- `SPEC2FLOW_COPILOT_ADAPTER_NAME`
- `SPEC2FLOW_COPILOT_CWD`

If `SPEC2FLOW_COPILOT_MODEL` is unset, the adapter will use the Copilot CLI account default model instead of forcing one.

The preferred place to pin a model is `model-adapter-runtime.json` through `adapterRuntime.model`. If that field is omitted, Spec2Flow leaves model selection to Copilot CLI.

The adapter uses these Copilot CLI best-practice choices from the docs:

- one focused non-interactive session per task claim with `-p`
- repository custom instructions via `.github/copilot-instructions.md`
- explicit model selection via `--model`
- autonomous execution via `--no-ask-user`
- constrained tool surface via `--available-tools view,grep,glob`
- no unnecessary remote tooling via `--disable-builtin-mcps`

Important boundary: this integration targets GitHub Copilot CLI, not the VS Code Copilot Chat session API. The adapter shells out to `gh copilot -p` because that is the documented programmatic entrypoint.

The external adapter contract is intentionally thin:

1. Spec2Flow emits a claim payload for one `taskId`
2. an external command receives that claim path and any environment variables defined in `model-adapter-runtime.json`
3. the command returns JSON on stdout or writes JSON to a file
4. Spec2Flow normalizes that result and persists it back into `execution-state.json`

Before starting a real Copilot-backed run, you can probe the environment with:

```bash
npm run preflight:copilot-cli
```

That command checks:

- `gh copilot` is available
- `gh auth status` succeeds
- the configured model or Copilot default model works with a one-shot `gh copilot -p` JSON probe

When `run-task-with-adapter` or `run-workflow-loop` uses an adapter runtime whose provider is `github-copilot-cli`, Spec2Flow now runs this preflight automatically before execution.

If you need to bypass that check deliberately, pass `--skip-preflight`.

`generate-task-graph` also supports diff-aware risk matching:

```bash
npm run spec2flow -- generate-task-graph \
	--project docs/examples/synapse-network/project.yaml \
	--topology docs/examples/synapse-network/topology.yaml \
	--risk docs/examples/synapse-network/risk.yaml \
	--changed-files-from-git \
	--git-base origin/main \
	--git-head HEAD \
	--output docs/examples/synapse-network/generated/task-graph.json
```

`init-execution-state` expands every task in a task graph into a persisted runtime state file:

```bash
npm run spec2flow -- init-execution-state \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--run-id synapse-example-run \
	--adapter spec2flow-cli \
	--model gpt-5.4 \
	--session-id example-session \
	--output docs/examples/synapse-network/generated/execution-state.json
```

`update-execution-state` advances one subtask, appends notes or artifacts, and automatically promotes newly unblocked tasks to `ready`:

```bash
npm run spec2flow -- update-execution-state \
	--state docs/examples/synapse-network/generated/execution-state.json \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--task-id environment-preparation \
	--task-status completed \
	--notes bootstrap-ok
```

`claim-next-task` acts as the first controller primitive. It selects the next `ready` subtask, marks it `in-progress`, and emits the payload that a model adapter should consume:

```bash
npm run spec2flow -- claim-next-task \
	--state docs/examples/synapse-network/generated/execution-state.json \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--adapter-capability docs/examples/synapse-network/model-adapter-capability.json \
	--output docs/examples/synapse-network/generated/task-claim.json
```

`submit-task-result` closes the loop for one claimed subtask. It writes the outcome back into `execution-state.json`, appends artifacts or errors, and promotes any newly unblocked downstream subtasks:

```bash
npm run spec2flow -- submit-task-result \
	--state docs/examples/synapse-network/generated/execution-state.json \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--claim docs/examples/synapse-network/generated/task-claim.json \
	--result-status completed \
	--summary requirements-ready \
	--notes scope-confirmed \
	--add-artifacts 'requirements-summary|report|spec2flow/outputs/execution/frontend-smoke/requirements-summary.json' \
	--output docs/examples/synapse-network/generated/task-result.json
```

`simulate-model-run` is a provider-neutral reference adapter. It consumes a claim payload, produces a simulated adapter response, writes the result back into `execution-state.json`, and emits a combined execution record:

```bash
npm run spec2flow -- simulate-model-run \
	--state docs/examples/synapse-network/generated/execution-state.json \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--claim docs/examples/synapse-network/generated/task-claim.json \
	--adapter-capability docs/examples/synapse-network/model-adapter-capability.json \
	--output docs/examples/synapse-network/generated/simulated-model-run.json
```

`run-workflow-loop` ties the pieces together. It repeatedly claims the next ready task, runs the simulated adapter, and persists each step until the workflow completes or reaches a step cap:

```bash
npm run spec2flow -- run-workflow-loop \
	--state docs/examples/synapse-network/generated/execution-state.json \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--adapter-capability docs/examples/synapse-network/model-adapter-capability.json \
	--max-steps 8 \
	--output-base docs/examples/synapse-network/generated/loop \
	--output docs/examples/synapse-network/generated/workflow-loop-summary.json
```

Execution model:

- A single user development request creates one workflow run identified by `runId`.
- The task graph expands that run into multiple stable `taskId` values, typically one per route-stage node such as `frontend-smoke--requirements-analysis`.
- `execution-state.json` is the persisted runtime ledger for that run. It stores overall workflow status, the current stage, every subtask status, attached artifacts, and structured errors.
- `claim-next-task` is the scheduler boundary between persisted state and a real model adapter. It produces the exact subtask payload that should be sent to Copilot or another provider.
- `submit-task-result` is the write-back boundary from a model adapter or executor into Spec2Flow state.
- `simulate-model-run` is a reference adapter loop for validating controller behavior before binding to a real provider API.
- `run-workflow-loop` is the first end-to-end controller loop for an entire workflow run.
- All later model invocations, validation runs, logs, bug drafts, and review handoffs should attach to `runId + taskId`, not to an implicit chat session.

It can also collect changed files directly from `git diff`:

```bash
npm run spec2flow -- generate-task-graph \
	--project .spec2flow/project.yaml \
	--topology .spec2flow/topology.yaml \
	--risk .spec2flow/policies/risk.yaml \
	--changed-files-from-git \
	--git-diff-repo /path/to/target-repo \
	--git-base origin/main \
	--git-head HEAD
```

If no git refs are provided, Spec2Flow defaults to `git diff --name-only HEAD` in the selected repository. Use `--git-staged` to read only staged changes.

Risk escalation is scoped to routes whose declared target paths are actually touched by the changed files, so a frontend-only diff does not raise unrelated backend or settlement routes.

## Contributing

Contributions are welcome. Early contributions are especially valuable in:
- workflow design
- schema design
- Playwright integration
- GitHub Actions workflows
- GitHub Issues templates
- end-to-end examples

## License

MIT
