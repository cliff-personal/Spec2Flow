# Plans Index

- Status: active
- Source of truth: `docs/structure.md`, `docs/Harness_engineering.md`, `docs/index.md`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`

## Purpose

Keep plan-heavy material out of the primary docs root so active architecture, usage, and operating guidance stay small and current.

## Directory Rules

- `docs/` root is for active source-of-truth docs, indexes, playbooks, ADRs, and examples.
- `docs/plans/completed/` is a short-lived holding area for plans that were just finished but have not yet been folded into stable docs.
- `docs/plans/historical/` is for superseded or completed plans kept only for reference.
- New plan docs should not be added directly under `docs/` root.
- When a plan becomes true in code or stable docs, move it out of the root and either consolidate it or archive it.
- Historical plans are not source of truth for current behavior.

`npm run validate:docs` enforces these placement rules. A root-level `docs/*.md` file with a plan-like name such as `plan`, `roadmap`, `migration`, or `rollout`, or a root-level doc marked `completed` or `historical`, is treated as layout drift and fails validation.

`active` docs and canonical navigation docs also cannot treat specific archived plan files under `docs/plans/historical/` or `docs/plans/completed/` as source of truth or direct navigation targets. If active guidance needs historical context, it should point to the relevant index page instead.

## Current Layout

- [Agent orchestration platform implementation plan](agent-orchestration-platform-implementation-plan.md)
- [Architecture gap matrix](architecture-gap-matrix.md)
- [Web control plane frontend implementation](web-control-plane-frontend-implementation.md)
- [Completed plans](completed/index.md)
- [Historical plans](historical/index.md)

## Maintenance Policy

When adding or updating a plan:

1. decide whether the document is `active`, `completed`, or `historical`
2. link the owning source-of-truth doc or code path near the top
3. remove the plan from top-level navigation once the stable docs exist
4. prefer archiving over leaving obsolete plans in the primary docs root
