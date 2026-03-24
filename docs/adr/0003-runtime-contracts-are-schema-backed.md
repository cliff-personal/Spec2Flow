# ADR 0003: Runtime Contracts Are Schema-Backed

- Status: accepted
- Date: 2026-03-24
- Deciders: repository architecture
- Source of truth: `AGENTS.md`, `docs/copilot.md`, `packages/cli/src/shared/schema-registry.ts`, `packages/cli/src/runtime/task-result-service.ts`, `schemas/`

## Context

Spec2Flow exchanges structured payloads across planning, runtime, adapter execution, onboarding validation, and example generation.

If those payloads are described only in prose or TypeScript types, contract drift becomes hard to detect at repository boundaries.

The project needs a validation layer that is portable, machine-checkable, and shared across runtime entrypoints.

## Decision

Public runtime contracts are schema-backed.

TypeScript types, JSON schemas, and example artifacts must stay aligned for execution state, task results, adapter runtime payloads, and related workflow documents.

## Consequences

- external inputs are validated at the boundary before the controller accepts them
- contract changes must update schemas, types, examples, and tests together when practical
- examples under `docs/examples/` remain useful as checked-in evidence because they validate against the same contracts
- documentation can point to enforceable files instead of carrying the whole contract in prose

## Enforcement

- validators are compiled in `packages/cli/src/shared/schema-registry.ts`
- runtime payloads are validated before persistence in runtime services and onboarding validators
- authoritative schema files live under `schemas/`