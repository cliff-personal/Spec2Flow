## Build Commands
- `npm install` - Install project dependencies.
- `npm run validate:synapse-example` - Validate onboarding inputs for the Synapse example.
- `npm run generate:synapse-task-graph` - Generate the example task graph.
- `npm run generate:synapse-execution-state` - Initialize the example execution state.

## Runtime Boundaries
- Prefer deterministic CLI state transitions over ad-hoc file edits.
- Keep one Spec2Flow task claim focused on one subtask only.
- When returning structured task output, prefer JSON-compatible summaries and actionable notes.
- Do not broaden changes beyond the claimed task scope unless explicitly asked.

## Verification
- When code changes are made, run the smallest relevant validation command first.
- If authentication or external platform access is missing, return a precise failure instead of guessing.

## Style
- Keep documentation concise and implementation-focused.
- Preserve existing file structure and public command names unless a change is required.