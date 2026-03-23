## Purpose
- This file defines repository-wide execution rules for Copilot in Spec2Flow.
- Architectural principles live in `AGENTS.md`.
- Detailed rationale and maintenance policy live in `docs/copilot.md`.

## Change Scope
- Prefer focused changes over broad rewrites.
- Keep one Spec2Flow task claim focused on one subtask only.
- Do not broaden a change beyond the claimed scope unless explicitly asked.
- Preserve existing file structure and public command names unless a change is required.

## Runtime Boundaries
- Prefer deterministic CLI state transitions over ad-hoc file edits.
- Keep controller logic in planning or runtime services, not in adapter templates or thin CLI handlers.
- Keep provider-specific behavior in adapters; do not let adapters own orchestration truth.
- When returning structured task output, prefer JSON-compatible summaries and actionable notes.

## Verification Matrix
- Type or module-structure change: run `npm run build` first.
- Contract or schema change: run `npm run build` and the smallest matching example-generation command.
- Runtime state or routing change: run `npm run build` and the smallest state-transition regression path.
- Adapter change: run `npm run build` and the smallest adapter or preflight regression path.
- Documentation that describes behavior: verify referenced commands, examples, and contracts still match implementation.
- If authentication or external platform access is missing, return a precise failure instead of guessing.

## Testing Rules
- New state transitions, policy rules, parsers, or validation logic require tests.
- Bug fixes should add a failing test or regression fixture before or alongside the fix.
- Contract changes must update related types, schemas, fixtures, and tests in the same change when practical.
- Do not add tests for trivial pass-through wrappers unless they protect an external contract.

## Documentation and Contract Sync
- When behavior changes, update the relevant docs.
- When contracts change, update types, schemas, and generated examples together.
- Do not leave important behavior only in prose when it can be encoded in validation, schema, or tests.
- Keep documentation concise and implementation-focused.

## Useful Commands
- `npm install`
- `npm run build`
- `npm run typecheck`
- `npm run test:unit`
- `npm run validate:synapse-example`
- `npm run generate:synapse-task-graph`
- `npm run generate:synapse-execution-state`