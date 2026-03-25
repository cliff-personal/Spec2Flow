---
applyTo: "docs/**/*.md"
description: "Use when editing Spec2Flow docs. Keeps architecture, usage, and maintenance docs concise, implementation-backed, and aligned with commands and contracts."
---

# Documentation Rules

- Keep docs concise and implementation-focused.
- Update docs when behavior, commands, contracts, or examples change.
- Cross-link the best source of truth instead of duplicating the same explanation in multiple files.
- If a command is documented, confirm the command still exists and remains the right validation path.
- If a document describes a contract, ensure the matching type, schema, and example still agree.
- Active docs must keep a metadata block near the top with `Status`, `Source of truth`, `Verified with`, and `Last verified`.
- When a key API or design doc replaces another doc as the canonical reader path, record that with `Supersedes` and `Superseded by`.
- `Last verified` must use `YYYY-MM-DD` and should be updated in the same change whenever the doc's described behavior, owning commands, or source-of-truth links are re-checked.
- Do not treat dates as decoration. A freshness date without a real command path or source-of-truth path is still drift.
- `Source of truth` must stay narrow. Prefer concrete files over whole directories such as `packages/cli/src/runtime/`, `packages/web/`, or `schemas/`.
- Do not keep documenting deprecated `npm run` aliases in active docs. If a legacy script still exists for compatibility, use the non-deprecated replacement in active guidance.
- Historical or completed docs belong under `docs/plans/`; active docs must link to plan index pages instead of archived plan files.
