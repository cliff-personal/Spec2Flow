# Web Control Plane Frontend Implementation

- Status: active
- Source of truth: `docs/agent-orchestration-platform-design.md`, `docs/plans/agent-orchestration-platform-implementation-plan.md`, `packages/web/`, `packages/cli/src/platform/platform-control-plane-server.ts`
- Verified with: `npm run build`, `npm run web:build`, `npm run validate:docs`

## Goal

Define the first frontend slice for the Spec2Flow web control plane without inventing client-side workflow truth.

This document exists to answer one practical question:

How should `packages/web` evolve from a thin shell into a usable operator console while staying aligned with the backend control-plane contract?

## Current Decision

The repository now includes a frontend shell at `packages/web`.

The chosen baseline stack is:

- Vite
- React
- TypeScript
- React Router for page-level routing
- TanStack Query for server-state reads and mutations
- React Flow for DAG rendering

This stack is deliberately small.
The control plane is an operator console, not a marketing site and not an SSR application.

## Frontend Boundary

The frontend must not become a second orchestrator.

The browser owns:

- form state
- API request state
- optimistic loading and error feedback
- visual grouping of runs, tasks, observability, and actions

The browser does not own:

- workflow state transitions
- planner decisions
- retry policy
- approval truth
- run or task lifecycle semantics

Those remain in the PostgreSQL-backed control-plane services.

## Current Scope In Code

`packages/web` currently provides:

- a real run submission form backed by `POST /api/runs`
- a routed run list page at `/runs` backed by `GET /api/runs`
- a routed run detail page at `/runs/:runId` backed by `GET /api/runs/:runId` and `GET /api/runs/:runId/observability`
- a task detail panel that joins task records with observability summaries for operator debugging
- an artifact detail panel backed by run-state artifact records from the control-plane detail endpoint
- an event timeline panel backed by observability timeline entries from the existing read model
- a task snapshot backed by `GET /api/runs/:runId/tasks`
- task-level retry, approve, and reject controls backed by the existing task action endpoints
- a React Flow DAG preview scaffold driven by fetched task records

This is enough to start frontend delivery without waiting for pause or resume.

## Information Architecture

The first frontend pass should stay within four views:

1. run submission
2. run list
3. run detail summary
4. task and DAG inspection

The current shell now uses two real routes:

- `/runs`
- `/runs/:runId`

The next routing step should stay restrained. Do not explode this into many nested pages before artifact and event detail requirements are concrete.

Recommended operator flow:

1. submit one run
2. land on that run
3. inspect stage and blocking state
4. inspect tasks and observability
5. retry or approve one blocked task

## Module Breakdown

The frontend should evolve through these modules:

### `packages/web/src/lib/control-plane-api.ts`

Typed API boundary for the existing control-plane endpoints.

Keep endpoint shapes explicit and close to the backend contracts.

### `packages/web/src/app.tsx`

The root frontend entry now delegates to a router shell rather than a monolithic dashboard page.

### `packages/web/src/app-router.tsx`

Owns the page route tree for `/runs` and `/runs/:runId`.

### `packages/web/src/pages/`

Page-level containers now separate list and detail responsibilities:

- `control-plane-shell.tsx`
- `control-plane-runs-page.tsx`
- `control-plane-run-detail-page.tsx`

### `packages/web/src/hooks/`

Page-scoped data hooks now keep route-level query and mutation state out of presentational components:

- `use-control-plane-runs-page.ts`
- `use-control-plane-run-detail-page.ts`

### Future UI modules

When the shell grows, split into:

- `components/run-submission/`
- `components/run-list/`
- `components/run-detail/`
- `components/observability/`
- `components/dag/`
- `components/task-actions/`

## Delivery Order

The frontend should be built in this order:

1. typed API client
2. run submission
3. run list
4. run detail summary
5. observability cards and attention panel
6. task action controls
7. DAG view refinement
8. log and artifact detail views

This ordering keeps the UI useful before it becomes pretty.

## Deferred Work

The frontend must not fake these capabilities:

- run-level pause
- run-level resume
- multi-user identity or permissions
- streaming event transport
- client-side reconstruction of task state from raw events

If the backend returns `501` or the endpoint does not exist yet, the UI should disable or omit the feature.

## UI Direction

The visual direction should feel like an operator console, not a generic dashboard kit.

The current shell intentionally uses:

- editorial heading typography
- warm paper-like surfaces instead of flat white cards
- strong contrast between operator chrome and data panels
- a restrained palette that separates warning, approval, and neutral states without dark-mode defaulting

Future UI work should preserve that intent instead of collapsing into interchangeable admin-template design.

## Validation Path

Use this path when the frontend changes:

```bash
npm run build
npm run web:build
npm run validate:docs
```

If the frontend starts depending on richer route handling, browser tests, or artifact previews, add frontend-focused validation commands in the same change.