## Purpose
- This file defines repository-wide execution rules for Copilot in Spec2Flow.
- Architectural principles live in `AGENTS.md`.
- Detailed rationale and maintenance policy live in `docs/copilot.md`.

## Repository Intake
- For every new task in this repository, read `llms.txt` first before planning, editing, or running commands.
- Read `AGENTS.md` next for architectural boundaries.
- Read `docs/index.md` next to route into the minimal source-of-truth doc set.
- If the task is narrow, stop after the minimal relevant docs; do not broaden context without need.

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

<!-- agents-memory:start -->
# Agents-Memory Auto-Activation

When working in this repository, treat Agents-Memory as mandatory session context for coding, debugging, code review, refactors, migrations, and docs-sync work.

## Required startup sequence

1. Before any substantial analysis or edits, call `memory_get_index()` if the `agents-memory` MCP server is available.
2. Before touching domain-specific code, call `memory_get_rules(domain)` with the closest matching domain:
   - `python` for Python, FastAPI, backend, repository, or migration work
   - `frontend` for TypeScript, React, Next.js, or UI work
   - `finance` for balance, billing, settlement, ledger, withdraw, refund, or reconciliation work
   - `docs` for README, AGENTS, instruction, contract, workflow, or runbook updates
3. When the task resembles a previous failure pattern, call `memory_search(query)` before writing code.

## Error capture protocol

- Use `project="spec2flow"` when calling `memory_record_error(...)` for this repository.
- If the same error pattern happens again, prefer `memory_increment_repeat(id)` instead of creating a duplicate record.
- Record a new error after any bug fix that took more than one attempt or exposed a reusable lesson.

## Fallback when MCP is unavailable

Use the CLI directly:

```bash
python3 /Users/cliff/workspace/Agents-Memory/scripts/memory.py search <keyword>
python3 /Users/cliff/workspace/Agents-Memory/scripts/memory.py new
```

## Notes

- This file is the strongest repository-wide auto-activation mechanism officially supported by GitHub Copilot custom instructions.
- It improves default tool usage on every repository-scoped request, but it does not hard-enforce MCP tool execution when the platform chooses not to use tools.
<!-- agents-memory:end -->
