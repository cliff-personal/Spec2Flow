# Docs Index

## Purpose

This file is the shortest stable map for humans and AI agents reading Spec2Flow.

Use it to answer two questions quickly:

1. which document should I read first for this task?
2. which file is the source of truth for this topic?

## Read First

1. [README.md](/Users/cliff/workspace/Spec2Flow/README.md)
2. [AGENTS.md](/Users/cliff/workspace/Spec2Flow/AGENTS.md)
3. [docs/structure.md](/Users/cliff/workspace/Spec2Flow/docs/structure.md)

## By Question

### What is Spec2Flow?

- [README.md](/Users/cliff/workspace/Spec2Flow/README.md)

### What are the repository rules and architecture boundaries?

- [AGENTS.md](/Users/cliff/workspace/Spec2Flow/AGENTS.md)
- [docs/architecture.md](/Users/cliff/workspace/Spec2Flow/docs/architecture.md)

### How should Copilot behave in this repository?

- [.github/copilot-instructions.md](/Users/cliff/workspace/Spec2Flow/.github/copilot-instructions.md)
- [docs/copilot.md](/Users/cliff/workspace/Spec2Flow/docs/copilot.md)
- [docs/Harness_engineering.md](/Users/cliff/workspace/Spec2Flow/docs/Harness_engineering.md)

### Which document applies to the file I am editing?

- [docs instructions](/Users/cliff/workspace/Spec2Flow/.github/instructions/docs.instructions.md)
- [TypeScript CLI instructions](/Users/cliff/workspace/Spec2Flow/.github/instructions/typescript-cli.instructions.md)
- [schema instructions](/Users/cliff/workspace/Spec2Flow/.github/instructions/schemas.instructions.md)

### How does the runtime work?

- [docs/architecture.md](/Users/cliff/workspace/Spec2Flow/docs/architecture.md)
- [packages/cli/src/runtime/](/Users/cliff/workspace/Spec2Flow/packages/cli/src/runtime)
- [packages/cli/src/planning/](/Users/cliff/workspace/Spec2Flow/packages/cli/src/planning)
- [packages/cli/src/adapters/](/Users/cliff/workspace/Spec2Flow/packages/cli/src/adapters)

### How do I adopt or run the workflow?

- [docs/usage-guide.md](/Users/cliff/workspace/Spec2Flow/docs/usage-guide.md)
- [docs/playbooks/index.md](/Users/cliff/workspace/Spec2Flow/docs/playbooks/index.md)
- [docs/collaboration.md](/Users/cliff/workspace/Spec2Flow/docs/collaboration.md)
- [docs/examples/synapse-network/README.md](/Users/cliff/workspace/Spec2Flow/docs/examples/synapse-network/README.md)

### What should an agent do in each workflow stage?

- [docs/playbooks/index.md](/Users/cliff/workspace/Spec2Flow/docs/playbooks/index.md)
- [docs/playbooks/requirements-analysis.md](/Users/cliff/workspace/Spec2Flow/docs/playbooks/requirements-analysis.md)
- [docs/playbooks/code-implementation.md](/Users/cliff/workspace/Spec2Flow/docs/playbooks/code-implementation.md)
- [docs/playbooks/test-design.md](/Users/cliff/workspace/Spec2Flow/docs/playbooks/test-design.md)
- [docs/playbooks/automated-execution.md](/Users/cliff/workspace/Spec2Flow/docs/playbooks/automated-execution.md)
- [docs/playbooks/defect-feedback.md](/Users/cliff/workspace/Spec2Flow/docs/playbooks/defect-feedback.md)
- [docs/playbooks/collaboration.md](/Users/cliff/workspace/Spec2Flow/docs/playbooks/collaboration.md)

### What are the enforceable contracts?

- [schemas/](/Users/cliff/workspace/Spec2Flow/schemas)
- [schemas/task-graph.schema.json](/Users/cliff/workspace/Spec2Flow/schemas/task-graph.schema.json)
- [schemas/execution-state.schema.json](/Users/cliff/workspace/Spec2Flow/schemas/execution-state.schema.json)
- [schemas/model-adapter-capability.schema.json](/Users/cliff/workspace/Spec2Flow/schemas/model-adapter-capability.schema.json)
- [schemas/model-adapter-runtime.schema.json](/Users/cliff/workspace/Spec2Flow/schemas/model-adapter-runtime.schema.json)

## Source Of Truth Map

### Product overview

- primary: [README.md](/Users/cliff/workspace/Spec2Flow/README.md)

### Architecture and boundaries

- primary: [AGENTS.md](/Users/cliff/workspace/Spec2Flow/AGENTS.md)
- supporting: [docs/architecture.md](/Users/cliff/workspace/Spec2Flow/docs/architecture.md)

### Copilot operating policy

- primary: [.github/copilot-instructions.md](/Users/cliff/workspace/Spec2Flow/.github/copilot-instructions.md)
- supporting: [docs/copilot.md](/Users/cliff/workspace/Spec2Flow/docs/copilot.md)

### AI-facing repository optimization

- primary: [docs/Harness_engineering.md](/Users/cliff/workspace/Spec2Flow/docs/Harness_engineering.md)

### Repository layout

- primary: [docs/structure.md](/Users/cliff/workspace/Spec2Flow/docs/structure.md)

### Workflow adoption and commands

- primary: [docs/usage-guide.md](/Users/cliff/workspace/Spec2Flow/docs/usage-guide.md)

### Stage-scoped execution guidance

- primary: [docs/playbooks/index.md](/Users/cliff/workspace/Spec2Flow/docs/playbooks/index.md)
- supporting: [docs/Harness_engineering.md](/Users/cliff/workspace/Spec2Flow/docs/Harness_engineering.md)

### Runtime contracts

- primary: [schemas/](/Users/cliff/workspace/Spec2Flow/schemas)
- supporting: [packages/cli/src/types/](/Users/cliff/workspace/Spec2Flow/packages/cli/src/types)

### Execution behavior

- primary: [packages/cli/src/runtime/](/Users/cliff/workspace/Spec2Flow/packages/cli/src/runtime)
- supporting: [docs/examples/synapse-network/generated/](/Users/cliff/workspace/Spec2Flow/docs/examples/synapse-network/generated)

## Stable Validation Paths

- `npm run build`
- `npm run typecheck`
- `npm run test:unit`
- `npm run validate:synapse-example`
- `npm run generate:synapse-task-graph`
- `npm run generate:synapse-execution-state`
- `npm run preflight:copilot-cli`

## What Not To Treat As Source Of Truth

- `.spec2flow/`
- `spec2flow/outputs/`

These paths contain runtime evidence and local execution artifacts. They are useful for debugging and examples, but they do not define the repository contract.
