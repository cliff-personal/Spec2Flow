# ADR 0004: Compiled Dist CLI Is The Default Runtime

- Status: accepted
- Date: 2026-03-24
- Deciders: repository runtime surface
- Source of truth: `README.md`, `AGENTS.md`, `package.json`, `packages/cli/dist/cli/spec2flow-dist-entrypoint.js`

## Context

Spec2Flow previously carried a source-first runtime shape while moving toward a TypeScript implementation.

The repository needed one default CLI surface that:

- matches the published `bin`
- gives stable command paths for docs and examples
- avoids ambiguity between source entrypoints and runnable runtime artifacts

## Decision

The compiled CLI under `packages/cli/dist/cli/spec2flow-dist-entrypoint.js` is the default runtime entrypoint.

Repository scripts, `bin`, and example validation commands point to the compiled dist runtime. Source files remain the implementation surface, but they are not the default user-facing runtime entrypoint.

## Consequences

- `npm install` builds the dist entrypoint through `prepare`
- `package.json` scripts remain stable and runnable without asking users to invoke source-only entrypoints directly
- docs can describe one canonical command surface
- build failures become an explicit part of runtime validation rather than a hidden step

## Enforcement

- `package.json` `bin` points to `packages/cli/dist/cli/spec2flow-dist-entrypoint.js`
- repository scripts run the dist entrypoint
- documentation treats the compiled entrypoint as the default CLI runtime surface