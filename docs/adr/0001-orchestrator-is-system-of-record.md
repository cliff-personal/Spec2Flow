# ADR 0001: Spec2Flow Is The System Of Record

- Status: accepted
- Date: 2026-03-24
- Deciders: repository architecture
- Source of truth: `AGENTS.md`, `docs/architecture.md`, `packages/cli/src/runtime/execution-state-service.ts`, `packages/cli/src/runtime/task-result-service.ts`

## Context

Spec2Flow coordinates a multi-stage workflow that includes planning, claiming, task execution, defect handling, and collaboration handoff.

The repository needs one durable source of truth for:

- task graph structure
- execution state
- task status transitions
- artifact references
- retry and resume behavior

If those decisions live in model memory or provider-specific sessions, the workflow becomes opaque and non-resumable.

## Decision

Spec2Flow is the orchestrator and the system of record.

The controller owns workflow structure, task graphs, execution state, artifact registration, and deterministic state transitions. Model sessions may be reused, but they are never the source of truth.

## Consequences

- repository files remain authoritative for architecture, contracts, and operating guidance
- `task-graph.json` defines what should run
- `execution-state.json` defines what is running, what finished, and what failed
- adapters cannot decide workflow truth on behalf of the controller
- retry, resume, and gate logic must persist through runtime state rather than chat history

## Enforcement

- orchestration boundary is stated in `AGENTS.md`
- runtime state transitions are implemented in `packages/cli/src/runtime/`
- task-result routing and promotion are enforced before state is written back to disk