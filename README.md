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

## Integration Examples

- [docs/examples/synapse-network/README.md](docs/examples/synapse-network/README.md)
- [docs/examples/synapse-network/project.yaml](docs/examples/synapse-network/project.yaml)
- [docs/examples/synapse-network/topology.yaml](docs/examples/synapse-network/topology.yaml)
- [docs/examples/synapse-network/risk.yaml](docs/examples/synapse-network/risk.yaml)
- [docs/examples/synapse-network/generated/onboarding-validator-result.json](docs/examples/synapse-network/generated/onboarding-validator-result.json)
- [docs/examples/synapse-network/generated/task-graph.json](docs/examples/synapse-network/generated/task-graph.json)
- [docs/examples/synapse-network/generated/task-graph-frontend-change.json](docs/examples/synapse-network/generated/task-graph-frontend-change.json)
- [docs/examples/synapse-network/generated/task-graph-withdrawal-change.json](docs/examples/synapse-network/generated/task-graph-withdrawal-change.json)

## Minimal Runtime

Spec2Flow now includes a minimal CLI runtime for onboarding validation and task graph generation.

- [package.json](package.json)
- [packages/cli/src/spec2flow.mjs](packages/cli/src/spec2flow.mjs)

Example commands:

```bash
npm install
npm run validate:synapse-example
npm run generate:synapse-task-graph
npm run generate:synapse-task-graph:frontend-change
npm run generate:synapse-task-graph:withdrawal-change
```

`generate-task-graph` also supports diff-aware risk matching:

```bash
node packages/cli/src/spec2flow.mjs generate-task-graph \
	--project docs/examples/synapse-network/project.yaml \
	--topology docs/examples/synapse-network/topology.yaml \
	--risk docs/examples/synapse-network/risk.yaml \
	--changed-files-file docs/examples/synapse-network/changes/withdrawal-change.txt
```

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