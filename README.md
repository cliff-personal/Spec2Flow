# Spec2Flow

**Spec2Flow** is an open-source AI workflow framework for turning product specs and source code into implementation work, test design, automated execution, defect feedback, and team collaboration.

## Why Spec2Flow?

Modern development is no longer just about writing code. Teams need a repeatable workflow that can:

需求分析
代码实现
测试设计
自动执行
缺陷反馈
协作流程

- understand product and design documents
- read and reason about an existing codebase
- translate requirements into implementation tasks
- generate test plans and test cases
- start services and validate real flows
- run browser automation against actual UI
- collect evidence and draft bug reports
- connect execution results back into collaboration workflows

Spec2Flow aims to provide a practical foundation for that loop.

## Vision

Spec2Flow connects product specs, source code, and automated execution into one continuous loop:

**Requirements → Implement → Design Tests → Execute → Report → Collaborate**

It is designed to start simple and grow into a modular AI-driven development and testing workflow framework.

## Project Goals

Spec2Flow is organized around six product goals:

1. Requirements analysis
2. Code implementation
3. Test design
4. Automated execution
5. Defect feedback
6. Collaboration workflow

## Core Workflow

### 1. Requirements Analysis
Use Copilot to read product requirement documents, technical design docs, and repository context.

Outputs:
- scoped requirement summary
- assumptions and open questions
- implementation checklist
- impacted modules list

### 2. Code Implementation
Use Copilot to turn approved requirements into implementation tasks, code changes, and reviewable pull requests.

Outputs:
- task breakdown
- implementation notes
- code changes
- pull request summary

### 3. Test Design
Use Copilot to generate:
- test scope
- risk areas
- smoke checklist
- regression checklist
- edge and error scenarios
- structured test cases

### 4. Automated Execution
Use Playwright to:
- start the target app or test environment
- execute smoke and focused regression flows
- capture screenshots, traces, logs, and videos when needed
- summarize run results in a machine-readable format

### 5. Defect Feedback
Use execution results to draft evidence-backed bug reports that can be reviewed and published to GitHub Issues.

Typical bug draft fields:
- title
- environment
- reproduction steps
- expected result
- actual result
- evidence references
- severity suggestion

### 6. Collaboration Workflow
Use GitHub Actions and GitHub Issues to make the workflow repeatable and visible across the team.

The default collaboration loop is:
- track requirements and defects in GitHub Issues
- implement changes with Copilot-assisted development
- validate critical flows with Playwright locally and in CI
- upload artifacts through GitHub Actions
- review and close the loop through pull requests and issue updates

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

The first version focuses on a practical and lightweight workflow for solo developers and small teams:

1. Read product and design documents
2. Read repository code and project structure
3. Turn requirements into implementation tasks
4. Generate test plans and structured test cases
5. Start local services or test environments
6. Run browser-based automated tests with evidence capture
7. Draft defect reports for failed cases
8. Feed results into a collaboration workflow

## Tooling Direction

The first milestone is explicitly built around:

- **Copilot** for requirement analysis, implementation support, and test design
- **Playwright** for browser automation and evidence capture
- **GitHub Actions** for repeatable CI execution and artifact upload
- **GitHub Issues** for defect tracking and workflow coordination

## Suggested Architecture

Spec2Flow follows a workflow-centered layered design:

### Copilot Workflow Layer
Responsible for:
- understanding specs
- understanding code
- generating implementation tasks
- generating plans and test cases
- interpreting failures
- drafting bugs

### Execution Layer
Responsible for:
- starting services
- running Playwright tests
- collecting artifacts
- producing structured execution results

### Collaboration Layer
Responsible for:
- publishing CI results
- retaining artifacts
- routing failures into GitHub Issues
- supporting pull request validation and team visibility

## Principles

- **Practical first** - ship useful workflows before building a complex platform
- **Execution over demos** - reliable automation matters more than flashy agent behavior
- **Reviewable by default** - code, test output, and bug drafts should stay human-reviewable
- **Modular by default** - agent, execution, and reporting should evolve independently
- **Open-source friendly** - clear docs, simple structure, contributor-ready

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
- a minimal Playwright execution baseline
- a GitHub Actions workflow for repeatable validation
- a GitHub Issues-based defect feedback loop

## Key Docs

- [docs/mvp.md](docs/mvp.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/roadmap.md](docs/roadmap.md)
- [docs/structure.md](docs/structure.md)
- [docs/collaboration.md](docs/collaboration.md)
- [docs/implementation-plan.md](docs/implementation-plan.md)
- [docs/full-implementation-plan.md](docs/full-implementation-plan.md)
- [docs/usage-guide.md](docs/usage-guide.md)
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
- [packages/cli/src/spec2flow.mjs](packages/cli/src/spec2flow.mjs)

Example commands:

```bash
npm install
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
npm run generate:synapse-task-graph:frontend-change
npm run generate:synapse-task-graph:withdrawal-change
```

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
node packages/cli/src/spec2flow.mjs generate-task-graph \
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
node packages/cli/src/spec2flow.mjs init-execution-state \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--run-id synapse-example-run \
	--adapter spec2flow-cli \
	--model gpt-5.4 \
	--session-id example-session \
	--output docs/examples/synapse-network/generated/execution-state.json
```

`update-execution-state` advances one subtask, appends notes or artifacts, and automatically promotes newly unblocked tasks to `ready`:

```bash
node packages/cli/src/spec2flow.mjs update-execution-state \
	--state docs/examples/synapse-network/generated/execution-state.json \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--task-id environment-preparation \
	--task-status completed \
	--notes bootstrap-ok
```

`claim-next-task` acts as the first controller primitive. It selects the next `ready` subtask, marks it `in-progress`, and emits the payload that a model adapter should consume:

```bash
node packages/cli/src/spec2flow.mjs claim-next-task \
	--state docs/examples/synapse-network/generated/execution-state.json \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--adapter-capability docs/examples/synapse-network/model-adapter-capability.json \
	--output docs/examples/synapse-network/generated/task-claim.json
```

`submit-task-result` closes the loop for one claimed subtask. It writes the outcome back into `execution-state.json`, appends artifacts or errors, and promotes any newly unblocked downstream subtasks:

```bash
node packages/cli/src/spec2flow.mjs submit-task-result \
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
node packages/cli/src/spec2flow.mjs simulate-model-run \
	--state docs/examples/synapse-network/generated/execution-state.json \
	--task-graph docs/examples/synapse-network/generated/task-graph.json \
	--claim docs/examples/synapse-network/generated/task-claim.json \
	--adapter-capability docs/examples/synapse-network/model-adapter-capability.json \
	--output docs/examples/synapse-network/generated/simulated-model-run.json
```

`run-workflow-loop` ties the pieces together. It repeatedly claims the next ready task, runs the simulated adapter, and persists each step until the workflow completes or reaches a step cap:

```bash
node packages/cli/src/spec2flow.mjs run-workflow-loop \
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
node packages/cli/src/spec2flow.mjs generate-task-graph \
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