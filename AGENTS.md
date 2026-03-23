# AGENTS.md

## Purpose

Spec2Flow is an AI workflow framework for turning requirements and repository context into a repeatable engineering loop:

1. requirements analysis
2. code implementation
3. test design
4. automated execution
5. defect feedback
6. collaboration workflow

This repository is not just a CLI tool. It is the control plane for an agent-friendly development workflow.

Spec2Flow should stay simple at the top level:
- the CLI orchestrates work
- adapters connect external model runtimes
- schemas define contracts
- docs explain the system and remain part of the product

## Core Model

Spec2Flow is the orchestrator, not the coding agent itself.

Keep this boundary clear:
- Spec2Flow owns workflow structure, task graphs, execution state, artifacts, and deterministic state transitions
- provider adapters own task-scoped agent execution
- model sessions may be reused, but sessions are never the source of truth
- repository files are the source of truth for architecture, contracts, and operating guidance

## Design Goals

Prefer designs that are:
- simple to explain
- easy to extend
- easy to integrate into another repository
- easy for users to run with a small number of commands
- easy for agents to read and navigate

Favor boring, explicit, well-structured solutions over clever abstractions.

## Engineering Principles

### DRY
- remove duplicated workflow logic, schema logic, and task-state logic
- share contracts instead of copying behavior across commands
- do not create parallel concepts when one clear concept is enough

### TDD and Verification
- treat verification as part of implementation, not a follow-up task
- every meaningful behavior change should have the smallest relevant validation path
- prefer deterministic validation commands over manual reasoning
- if code and docs disagree, fix the disagreement before adding more behavior

### Architecture Discipline
- keep orchestration separate from execution
- keep runtime state outside model memory
- keep public contracts stable unless a change is required
- prefer explicit inputs and outputs over hidden coupling
- make failure states observable and resumable

### Code Decomposition
- split code by domain responsibility before splitting by technical novelty
- keep CLI entrypoints thin; move business rules into focused modules
- prefer one module per cohesive responsibility: validation, task-graph building, execution state, adapter runtime, workflow loop
- keep parsing, state transitions, external process calls, and output formatting separate
- if a file mixes orchestration, domain rules, and infrastructure code, it is already overdue for decomposition
- optimize for simple reading paths: a contributor should be able to find the relevant behavior in one or two files, not one 2000-line script

### Extensibility
- add capability through adapters and contracts, not hard-coded provider assumptions
- keep schemas provider-neutral where possible
- design for multi-stage workflows, multi-repo onboarding, and future provider swaps

### Usability
- commands should be predictable
- examples should be runnable
- error messages should help the next action
- defaults should support a useful local workflow

## Agent-Friendly Repository Rules

Inspired by agent-oriented harness engineering, keep this repository readable for both humans and agents:

- treat the repository as the record system
- keep important decisions in versioned Markdown, not only in chat
- keep AGENTS.md short; use it as a map, not a handbook
- place detailed reasoning in focused docs under `docs/`
- prefer stable file structure and explicit naming
- encode important rules in schemas, commands, or validation where possible

## Code and Docs Must Stay in Sync

Spec2Flow is a workflow framework. If docs drift from implementation, the product degrades.

When behavior changes:
- update the relevant docs
- update schemas or examples if contracts changed
- update example commands when the real workflow changed
- avoid leaving design intent only in code or only in prose

If a rule matters repeatedly, move it closer to enforcement:
- from chat to docs
- from docs to schema or validation
- from convention to deterministic tooling

To prevent doc drift, compress or refactor docs when any of these happen:
- the same concept is explained in three or more files with overlapping wording
- one document becomes a handbook instead of a map and starts hiding the real source of truth
- a workflow, command, or contract changed and one summary doc now disagrees with a deeper doc
- a section repeats another section with only wording changes and no new decision-making value
- a document mixes product overview, operator guidance, and deep design detail in one place

Preferred doc maintenance actions:
- compress when two sections explain the same behavior at different lengths but one summary is enough
- refactor when a document contains multiple audiences or mixes overview, architecture, and procedures
- split when detailed reference content would make a top-level doc harder for humans or agents to navigate
- cross-link instead of duplicating when another file is already the better source of truth

Apply the same rule to code:
- split when one file holds multiple bounded contexts or application services
- refactor when one function changes state, performs IO, and formats outputs in the same block
- extract a module when a concept needs its own tests, invariants, or public contract

## Navigation

Start here when you need the system map:
- `README.md`: product overview and goals
- `docs/architecture.md`: runtime model and orchestration boundaries
- `docs/synapse-integration-automation-design.md`: complex-system integration and multi-agent design
- `docs/usage-guide.md`: usage patterns
- `docs/structure.md`: repository layout
- `packages/cli/src/cli/spec2flow-dist-entrypoint.ts`: compiled CLI source entrypoint
- `packages/cli/dist/cli/spec2flow-dist-entrypoint.js`: default CLI runtime entrypoint
- `schemas/`: workflow contracts and validation schemas

## Working Rules For Changes

- preserve the orchestrator versus adapter boundary
- prefer focused changes over broad rewrites
- keep examples aligned with the real CLI behavior
- do not add complexity unless it improves reliability, extensibility, or usability
- when adding a new workflow concept, define its contract and persistence model clearly
- when updating docs, remove stale repetition instead of layering another summary on top

Split code or features when any of these are true:
- a file grows large enough that one reader cannot hold its responsibilities in working memory, especially around 500 to 800 lines of mixed logic
- one file contains multiple change reasons, such as CLI parsing, validation, task planning, runtime state transitions, and external process execution
- a function needs more than one paragraph to explain its behavior or mixes domain decisions with infrastructure details
- different parts of the file want different tests, ownership, or review criteria
- adding one feature requires touching distant unrelated sections of the same file

When splitting, prefer this order:
- separate domain logic from CLI wiring
- separate pure functions from filesystem and process IO
- separate workflow planning from runtime execution
- separate provider adapters from controller state transitions

## Useful Commands

- `npm install`
- `npm run validate:synapse-example`
- `npm run generate:synapse-task-graph`
- `npm run generate:synapse-execution-state`

## Quality Bar

A good change in this repository is:
- understandable from the docs and code together
- verifiable with a small, concrete command path
- consistent with the six-stage workflow
- reusable across repositories, not overfit to one demo
- simple enough that a future agent can extend it safely
