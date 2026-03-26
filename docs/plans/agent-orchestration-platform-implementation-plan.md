# Agent Orchestration Platform Implementation Plan

- Status: active
- Source of truth: `docs/agent-orchestration-platform-design.md`, `docs/architecture.md`, `docs/plans/architecture-gap-matrix.md`, `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/platform/platform-scheduler-service.ts`, `packages/cli/src/platform/platform-worker-service.ts`, `packages/cli/src/platform/platform-control-plane-server.ts`, `packages/cli/src/runtime/task-result-service.ts`, `packages/cli/src/runtime/auto-repair-policy-service.ts`, `packages/cli/src/runtime/collaboration-publication-service.ts`, `packages/cli/src/adapters/adapter-runner.ts`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`
- Last verified: 2026-03-26

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
| Task intake from one requirement | Accept one task and create one workflow run | `generate-task-graph --requirement`; `POST /api/runs`; `POST /api/projects`; `register-platform-project`; `packages/cli/src/planning/task-graph-service.ts`; `packages/cli/src/platform/platform-control-plane-run-submission-service.ts`; `packages/cli/src/platform/platform-project-service.ts` | `partial` | Project registration command and API, project/workspace metadata persistence, and run worktree provisioning now exist, but there is still no standalone project registry UI or long-running intake daemon |
| Requirement to multi-task planning | One feature request decomposes into explicit independent task plans before DAG expansion | `packages/cli/src/planning/task-graph-service.ts`; `schemas/task-graph.schema.json`; `packages/cli/src/types/task-graph.ts` | `partial` | `taskPlans` now exist as a first-class planning artifact and infer conservative dependency order from service topology, but richer requirement slicing, dependency confidence scoring, and dynamic replanning are still missing |
| DAG decomposition into six-stage subtasks | One request expands into stage-aware tasks from task plans | `packages/cli/src/planning/task-graph-service.ts` | `implemented` | The six-stage expander exists and now gates dependent plans behind upstream collaboration completion, but it still depends on route-scoped task ids and does not yet support plan-level stage-aligned parallelism |
| Persisted workflow truth outside model memory | Controller remains the system of record | `execution-state.json`; `packages/cli/src/runtime/execution-state-service.ts` | `implemented` | Shared PostgreSQL truth is still missing |
| Shared multi-run persistence | Multiple runs and tasks persist durably for many workers | `migrate-platform-db`; `init-platform-run`; `lease-next-platform-task`; `get-platform-run-state`; `register-platform-project`; `packages/cli/src/platform/` | `partial` | PostgreSQL schema, repository layer, lease state, snapshot queries, explicit `project/workspace` read models, `projects`, and `run_workspaces` now exist, but DB-backed worker execution and richer query APIs are still incomplete |
| Scheduler with task leasing | Ready tasks can be leased safely to concurrent workers | `lease-next-platform-task`; `heartbeat-platform-task`; `start-platform-task`; `expire-platform-leases`; `packages/cli/src/platform/platform-scheduler-service.ts` | `partial` | Lease ownership, heartbeat, and timeout recovery now exist, but there is still no worker registry or dead-letter queue service |
| Stage-specialized workers | Requirements, implementation, test, execution, defect, and collaboration run as role-scoped workers | `run-platform-worker-task`; `run-platform-requirements-worker`; `run-platform-implementation-worker`; `run-platform-test-design-worker`; `run-platform-execution-worker`; `run-platform-defect-worker`; `run-platform-collaboration-worker` | `partial` | DB-backed worker harness, execution-time heartbeat auto-renew, and stage entrypoints now exist, but there is still no long-running worker service or worker registry |
| Automatic defect repair loop | Failed work reroutes and retries under policy control | `packages/cli/src/runtime/auto-repair-policy-service.ts`; `packages/cli/src/runtime/task-result-service.ts`; `packages/cli/src/platform/platform-auto-repair-service.ts`; `packages/cli/src/platform/migrations/0003_platform_auto_repair.sql` | `partial` | Auto-repair policy fields, downstream rerun invalidation, repair escalation, repair-attempt records, and retry-budget persistence now exist, but there is still no background orchestration daemon or operator-facing repair console |
| Evaluator layer | Completion decisions come from dedicated evaluators instead of implementation workers | None | `gap` | No evaluator-owned acceptance model, no completion scorer, and no plan-level acceptance budget |
| Project adapter profile | AI runtime capability is part of project registration and scheduling truth | `register-platform-project`; `POST /api/projects`; `packages/cli/src/platform/platform-project-service.ts`; `packages/cli/src/platform/platform-auto-runner-service.ts` | `gap` | Adapter runtime is still discovered from `.spec2flow/model-adapter-runtime.json` instead of a first-class project profile with scheduler-visible capabilities |
| Deterministic execution and evidence | Approved commands run and produce evidence | `packages/cli/src/runtime/deterministic-execution-service.ts`; `packages/cli/src/runtime/service-orchestration-service.ts`; `packages/cli/src/runtime/browser-automation-service.ts`; `packages/cli/src/runtime/execution-evidence-index-service.ts`; `packages/cli/src/runtime/execution-lifecycle-service.ts`; `packages/cli/src/runtime/execution-artifact-store-service.ts` | `partial` | Service orchestration, browser checks, execution lifecycle timeout, managed-service teardown, generic HTTP object-store uploads, and execution artifact-store indexing now exist, but full Playwright capture availability and non-HTTP provider implementations are still missing |
| Collaboration publish flow | Commit code, create branch, optionally draft PR | `packages/cli/src/runtime/collaboration-publication-service.ts`; `packages/cli/src/platform/platform-publication-service.ts`; `publications` table | `partial` | Controller-side branch creation, scoped auto-commit, publication records, and PR-draft artifacts now exist, but there is still no remote push, PR API integration, or operator approval UI |
| Approval gates and risk policy | High-risk tasks block for review | `reviewPolicy`; `packages/cli/src/runtime/task-result-service.ts` | `implemented` | Approval records and operator actions are still shallow |
| Event stream and observability | Operators can see progress, retries, and artifacts live | `get-platform-observability`; `packages/cli/src/platform/platform-event-taxonomy.ts`; `packages/cli/src/platform/platform-observability-service.ts` | `partial` | Durable events and observability read models now exist, but there is still no streaming transport or external telemetry export |
| Web control plane | Submit tasks, inspect DAG, monitor progress, approve or retry | `serve-platform-control-plane`; `GET /api/projects`; `POST /api/projects`; `packages/cli/src/platform/platform-control-plane-server.ts`; `packages/cli/src/platform/platform-control-plane-service.ts`; `packages/cli/src/platform/platform-control-plane-action-service.ts`; `packages/cli/src/platform/platform-control-plane-run-submission-service.ts`; `packages/cli/src/platform/platform-project-service.ts`; `packages/web/` | `partial` | Backend project registration, run submission, explicit run/project/workspace read APIs, task retry or approval actions, and run-level pause or resume now exist, but richer task detail, artifact views, and production-grade DAG rendering are still missing |
| Artifact metadata and storage model | Artifacts are queryable and attached to runs/tasks | `execution-artifact-catalog`; `GET /api/runs/:runId/tasks/:taskId/artifact-catalog`; `packages/cli/src/runtime/execution-artifact-store-service.ts`; `packages/cli/src/platform/platform-control-plane-service.ts` | `partial` | Task-scoped artifact catalogs, upload lifecycle state, and control-plane retrieval now exist, but there is still no database-native artifact index or multi-provider upload backend beyond generic HTTP |
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
2. add requirement-to-multi-task planning ahead of the current route-scoped DAG expander
3. add evaluator-owned acceptance so completion is controller truth instead of worker self-assertion
4. add project adapter profiles so scheduling sees runtime capability before runs start
5. add platform persistence behind new service modules
6. add a real scheduler with leases and retries
7. add worker runtimes that consume leased tasks
8. add collaboration publish automation
9. add the web control plane
10. harden auto-repair and operational observability

## Near-Term Priorities

These are the next leverage points for turning Spec2Flow into a true unattended control plane:

1. `Requirement to Multi-Task Planner`
  - turn one feature request into explicit `taskPlans`
  - map task plans into the six-stage DAG
  - keep route expansion as an implementation detail, not the planning headline
2. `Evaluator Layer`
  - introduce evaluator-owned completion signals
  - move acceptance and “done” semantics out of implementation workers
3. `Project Adapter Profile`
  - register adapter/runtime capability with the project
  - make scheduler and planner aware of AI runtime availability before an AI stage is leased

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
- `implemented`: downstream rerun invalidation model through `packages/cli/src/runtime/auto-repair-policy-service.ts`
- `implemented`: repair escalation service notes and PostgreSQL event persistence
- `partial`: standalone runtime and persistence services now exist, but there is not yet a background policy orchestration daemon or operator UI

## Phase 5: Collaboration Publish Automation

Status: `partial`

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

- `implemented`: git publish service with branch creation and deterministic scoped commits
- `implemented`: publication persistence through the existing `publications` table
- `implemented`: controller-generated PR draft artifacts and publication records
- `partial`: collaboration handoff still originates from the existing collaboration artifact path rather than a separate publish planner
- `gap`: remote push and PR API integration
- `gap`: operator approval and publish controls in a web or API surface

## Phase 6: Event Model And Observability

Status: `partial`

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

Implemented in the current repository state:

- PostgreSQL-backed platform events are now written for run initialization, task leasing and retries, worker task state changes, artifact attachment, repair reconciliation, and publication reconciliation
- `get-platform-observability` now builds a control-plane read model with event taxonomy descriptors, per-type event counts, task summaries, repair summaries, publication summaries, approval items, and attention-required signals
- publication reconciliation now distinguishes prepared, approval-required, blocked, and published states in the event taxonomy instead of collapsing every non-published state into one event

Remaining gaps:

- `partial`: event schema and append/query service exist for CLI and internal platform services, and the first operator-facing HTTP surface now exists through `serve-platform-control-plane`, but there is still no streaming or externally consumable event API
- `gap`: streaming transport
- `partial`: metrics exist in the observability read model, but there is no separate metrics export or alerting integration yet

## Phase 7: Web Control Plane

Status: `partial`

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

Implemented in the current repository state:

- `serve-platform-control-plane` now starts a zero-dependency HTTP backend on top of the PostgreSQL platform runtime
- the current backend slice exposes `GET /healthz`, `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:runId`, `GET /api/runs/:runId/tasks`, and `GET /api/runs/:runId/observability`
- the backend returns the same DB-backed run snapshot and observability read model already used by the CLI, so the web control plane can reuse controller truth instead of inventing a second projection
- `POST /api/runs` now validates onboarding inputs, builds a task graph, and persists the resulting platform run through the same planner and PostgreSQL initialization services used by the CLI
- `POST /api/runs` now also provisions project-scoped run workspaces, writes a run-local task-graph artifact into the worktree, and persists `projects` plus `run_workspaces`
- `POST /api/tasks/:taskId/actions/retry`, `POST /api/tasks/:taskId/actions/approve`, and `POST /api/tasks/:taskId/actions/reject` now execute real PostgreSQL-backed operator actions instead of returning placeholders
- `POST /api/runs/:runId/actions/pause` and `POST /api/runs/:runId/actions/resume` now execute real metadata-backed run actions, and the scheduler skips paused runs when leasing work
- `packages/web` now contains the first React-based operator shell for run submission, run list, run detail, observability panels, task action controls, and a DAG preview scaffold

Remaining gaps:

- `partial`: backend service exists for health, run submission, run list, run detail, task list, observability, task retry, approval actions, and run-level pause or resume, but the frontend still does not expose those run actions
- `partial`: frontend app exists as a thin operator shell in `packages/web`, but it still needs route-level task detail, artifact views, and production hardening
- `partial`: DAG visualization exists as a frontend scaffold, but layout refinement and richer task metadata are still missing
- `partial`: approval action UI exists in the frontend shell, but it still needs disabled-state rules, audit detail, and richer operator messaging

Frontend start gate:

- frontend work can start now for run submission, run list, run detail shell, observability panels, and task-level retry or approval controls because the minimum backend surface already exists
- frontend work should keep pause or resume wiring thin until the UI has route-level task detail and artifact context
- a first frontend slice should stay thin and backend-driven, with no client-side workflow truth beyond request state and cached API responses
- before building the first UI, choose one frontend stack and lock one operator-oriented information architecture so Phase 7 does not fragment into backend drift plus throwaway screens

## Phase 8: Execution And Artifact Hardening

Status: `partial`

Goal:

Expand the deterministic execution slice into a richer execution subsystem.

Current implemented core:

- deterministic command execution exists
- environment-preparation exists
- log-backed evidence exists
- service orchestration exists for topology-driven entry services
- browser checks now capture structured HTML or metadata evidence, with optional Playwright capture when available
- execution evidence indexing now catalogs service, command, and browser artifacts
- execution lifecycle policy now enforces timeout and managed-service teardown
- execution artifact storage now flows through a dedicated store abstraction before indexing
- remote-catalog mode now supports generic HTTP upload lifecycles and task-scoped artifact catalog retrieval through the control plane

Scope:

- harden service startup orchestration and teardown
- harden browser automation integration
- keep screenshot, trace, and video evidence optional behind Playwright availability
- harden environment convergence and teardown policies
- harden richer artifact indexing and artifact-store abstraction

Exit signal:

- execution tasks can run repository commands and browser checks with evidence attached to the run

Unimplemented markers:

- `implemented`: service orchestration, managed-service teardown, and long-running lifecycle timeout now exist
- `partial`: browser automation exists, but full Playwright-backed screenshot, trace, and video capture depends on repository runtime availability
- `implemented`: structured execution evidence indexing now exists for service, command, and browser artifacts
- `partial`: artifact-store abstraction now supports generic HTTP uploads plus task-scoped catalog retrieval, but vendor-native S3, GCS, and Azure Blob providers are still missing

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
