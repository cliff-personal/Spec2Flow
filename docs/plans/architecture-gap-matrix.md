# Architecture Gap Matrix

- Status: active
- Source of truth: `docs/architecture.md`, `package.json`, `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/runtime/`, `packages/cli/src/adapters/`, `schemas/`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`

## Purpose

Turn the architecture promise into an execution backlog for controlled self-evolution.

This document does not redefine the architecture. It maps the promises in `docs/architecture.md` to the current implementation surface, highlights the real gaps, and orders the next milestones by dependency and leverage.

## Status Legend

- `implemented`: the capability exists in code, is reachable from the CLI surface, and has matching examples or tests
- `partial`: the capability has a real implementation core, but the architecture promise is only partly satisfied
- `gap`: the architecture names the capability, but the repository does not yet implement the needed behavior

## Gap Matrix

| Capability Area | Architecture Promise | Current Evidence | Status | Main Gap |
| --- | --- | --- | --- | --- |
| Orchestration DAG and persisted truth | Spec2Flow owns task graphs, execution state, artifacts, and deterministic state transitions | `generate-task-graph`, `init-execution-state`, `claim-next-task`, `submit-task-result`, `run-workflow-loop`; `packages/cli/src/planning/task-graph-service.ts`; `packages/cli/src/runtime/execution-state-service.ts`; `packages/cli/src/runtime/task-claim-service.ts`; `packages/cli/src/runtime/workflow-loop-service.ts` | `implemented` | None at the controller core level |
| CLI runtime command surface | Architecture and CLI mapping stay explicit and runnable from a small number of commands | `package.json`; `packages/cli/src/cli/dist-command-handlers.ts`; compiled entrypoint at `packages/cli/dist/cli/spec2flow-dist-entrypoint.js` | `implemented` | None for the current local runtime surface |
| Stage-to-specialist mapping | Each workflow stage maps to an explicit executor role and role policy | `packages/cli/src/types/task-graph.ts`; `packages/cli/src/shared/task-role-profile.ts`; `packages/cli/src/planning/task-graph-service.ts`; `schemas/task-graph.schema.json` | `implemented` | None for role naming and stage mapping |
| Adapter boundary and role-policy enforcement | External adapters return normalized task results and may not exceed stage permissions | `packages/cli/src/adapters/adapter-runner.ts`; `packages/cli/src/adapters/adapter-normalizer.ts`; `schemas/adapter-run.schema.json`; `schemas/model-adapter-runtime.schema.json`; `schemas/model-adapter-capability.schema.json` | `implemented` | Multi-provider ecosystem is still narrow, but the boundary itself exists |
| External adapter execution path | One claimed task can run through an external adapter command and write back structured results | `run-task-with-adapter`; `run:synapse-task-with-adapter`; `docs/examples/synapse-network/generated/adapter-run.json` | `implemented` | None for the single-task path |
| Workflow loop execution path | The runtime can repeatedly claim, execute, and persist tasks until completion or stop | `run-workflow-loop`; `packages/cli/src/runtime/workflow-loop-service.ts`; `docs/examples/synapse-network/generated/workflow-loop-summary.json`; `docs/examples/synapse-network/generated/command-workflow-loop-summary.json` | `implemented` | None for the current local orchestration loop |
| Structured handoff artifacts | Each stage writes a structured downstream artifact with a stable contract | Stage deliverable schemas now exist for requirements, implementation, test design, execution, defect, and collaboration; `packages/cli/src/types/stage-deliverables.ts`; `packages/cli/src/runtime/stage-deliverable-validation.ts`; generated examples under `docs/examples/synapse-network/generated/deliverables/` | `implemented` | Secondary artifacts such as `code-diff`, `verification-evidence`, and `bug-draft` are still looser than the primary stage deliverables |
| Artifact contract enforcement | Controller validates whether expected artifacts were produced before unlocking downstream behavior | `packages/cli/src/runtime/task-result-service.ts`; `packages/cli/src/cli/update-execution-state-command.ts`; `packages/cli/src/runtime/stage-deliverable-validation.ts`; `packages/cli/src/adapters/adapter-runner.test.ts` | `implemented` | Primary stage deliverables are schema-backed; secondary artifacts still use generic contract matching |
| Defect loop routing | Failures reroute by failure type instead of always returning to requirements analysis | `packages/cli/src/runtime/task-result-service.ts` now routes requirements-analysis, code-implementation, test-design, and automated-execution failures into `defect-feedback`; `packages/cli/src/runtime/task-result-service.test.ts` covers each route class | `implemented` | Failure classification is controller-backed, but only the current five coarse classes are modeled |
| Review policy and approval gates | Human approval stays in policy and blocks collaboration when required | `reviewPolicy` is generated into task graph and claims; `packages/cli/src/runtime/task-result-service.ts` blocks collaboration completion when a schema-backed handoff is still `awaiting-approval` | `implemented` | Approval is now enforced at the controller, but the repository still lacks a richer approval-record lifecycle |
| Session strategy | Sessions are reusable by declared scope while workflow truth stays outside the model | Session-key template context exists in `packages/cli/src/adapters/adapter-normalizer.ts`; example runtime files use configurable keys | `partial` | Core runtime does not own durable session reuse behavior; provider-specific resume behavior remains thin and mostly example-driven |
| Agent workflow stage outputs | Requirements, implementation, test design, defect analysis, and collaboration each return useful stage-specific deliverables | Schema-backed deliverables now exist for all non-bootstrap stages; `schemas/*.schema.json`; generated examples under `docs/examples/synapse-network/generated/deliverables/`; self-dogfood planning artifacts under `.spec2flow/generated/self-stage-deliverables/` | `implemented` | End-to-end adapter execution does not yet auto-generate every stage deliverable in a real repository loop |
| Deterministic execution layer | Execution stage runs approved commands, starts environments, and collects evidence such as logs, screenshots, traces, and videos | `run-deterministic-task`; `packages/cli/src/runtime/deterministic-execution-service.ts`; `.spec2flow/model-adapter-runtime.deterministic.json`; `.spec2flow/generated/self-stage-deliverables/deterministic-adapter-run.json` | `partial` | Deterministic command execution and log-backed evidence now exist, but Playwright, screenshots, traces, videos, and richer service orchestration are still missing |
| Collaboration layer automation | Collaboration stage prepares PR handoff, issue-ready output, and repeatable review visibility across contributors | Collaboration stage exists in task graph, role profiles, and docs; no corresponding runtime automation module exists | `gap` | No GitHub PR creation, issue publication, review-status posting, artifact linking, or collaboration handoff generation path |
| CI and artifact preservation | Validation and workflow outputs are preserved and exposed in CI | Local commands exist; examples show generated outputs on disk | `gap` | No active GitHub Actions workflow or equivalent CI pipeline in the repository to run the orchestration loop and retain artifacts |
| Skills and MCP integration | Skills and MCP remain optional but attach cleanly to role-aware execution | Boundary is documented in `docs/architecture.md` | `gap` | No role-to-skill wiring, no MCP negotiation layer, and no execution-time capability attachment model |
| Environment preparation and bootstrap execution | Environment-preparation becomes a real deterministic bootstrap stage instead of analysis only | `run-deterministic-task` can execute environment-preparation claims and emit `environment-preparation-report`; `.spec2flow/generated/self-stage-deliverables/deterministic-adapter-run.json`; `.spec2flow/generated/execution/environment-preparation-report.json` | `partial` | The stage now runs declared verification commands and writes a schema-backed report, but broad bootstrap orchestration for startup, dependency install, migrations, or environment convergence does not yet exist |

## Summary View

The current repository is strongest at the controller core:

- task graph generation
- persisted execution state
- stage and role contracts
- adapter normalization and policy enforcement
- loop orchestration for local and simulated runs

The main deficit is not planning. The main deficit is downstream execution and collaboration truth:

- primary stage deliverables are now schema-backed and controller-validated
- deterministic execution now has a first controller-owned slice for command execution and report/log evidence, but it is not yet a full subsystem
- controller rerouting and approval gates now exist, but execution and collaboration side effects are still shallow
- collaboration and CI are still architectural promises rather than implemented subsystems

## Priority Roadmap

## Phase 1: Contract-Hardened Stage Deliverables

Status: completed on 2026-03-24.

Goal:

Make the six-stage workflow real at the artifact level, not only at the task-graph level.

Why first:

- downstream routing, collaboration, and CI all depend on stable deliverable shapes
- without stage-specific schemas, the system can move tasks forward but still lacks product-grade handoff contracts

Scope:

- add schema-backed contracts for:
  - requirement summary
  - implementation summary or change receipt
  - test plan
  - test cases
  - execution report
  - defect draft or repair summary
  - collaboration handoff
- validate those artifacts in the controller before write-back or downstream unlock
- align examples under `docs/examples/**/generated`

Exit signal:

- each non-bootstrap workflow stage has at least one schema, one example, and one controller validation path

Completed in the current repository state:

- added schema-backed contracts for requirement summary, implementation summary, test plan, test cases, execution report, defect summary, and collaboration handoff
- added controller validation in both `submit-task-result` and `update-execution-state` write-back paths
- aligned generated examples under `docs/examples/synapse-network/generated/deliverables/`
- verified the change with `npm run build`, `npm run test:unit`, and `npm run validate:docs`
- ran the self-dogfood planning path and wrote task graph, execution state, and claim outputs under `.spec2flow/generated/self-stage-deliverables/`

## Phase 2: Generalized Defect Routing and Policy Gates

Status: completed on 2026-03-24.

Goal:

Make the workflow resumable and failure-aware across all key stages, not only `automated-execution`.

Why second:

- self-evolution requires the system to recover from its own mistakes in a structured way
- approval policy remains soft until the runtime actually blocks on it

Scope:

- extend `packages/cli/src/runtime/task-result-service.ts` beyond `routeAutomatedExecutionOutcome`
- classify failures into at least:
  - requirement misunderstanding
  - implementation defect
  - missing or weak test coverage
  - execution environment failure
  - release or review readiness issue
- add explicit approval-gate handling for collaboration tasks when `reviewPolicy.requireHumanApproval` is true

Exit signal:

- reroute behavior exists for at least requirements, implementation, test-design, and execution outcomes
- collaboration cannot auto-complete past a required approval gate

Completed in the current repository state:

- extended `packages/cli/src/runtime/task-result-service.ts` so requirements-analysis, code-implementation, and test-design failures skip downstream pre-defect stages and route into `defect-feedback`
- kept automated-execution rerouting, but moved it under the same failure-class model
- added controller-side collaboration approval gating so a `collaboration-handoff` with `awaiting-approval` blocks completion when `reviewPolicy.requireHumanApproval` is true
- added runtime regression coverage for requirement, implementation, test-design, execution, and collaboration gate transitions
- verified the change with `npm run build`, `npm run test:unit`, and `npm run validate:docs`

## Phase 3: Deterministic Execution Subsystem

Status: in progress as of 2026-03-24.

Goal:

Turn execution from metadata into real repository automation with evidence capture.

Why third:

- the architecture promises real command execution and optional Playwright coverage
- until this exists, `execution-agent` is mostly a planning shell rather than a true execution stage

Scope:

- add a first-class execution module under `packages/cli/src/`
- support approved command execution from task metadata
- support environment preparation actions with explicit policy boundaries
- add evidence collection primitives for logs and reports first
- add Playwright integration only after the base command-runner path is stable

Exit signal:

- execution stage can run allowed repository commands and persist a schema-backed execution report with evidence references

Current repository progress:

- added `run-deterministic-task` and `packages/cli/src/runtime/deterministic-execution-service.ts`
- added a self-dogfood deterministic runtime at `.spec2flow/model-adapter-runtime.deterministic.json`
- the self-dogfood `.spec2flow/model-adapter-runtime.json` can now delegate deterministic stages through `stageRuntimeRefs` while keeping Copilot CLI as the default runtime for the rest of the loop
- the current deterministic slice supports `environment-preparation` and `automated-execution`
- deterministic runs now write schema-backed reports plus log evidence for executed verification commands
- task claims now explicitly include `AGENTS.md`, `.github/copilot-instructions.md`, and the configured `.github/instructions/*.md` files when they are part of the project docs set

## Phase 4: Collaboration and CI Productization

Goal:

Make the collaboration layer real instead of representational.

Why fourth:

- once artifacts and execution evidence are stable, the next leverage point is making them reviewable in GitHub-native workflows

Scope:

- implement collaboration handoff generation from task artifacts
- add CI workflow entrypoints that run the orchestration loop on repository changes
- retain artifacts and expose links in the collaboration output
- add issue-ready and PR-ready output surfaces before full write-side automation

Exit signal:

- one CI workflow can run the loop and retain artifacts
- collaboration stage emits a stable handoff artifact that a human reviewer can act on directly

## Phase 5: Provider and Runtime Expansion

Goal:

Expand beyond the current narrow adapter story without polluting the controller.

Why fifth:

- multi-provider support, skills, and MCP are leverage multipliers, but they should sit on top of a stable controller and execution core

Scope:

- improve session reuse and resume semantics
- define a more explicit adapter authoring surface
- add role-aware skill attachment
- add MCP capability negotiation only where external systems are genuinely needed

Exit signal:

- adding a new provider or external capability does not require rewriting controller logic or task graph semantics

## Recommended Execution Order

For self-evolution, the highest-leverage implementation sequence is:

1. stage artifact schemas and validation
2. generalized reroute logic and approval gates
3. deterministic execution runner
4. collaboration handoff and CI artifact loop
5. provider expansion, skills, and MCP

This order keeps the system boring in the right way:

- first make outputs trustworthy
- then make failures recoverable
- then make execution real
- then make collaboration visible
- only then widen the runtime surface

## What Counts As “Architecture Complete”

The architecture should only be treated as substantially realized when all of the following are true:

1. every workflow stage has a schema-backed stage deliverable
2. controller rerouting works by failure class across the loop
3. execution can run deterministic commands and store evidence
4. collaboration can emit stable PR-ready or issue-ready handoffs
5. CI can run the loop and retain artifacts
6. provider-specific session behavior remains an adapter concern rather than controller truth

Until then, the repository should be treated as:

- strong controller core
- credible self-dogfooding harness
- partial end-to-end workflow framework
- not yet a fully realized architecture-complete product