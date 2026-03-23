---
applyTo: "packages/cli/src/**/*.ts"
description: "Use when editing Spec2Flow TypeScript CLI source. Enforces thin CLI handlers, explicit contracts, boundary validation, and test requirements for runtime behavior."
---

# TypeScript CLI Rules

- Keep CLI command modules thin; parsing and dependency wiring belong there, domain behavior does not.
- Put state transitions in runtime or planning services, not command handlers and not adapter templates.
- Exported functions must declare explicit return types.
- Do not introduce `any`; use `unknown` plus narrowing when dynamic input is unavoidable.
- Validate external payloads at the boundary with schema validators or deterministic validation helpers.
- Prefer extracting pure helpers when behavior introduces branching or invariants.
- Add or update unit tests when changing state transitions, policy checks, parsers, routing logic, or validation behavior.
- When public contracts change, update matching types, schemas, and example fixtures in the same change.