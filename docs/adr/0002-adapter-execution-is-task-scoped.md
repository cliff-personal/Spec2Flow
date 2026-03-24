# ADR 0002: Adapter Execution Is Task-Scoped

- Status: accepted
- Date: 2026-03-24
- Deciders: repository architecture
- Source of truth: `AGENTS.md`, `docs/architecture.md`, `packages/cli/src/planning/task-graph-service.ts`, `packages/cli/src/shared/task-role-profile.ts`, `packages/cli/src/adapters/adapter-runner.ts`

## Context

Spec2Flow uses specialist roles such as `requirements-agent`, `implementation-agent`, and `defect-agent`.

Without a task-scoped execution boundary, adapters would drift toward one generic agent session that mixes planning, code edits, verification, and collaboration side effects in the same context.

That would blur permissions and make policy enforcement unreliable.

## Decision

Provider adapters execute one claimed task at a time, under the role profile and command policy attached to that task.

Adapters own task-scoped agent execution. They do not own orchestration truth, and they do not receive open-ended authority across the whole workflow.

## Consequences

- every claimed task carries its own `stage`, `executorType`, and `roleProfile`
- the adapter must respect per-stage permissions for reading, editing, commands, artifact writes, and collaboration actions
- specialist roles stay explicit and replaceable without changing the workflow controller
- policy violations can be downgraded into deterministic failed task results

## Enforcement

- route stage tasks are created in `packages/cli/src/planning/task-graph-service.ts`
- allowed executor and role mappings are defined in `packages/cli/src/shared/task-role-profile.ts`
- adapter-reported activity is checked in `packages/cli/src/adapters/adapter-runner.ts`