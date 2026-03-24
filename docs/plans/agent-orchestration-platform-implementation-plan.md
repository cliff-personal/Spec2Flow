# Agent Orchestration Platform Implementation Plan

- Status: active
- Source of truth: `docs/agent-orchestration-platform-design.md`, `docs/architecture.md`, `docs/plans/architecture-gap-matrix.md`, `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/runtime/`, `packages/cli/src/adapters/`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`

## Goal

Turn the target design in `docs/agent-orchestration-platform-design.md` into an execution plan that can guide implementation across controller, scheduler, persistence, web control plane, and collaboration publish flows.

This document is the working implementation plan for the platform-shaped version of Spec2Flow.

## Status Legend

- `implemented`: exists in code and is usable from the current runtime surface
- `partial`: important implementation exists, but the platform promise is only partly satisfied
- `gap`: the design names the capability, but the repository does not yet implement it

## Current Capability Matrix

| Capability | Target Outcome | Current Evidence | Status | Unimplemented Marker |
| --- | --- | --- | --- | --- |
| Task intake from one requirement | Accept one task and create one workflow run | `generate-task-graph --requirement`; `packages/cli/src/planning/task-graph-service.ts` | `partial` | No durable run intake API, no shared run store, no web submission surface |
| DAG decomposition into six-stage subtasks | One request expands into stage-aware tasks | `packages/cli/src/planning/task-graph-service.ts` | `implemented` | None for the local controller path |
| Persisted workflow truth outside model memory | Controller remains the system of record | `execution-state.json`; `packages/cli/src/runtime/execution-state-service.ts` | `implemented` | Shared PostgreSQL truth is still missing |
| Shared multi-run persistence | Multiple runs and tasks persist durably for many workers | `migrate-platform-db`; `init-platform-run`; `lease-next-platform-task`; `get-platform-run-state`; `packages/cli/src/platform/` | `partial` | PostgreSQL schema, repository layer, lease state, and snapshot queries now exist, but DB-backed worker execution and richer query APIs are still incomplete |
| Scheduler with task leasing | Ready tasks can be leased safely to concurrent workers | `lease-next-platform-task`; `heartbeat-platform-task`; `start-platform-task`; `expire-platform-leases`; `packages/cli/src/platform/platform-scheduler-service.ts` | `partial` | Lease ownership, heartbeat, and timeout recovery now exist, but there is still no worker registry or dead-letter queue service |
| Stage-specialized workers | Requirements, implementation, test, execution, defect, and collaboration run as role-scoped workers | `run-platform-worker-task`; `run-platform-requirements-worker`; `run-platform-implementation-worker`; `run-platform-test-design-worker`; `run-platform-execution-worker`; `run-platform-defect-worker`; `run-platform-collaboration-worker` | `partial` | DB-backed worker harness, execution-time heartbeat auto-renew, and stage entrypoints now exist, but there is still no long-running worker service or worker registry |
| Automatic defect repair loop | Failed work reroutes and retries under policy control | `packages/cli/src/runtime/task-result-service.ts`; `packages/cli/src/platform/platform-auto-repair-service.ts`; `packages/cli/src/platform/migrations/0003_platform_auto_repair.sql` | `partial` | Auto-repair policy fields, controller reroute, repair-attempt records, and retry-budget persistence now exist, but downstream rerun invalidation is still local-controller scoped and there is no dedicated orchestration daemon yet |
| Deterministic execution and evidence | Approved commands run and produce evidence | `packages/cli/src/runtime/deterministic-execution-service.ts` | `partial` | No service orchestration, no browser automation evidence pipeline, no richer environment convergence |
| Collaboration publish flow | Commit code, create branch, optionally draft PR | Collaboration stage exists in graph only | `gap` | No git publication module, no commit policy engine, no PR integration |
| Approval gates and risk policy | High-risk tasks block for review | `reviewPolicy`; `packages/cli/src/runtime/task-result-service.ts` | `implemented` | Approval records and operator actions are still shallow |
| Event stream and observability | Operators can see progress, retries, and artifacts live | Workflow summaries and JSON artifacts exist on disk | `gap` | No event model, no event store, no streaming API, no telemetry surface |
| Web control plane | Submit tasks, inspect DAG, monitor progress, approve or retry | None | `gap` | No backend API, no frontend app, no run/task detail UI |
| Artifact metadata and storage model | Artifacts are queryable and attached to runs/tasks | Artifact refs exist in `execution-state.json` | `partial` | No shared artifact catalog, no object-store abstraction, no database indexing |
| Multi-user operations | Many repos, many runs, many operators | None | `gap` | No authentication layer, repository registry, tenancy model, or permissions surface |
| CLI compatibility | Existing local workflow remains usable during migration | Current CLI runtime works today | `implemented` | Must preserve during platform rollout |

## Planning Principles

- keep the controller boundary intact
- promote file-backed truth into PostgreSQL-backed truth without breaking the local CLI
- build shared persistence before building the web UI
- build the scheduler before scaling worker specialization
- keep collaboration publish actions policy-gated
- do not treat provider sessions as workflow truth

## Delivery Strategy

The cleanest path is a progressive upgrade:

1. keep the current CLI as the local-dev and fixture-generation surface
2. add platform persistence behind new service modules
3. add a real scheduler with leases and retries
4. add worker runtimes that consume leased tasks
5. add collaboration publish automation
6. add the web control plane
7. harden auto-repair and operational observability

## Phase 1: PostgreSQL Runtime Truth

Status: `partial`

Goal:

Replace single-machine JSON-only runtime truth with shared PostgreSQL-backed runtime truth while preserving JSON export artifacts for local debugging and examples.

Scope:

- add a persistence package or module for PostgreSQL access
- define migrations for:
  - `repositories`
  - `runs`
  - `tasks`
  - `task_attempts`
  - `artifacts`
  - `events`
  - `review_gates`
  - `publications`
- create repository methods for:
  - create run
  - create task graph records
  - query ready tasks
  - append events
  - attach artifacts
  - update run and task status
- keep `task-graph.json` and `execution-state.json` as optional export/debug artifacts

Exit signal:

- one workflow run can be created, loaded, and updated entirely from PostgreSQL
- current local JSON outputs can be generated from the database-backed state when needed

Unimplemented markers:

- `implemented`: migrations
- `implemented`: repository layer for `runs/tasks/events/artifacts`
- `gap`: DB-backed execution-state equivalent
- `gap`: config for PostgreSQL connection

## Phase 2: Scheduler And Lease Model

Status: `partial`

Goal:

Upgrade the current loop prototype into a shared scheduler that can safely coordinate many workers.

Scope:

- add scheduler service that:
  - selects ready tasks
  - acquires leases
  - records worker ownership
  - supports lease renewal and expiry
  - retries timed-out work
  - writes event records
- add worker identity and heartbeat semantics
- add statuses such as:
  - `leased`
  - `retryable-failed`
  - `cancelled`
- keep the current `run-workflow-loop` command as a local harness or compatibility shell

Exit signal:

- two concurrent workers cannot claim the same task
- stale leases expire and can be safely recovered
- scheduler transitions are fully test-covered

Unimplemented markers:

- `implemented`: task lease persistence in PostgreSQL
- `implemented`: heartbeat protocol
- `implemented`: timeout recovery and retryable requeue
- `gap`: worker registry
- `gap`: dead-letter queue or terminal failure service beyond `blocked`

## Phase 3: Worker Runtime Extraction

Status: `partial`

Goal:

Turn stage execution into explicit worker runtimes instead of one monolithic local loop.

Scope:

- define worker contract for one leased task
- add stage worker entrypoints for:
  - requirements
  - implementation
  - test design
  - execution
  - defect
  - collaboration
- adapt current claim payload format for DB-backed runs
- preserve adapter isolation and role policy checks

Exit signal:

- one scheduler can dispatch different stage tasks to different worker processes
- workers write results back through the same controller contract

Unimplemented markers:

- `implemented`: worker contract for one leased task
- `implemented`: DB-backed task claim adaptation into the existing controller contract
- `implemented`: stage worker CLI entrypoints for requirements, implementation, test design, execution, defect, and collaboration
- `implemented`: execution-time heartbeat loop, lease auto-renew, and worker stop rules for the CLI harness
- `gap`: long-running worker process model
- `gap`: worker registration and startup commands
- `partial`: stage-specific runtime wiring still relies on the CLI harness and materialized local state files

## Phase 4: Auto-Repair Policy Engine

Status: `partial`

Goal:

Make automatic bug-fix loops explicit, bounded, and auditable.

Scope:

- extend risk policy and runtime policy with:
  - `maxAutoRepairAttempts`
  - `maxExecutionRetries`
  - `allowAutoCommit`
  - `blockedRiskLevels`
- add repair-attempt records tied to `run_id + task_id`
- route repairable failures back to the owning stage
- rerun downstream dependencies after successful repair
- stop and escalate when retry budgets are exhausted

Exit signal:

- failed execution can automatically trigger repair when policy allows
- repair loops terminate deterministically under configured budgets

Unimplemented markers:

- `implemented`: retry budget persistence for execution retries and auto-repair attempts
- `implemented`: repair-attempt state machine persistence in PostgreSQL
- `implemented`: policy extension in schemas and config files
- `gap`: downstream rerun invalidation model
- `partial`: controller auto-repair routing exists in the file-backed runtime and DB-backed persistence, but there is not yet a standalone policy orchestration service

## Phase 5: Collaboration Publish Automation

Status: `gap`

Goal:

Make the collaboration stage capable of publishing branch, commit, and PR-ready outcomes under policy control.

Scope:

- add collaboration handoff generator service
- add git publication module for:
  - branch creation
  - deterministic commit creation
  - commit metadata recording
- add optional PR draft integration
- connect publish actions to risk and approval policy

Exit signal:

- low-risk flows can auto-commit
- medium-risk flows can publish PR-ready output
- high-risk flows block on approval before publish

Unimplemented markers:

- `gap`: git publish service
- `gap`: branch and commit tracking table
- `gap`: PR integration
- `gap`: collaboration handoff generator

## Phase 6: Event Model And Observability

Status: `gap`

Goal:

Create the operational truth needed for a real control plane.

Scope:

- define event taxonomy:
  - run created
  - planning completed
  - task leased
  - task started
  - task heartbeat
  - artifact attached
  - task failed
  - repair triggered
  - approval requested
  - publication completed
- persist events in PostgreSQL
- expose event query and streaming APIs
- add metrics for:
  - run duration
  - retry count
  - failure class frequency
  - artifact generation health

Exit signal:

- a run can be reconstructed from event history plus task state
- UI and operators can inspect progress in near real time

Unimplemented markers:

- `gap`: event schema
- `gap`: event append/query service
- `gap`: streaming transport
- `gap`: metrics export

## Phase 7: Web Control Plane

Status: `gap`

Goal:

Give operators a visual control surface for run submission, monitoring, and approval.

Scope:

- backend API:
  - `POST /api/runs`
  - `GET /api/runs`
  - `GET /api/runs/:runId`
  - `GET /api/runs/:runId/tasks`
  - `POST /api/runs/:runId/actions/pause`
  - `POST /api/runs/:runId/actions/resume`
  - `POST /api/tasks/:taskId/actions/retry`
  - `POST /api/tasks/:taskId/actions/approve`
  - `POST /api/tasks/:taskId/actions/reject`
- frontend:
  - run submission page
  - run list
  - run detail with DAG graph
  - task detail log and artifact view
  - approval and retry controls

Exit signal:

- a user can submit a task from the web UI
- a user can see current stage, subtask states, artifacts, and approvals

Unimplemented markers:

- `gap`: backend service
- `gap`: frontend app
- `gap`: DAG visualization
- `gap`: approval action UI

## Phase 8: Execution And Artifact Hardening

Status: `partial`

Goal:

Expand the deterministic execution slice into a richer execution subsystem.

Current implemented core:

- deterministic command execution exists
- environment-preparation exists
- log-backed evidence exists

Scope:

- add service startup orchestration
- add browser automation integration
- add screenshot, trace, and video evidence
- add environment convergence and teardown policies
- add richer artifact indexing

Exit signal:

- execution tasks can run repository commands and browser checks with evidence attached to the run

Unimplemented markers:

- `gap`: service orchestration
- `gap`: Playwright-backed execution pipeline
- `gap`: structured screenshot/trace/video capture
- `gap`: artifact store abstraction

## Phase 9: Multi-Repo And Operator Model

Status: `gap`

Goal:

Make the platform usable beyond one local repository and one operator.

Scope:

- add repository registry and runtime bindings
- add operator identity model
- add permission boundaries for approval and publication actions
- add per-repository risk and workflow configuration resolution

Exit signal:

- one control plane can manage many repositories and operators safely

Unimplemented markers:

- `gap`: repository registry
- `gap`: authn/authz model
- `gap`: operator audit trail

## Cross-Cutting Schema Work

Status: `gap`

Required schema additions:

- PostgreSQL-backed persistence entities
- scheduler lease state
- run event payloads
- repair policy fields
- publication records
- review gate records

Exit signal:

- new services and UI can rely on stable contracts instead of ad-hoc payloads

## Recommended Execution Order

1. Phase 1: PostgreSQL runtime truth
2. Phase 2: scheduler and lease model
3. Phase 6: event model and observability
4. Phase 3: worker runtime extraction
5. Phase 4: auto-repair policy engine
6. Phase 5: collaboration publish automation
7. Phase 8: execution and artifact hardening
8. Phase 7: web control plane
9. Phase 9: multi-repo and operator model

Why this order:

- database truth comes before UI
- scheduler safety comes before worker scale
- observability comes before autonomous repair
- collaboration publish comes after policy and state are trustworthy

## Near-Term Backlog

The first concrete implementation batch should focus on the lowest-level missing infra:

1. add PostgreSQL connection and migration scaffolding
2. define `runs`, `tasks`, `events`, and `artifacts` tables
3. add a DB-backed run creation path
4. add a DB-backed ready-task query and lease operation
5. write unit tests for lease correctness and state transitions

These are the highest-leverage cuts.
Without them, Web UI work is just cosmetic theater.

## Completion Definition

This plan should only be considered complete when all of the following are true:

1. one task can be submitted through CLI or Web and stored as a run in PostgreSQL
2. the planner creates a durable DAG of stage-scoped tasks
3. the scheduler leases ready work to workers safely
4. workers can complete, fail, or repair tasks under policy control
5. collaboration can publish code outcomes under governance
6. the Web control plane shows live progress and operator actions
7. local CLI mode still works as a simpler harness for development and fixtures
