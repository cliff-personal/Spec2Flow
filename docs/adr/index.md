# Architecture Decision Records

- Status: active
- Source of truth: `AGENTS.md`, `docs/architecture.md`, `docs/copilot.md`, `package.json`
- Verified with: `npm run build`, `npm run test:unit`
- Last verified: 2026-03-25

## Purpose

This directory stores short, stable decisions that should not remain scattered across plans, roadmap notes, or long-form architecture documents.

Use ADRs for decisions that are already accepted and should be easy for humans and AI agents to cite without rereading the whole repository history.

## Current ADRs

1. [0001-orchestrator-is-system-of-record.md](0001-orchestrator-is-system-of-record.md)
2. [0002-adapter-execution-is-task-scoped.md](0002-adapter-execution-is-task-scoped.md)
3. [0003-runtime-contracts-are-schema-backed.md](0003-runtime-contracts-are-schema-backed.md)
4. [0004-compiled-dist-cli-is-the-default-runtime.md](0004-compiled-dist-cli-is-the-default-runtime.md)

## ADR Rules

- Keep each ADR short and implementation-backed.
- State the decision before the rationale.
- Cross-link the primary enforcing code or contract instead of duplicating long explanations.
- Add a new ADR when a decision changes for lasting reasons, not for temporary rollout notes.
