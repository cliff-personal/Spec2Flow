# Harness Engineering for Spec2Flow

- Status: active
- Source of truth: `AGENTS.md`, `docs/index.md`, `docs/playbooks/index.md`, `docs/adr/index.md`
- Verified with: `npm run build`, `npm run test:unit`

## Purpose

This document captures how Spec2Flow should evolve its documentation and Copilot customization so the repository is easier for AI agents to navigate, safer to extend, and less likely to drift over time.

The goal is not to add more prose. The goal is to improve the repository as a working harness:

- a clear map for agents
- stable contracts for execution
- explicit boundaries for architecture
- deterministic validation paths
- small feedback loops that keep docs current

## What Harness Engineering Means Here

The OpenAI harness engineering article points to a few durable ideas that apply directly to Spec2Flow:

1. The repository should be the system of record.
2. Agents need a map, not a giant instruction blob.
3. Human effort should move from hand-authoring every change to designing clearer environments, constraints, and feedback loops.
4. Architecture, validation, and style rules work better when enforced mechanically rather than repeated in prose.
5. Entropy is normal in agent-heavy workflows, so the repository needs ongoing garbage collection.

For Spec2Flow, this means documentation should help an agent answer four questions quickly:

1. What is this repository trying to do?
2. What files are the source of truth for this task?
3. What commands prove a change is correct?
4. What rules are advisory versus enforced?

## Current Strengths

Spec2Flow already has several strong harness-engineering properties:

- `AGENTS.md` is short and architecture-oriented.
- `.github/copilot-instructions.md` is separated from architectural guidance.
- scoped instructions exist for TypeScript, schemas, and docs.
- `docs/copilot.md` explains the customization strategy.
- schemas and TypeScript types provide explicit contracts.
- example workflow artifacts make the execution model concrete.
- validation commands such as `npm run build` and `npm run test:unit` are stable and easy to invoke.

This is already much better than the common anti-pattern of a single giant Copilot instruction file.

## Main Gaps

The next bottlenecks are not basic guidance. They are discovery, freshness, and control-plane clarity.

### 1. There is no dedicated AI-facing document map

`README.md`, `AGENTS.md`, and `docs/copilot.md` together contain the right ideas, but an agent still has to infer which document to read for which question.

What to add:

- a root-level `llms.txt`
- a short `docs/index.md` or `docs/agent-map.md`
- section-level indexes for large domains such as architecture, usage, and examples

Why:

- this reduces context search cost
- it gives external and internal agents a stable reading order
- it lowers the risk that agents read obsolete or secondary documents first

### 2. Plan and design documents can grow without freshness signals

The repository has valuable long-form documents, but not every document exposes whether it is current, historical, or superseded.

What to add:

- a small metadata block near the top of major docs:
  - status: active, reference, historical, draft
  - source of truth: code, schema, runtime artifact, or policy doc
  - last verified against commands or files
  - supersedes / superseded by links when relevant

Why:

- agents cannot reliably infer freshness from prose
- drift often starts when old plans remain readable but unmarked
- explicit status helps both humans and agents avoid stale guidance

### 3. The repository lacks per-stage execution playbooks

Spec2Flow has a six-stage model, but there is no narrow playbook for each stage that says: inputs, expected outputs, allowed tools, and validation path.

What to add:

- `docs/playbooks/requirements-analysis.md`
- `docs/playbooks/code-implementation.md`
- `docs/playbooks/test-design.md`
- `docs/playbooks/automated-execution.md`
- `docs/playbooks/defect-feedback.md`
- `docs/playbooks/collaboration.md`

Each playbook should stay short and answer:

- when this stage starts
- what artifacts it must consume
- what artifact it must emit
- what can fail the stage
- what command path validates the result

Why:

- this is ideal agent context: local, explicit, task-scoped
- it avoids overloading `AGENTS.md` and `README.md`
- it lets future custom agents or skills map directly to one stage

### 4. Architectural decisions are not yet captured as small ADRs

Important repository decisions are currently spread across architecture and plan documents.

What to add:

- `docs/adr/` with concise Architecture Decision Records for decisions such as:
  - why Spec2Flow is an orchestrator rather than a monolithic agent
  - why adapter execution is task-scoped
  - why contracts are schema-backed
  - why Copilot CLI is the documented runtime surface

Why:

- ADRs help agents distinguish active decisions from exploratory discussion
- they reduce the need to re-explain settled tradeoffs in multiple docs
- they provide stable references for future refactors

### 5. Generated versus authored knowledge is still mixed conceptually

The repository already separates generated execution artifacts, but the doc model can make this distinction more explicit.

What to add:

- a documented split between:
  - authored guidance
  - generated evidence
  - executable contracts

Suggested framing:

- `docs/`: authored intent and operating guidance
- `schemas/`: enforceable contracts
- `docs/examples/**/generated/`: checked-in example evidence
- `.spec2flow/` and `spec2flow/outputs/`: runtime evidence, never source of truth

Why:

- agents should know what may be edited, what may be regenerated, and what should only be inspected
- this reduces accidental coupling to ephemeral artifacts

## Recommended Documentation Optimizations

### Keep `AGENTS.md` as a table of contents, not a handbook

Do:

- keep it short
- keep it architectural
- link outward aggressively

Do not:

- add stage-specific procedures
- add command trivia
- add long maintenance checklists

Why:

- large always-on instruction files waste context budget
- shorter maps are easier to keep fresh

### Move repeated rules toward enforcement

If a rule matters repeatedly, move it down this ladder:

1. narrative doc
2. scoped instruction
3. schema or validation helper
4. test or CI check

Examples for Spec2Flow:

- command references in docs should be checked by CI or a doc validation script
- schema-linked examples should be validated automatically
- stage artifact requirements should stay in types and schemas, not only in prose

Why:

- this is the best defense against doc drift
- agents follow enforced rules more reliably than aspirational ones

### Prefer indexes over long narrative expansions

When a topic grows, add an index page instead of appending everything to one long doc.

Good pattern:

- `docs/architecture.md` stays high-level
- `docs/adr/` stores stable decisions
- `docs/playbooks/` stores operational stage guidance
- `docs/examples/` stores concrete cases

Bad pattern:

- one mega-doc that mixes architecture, operations, policy, examples, and historical notes

Why:

- agents do better with progressive disclosure
- smaller docs have clearer ownership and lower update cost

### Add a documentation freshness policy

Add a lightweight rule set:

1. Every major doc names its source of truth.
2. Historical plans are marked clearly.
3. New behavior changes must update either contracts, tests, or the owning doc in the same change.
4. When two docs overlap, one must defer to the other.

Why:

- this controls prose sprawl
- it prevents parallel truths

## Should Spec2Flow Install Skills from Awesome Copilot?

Yes, but selectively.

The right question is not "should we install more skills?" The right question is "which behaviors are repeated often enough that they deserve a stable reusable unit?"

### Recommendation

Do not install a large generic bundle.

Prefer this order:

1. keep repository-specific rules in local instructions
2. add local repo-specific skills for repeated Spec2Flow workflows
3. borrow community skills only when they fill a narrow gap cleanly

Why:

- community assets are broad and uneven in quality
- external skills can introduce style or workflow assumptions that conflict with this repository
- Spec2Flow itself is a workflow framework, so stability matters more than novelty

### Skills worth considering as references or selective imports

From `github/awesome-copilot`, the most relevant categories are:

- `create-llms`
  - useful if you want a machine-readable map for external agents
- `update-llms`
  - useful once documentation structure starts changing regularly
- `documentation-writer`
  - useful as a reference for structured doc authoring, not as an always-on rule
- `create-architectural-decision-record`
  - useful if you adopt ADRs
- `context-map`
  - useful as a pattern for generating task-specific file maps
- `agent-governance`
  - useful if Spec2Flow expands further into policy-enforced multi-agent execution
- `doublecheck`
  - useful for high-risk research or external-reference verification workflows
- `copilot-instructions-blueprint-generator`
  - useful as a reference when evolving `.github/copilot-instructions.md`

### Skills I would not install broadly

- generic "beast mode" agents
- style-heavy agents that try to own every implementation detail
- overlapping planning skills when Spec2Flow already has its own orchestration model
- tools that encourage giant prompt files instead of repository structure

Why:

- these often fight the repository's own harness instead of strengthening it

### Best adoption model

For this repository, the safest pattern is:

1. inspect an Awesome Copilot skill
2. extract only the useful behavior pattern
3. re-express it as a local Spec2Flow skill or instruction
4. keep the trigger phrases and scope narrow

That preserves compatibility with the repo's architecture and avoids hidden external assumptions.

## Recommended Local Skills for Spec2Flow

Spec2Flow would benefit more from a few repo-native skills than from many generic imports.

### 1. `stage-playbook`

Use when a task has already been claimed and the agent needs stage-specific execution guidance.

Should include:

- expected inputs and outputs by stage
- artifact contract reminders
- smallest validation path
- common failure modes

### 2. `doc-gardening`

Use when a change touches docs, schemas, examples, or command behavior.

Should include:

- how to locate the owning source of truth
- how to mark stale or historical docs
- how to update cross-links
- how to avoid duplicating behavior descriptions

### 3. `task-graph-review`

Use when changing planning, runtime routing, or task graph semantics.

Should include:

- boundary checklist
- affected schemas and types
- required regression tests
- example fixtures to update

### 4. `adapter-runtime-review`

Use when changing Copilot CLI integration or future provider adapters.

Should include:

- preflight expectations
- provider-specific versus controller-owned rules
- expected outputs and failure reporting

## How to Fight Documentation Drift

Documentation drift is mostly a control problem, not a writing problem.

### Add explicit ownership

Every durable doc should imply one primary owner:

- architecture docs are owned by runtime architecture
- usage docs are owned by current command behavior
- playbooks are owned by the corresponding stage contracts
- examples are owned by the commands that generate or consume them

### Mark document state

Use a small header block for major docs:

- status
- source of truth
- verified with

### Add doc checks to CI over time

Examples:

- verify referenced commands exist in `package.json`
- verify linked files exist
- verify example JSON files still validate against schemas
- fail when docs marked `active` reference removed commands

### Run periodic doc gardening

The repository should eventually have a repeatable maintenance loop that:

- finds duplicate concepts
- marks stale plans as historical
- removes dead links
- updates indexes
- opens small cleanup PRs instead of large rewrites

## How to Fight Documentation Bloat

### Use progressive disclosure

Keep each layer narrow:

- `README.md`: product overview and entrypoint
- `AGENTS.md`: architecture map and navigation
- `.github/copilot-instructions.md`: execution policy
- scoped instructions: file-family rules
- playbooks: stage execution guidance
- ADRs: stable architectural decisions
- examples: concrete evidence

### Split by question, not by enthusiasm

Each document should answer one dominant question.

Good examples:

- architecture: how the system is divided
- usage guide: how to adopt and run it
- collaboration: how results flow into GitHub
- harness engineering: how to optimize the repo for AI agents

### Archive aggressively

Long-lived plan documents should move into a historical bucket once superseded.

Suggested future structure:

- `docs/plans/active/`
- `docs/plans/completed/`
- `docs/plans/historical/`

Why:

- active context should stay small
- historical context should still be searchable without competing with current truth

## Practical Next Steps

Recommended order of operations:

Completed in the current repository state:

1. added `llms.txt` at the repository root
2. added a short docs index and agent map
3. created `docs/playbooks/` for the six workflow stages
4. created `docs/adr/` for stable architectural decisions
5. added document status and freshness markers to major docs

Recommended next steps:

1. add a small doc-validation script or CI check
2. add one or two repo-native skills instead of importing many generic ones
3. move superseded plan-heavy docs into a clearer active versus historical structure

## Bottom Line

The best optimization for AI collaboration is not more prompt text.

It is a repository that is easier to read, easier to verify, and harder to misunderstand.

For Spec2Flow, that means:

- stronger document indexing
- clearer separation of active versus historical guidance
- stage-scoped playbooks
- ADRs for stable decisions
- selective skill adoption
- more mechanical freshness checks

That is the harness. Better prompts help, but better repository structure scales further.