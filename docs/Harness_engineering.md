# Harness Engineering for Spec2Flow

- Status: active
- Source of truth: `AGENTS.md`, `docs/index.md`, `docs/structure.md`, `docs/playbooks/index.md`, `docs/adr/index.md`, `packages/cli/src/docs/docs-validation-service.ts`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`
- Last verified: 2026-03-25

## Purpose

This file defines how Spec2Flow keeps repository guidance small, current, and mechanically enforceable.

The target is not "more documentation." The target is a working harness that resists two failure modes:

- bloat: too many overlapping docs, mega-docs, and duplicated explanations
- drift: docs that still read well after the code, commands, or contracts have moved on

## What Is Already Working

Spec2Flow already has the right foundation for an AI-readable repository:

- `llms.txt` gives agents a first-stop machine-readable intake map.
- `AGENTS.md` stays short and architectural instead of becoming a giant handbook.
- `docs/index.md` routes readers to the smallest relevant source-of-truth set.
- `docs/playbooks/` gives stage-scoped operating guidance instead of burying workflow details in root docs.
- `docs/adr/` captures durable decisions separately from plans and exploratory prose.
- `docs/plans/` keeps migration and rollout material out of the primary docs root.
- `schemas/`, TypeScript types, and checked commands provide enforceable contracts.
- `npm run validate:docs` already catches missing metadata, dead links, bad script references, archived-plan misuse, and docs-root layout drift.

This means Spec2Flow is no longer at the "aspirational harness" stage. The repository already has real structure and real checks.

## Remaining Drift Risks

The current weak points are narrower now, but they are still real:

- an active doc can be structurally valid while still being old
- a design or plan doc can remain `active` after the stable docs already became the real truth
- a command can still exist while no longer being the best proof path for the behavior the doc claims
- multiple active docs can overlap and slowly diverge even when all links still work
- agents can treat a long narrative as canonical if the doc does not state what is enforced versus advisory

This is why dates matter, but only when paired with command and source-of-truth validation.

## Iron-Law Metadata Contract

Every active doc must expose a small metadata block near the top:

- `Status`: `active`, `reference`, `historical`, `completed`, or `draft`
- `Source of truth`: the code paths, schemas, or docs that actually own the behavior
- `Verified with`: the smallest stable command path that can still prove the doc is not fiction
- `Last verified`: the most recent `YYYY-MM-DD` date when the active doc was re-checked
- `Supersedes` / `Superseded by`: optional file-level handoff metadata when one canonical design or API doc replaces another

Dates are necessary, but not sufficient.

A date alone is theater. The anti-drift unit is:

1. an active status
2. a real source-of-truth pointer
3. a real verification command path
4. a recent verification date

If one of those four is missing, the doc is not trustworthy enough to act as active guidance.

## Freshness Policy

Spec2Flow now treats documentation freshness as an enforced runtime concern, not a polite suggestion.

Rules:

- active docs must use `Last verified: YYYY-MM-DD`
- active docs cannot use future dates
- active docs cannot stay older than the freshness window enforced by `npm run validate:docs`
- historical and completed docs are exempt from freshness windows, but they must not sit in the active docs root
- archived plans can stay searchable, but active docs must point to archive index pages rather than archived plan files directly

This is the key answer to "should docs include dates?"

Yes. For active docs, dates are worth adding because they give the validator something concrete to measure. Without a date, stale docs can look authoritative forever.

## Enforcement Ladder

Spec2Flow should keep moving repeated rules down this ladder:

1. `llms.txt`, `AGENTS.md`, and `docs/index.md`
   These establish reading order and source-of-truth routing.
2. Scoped instructions
   `.github/instructions/*.md` tells agents how to edit docs, TypeScript, and schemas without polluting always-on architecture guidance.
3. Metadata contract
   `Status`, `Source of truth`, `Verified with`, and `Last verified` make freshness and ownership explicit.
4. Structure rules
   `docs/structure.md` and `docs/plans/index.md` keep plan sprawl and historical drift out of primary navigation.
5. Deterministic validation
   `packages/cli/src/docs/docs-validation-service.ts` turns metadata, script, link, and archive rules into failures instead of wishes.
6. Contracts and tests
   `schemas/`, TypeScript types, generated examples, and unit tests keep behavior drift visible even when prose still looks clean.

The repository gets safer every time a recurring prose rule moves one rung lower.

## What `validate:docs` Should Enforce

For active docs and canonical navigation docs, validation should fail on:

- missing or malformed metadata
- broken source-of-truth paths
- overbroad source-of-truth directories when a concrete file path should own the truth instead
- broken markdown links
- referenced `npm run` commands that no longer exist
- referenced `npm run` commands that are marked deprecated in the docs-validation registry
- direct links to archived plan files from active or canonical docs
- plan-like docs placed directly under `docs/` root
- active docs whose `Last verified` date is stale
- non-reciprocal `Supersedes` / `Superseded by` relationships

This is the minimum viable anti-drift gate. If a repo wants "iron-law" behavior, this command has to be annoying in the right places.

## What Still Needs Human Judgment

No validator can prove that prose is perfectly written or that every explanation is the shortest possible one.

Humans and agents still need to decide:

- whether a new doc should exist at all
- whether a plan should be folded into a stable doc and archived
- whether two docs overlap enough that one should defer to the other
- whether a verification command is still the smallest honest proof path

The rule is simple:

If the repo can enforce it mechanically, do that.
If it cannot enforce it mechanically yet, document it once in the narrowest owning place and then plan the enforcement upgrade.

## Practical Anti-Bloat Rules

To keep the docs root sharp:

- one doc should answer one dominant question
- indexes should route; they should not become encyclopedias
- stable decisions should move to ADRs
- stage procedure should move to playbooks
- rollout and migration narrative should move to `docs/plans/`
- examples should show concrete evidence, not carry primary architecture truth

When a doc starts mixing architecture, operations, migration history, examples, and policy in one place, that is a bloat signal, not a sign of thoroughness.

## Change Protocol

When behavior changes:

1. update the owning code, schema, or command path
2. update the smallest active doc that should describe it
3. update `Last verified`
4. run the smallest honest validation path
5. run `npm run validate:docs`

When a plan becomes true:

1. move stable truth into root docs, ADRs, playbooks, or contracts
2. change the plan status or archive it
3. remove the plan from primary navigation if it no longer drives implementation

## Definition Of "No Drift"

Spec2Flow should consider its doc harness healthy only when all of the following are true:

- new agents read `llms.txt` first and can find the right doc quickly
- active docs declare who owns the truth and how it was last checked
- root docs stay small because plans, ADRs, playbooks, and examples each keep to their lane
- `npm run validate:docs` can reject stale or structurally misleading docs
- schemas, tests, and examples backstop the prose with executable truth

That is the real anti-drift posture: not trust in good intentions, but a repository that makes lying documentation expensive.
