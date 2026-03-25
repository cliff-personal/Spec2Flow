# UI Interaction Concepts

- Status: reference
- Source of truth: `docs/ui/operator-console.md`, `docs/ui/visual-language.md`, `docs/project-workspace-autonomous-delivery-design.md`

## Purpose

Capture the early UI ideation language that shaped the product direction without pretending these notes are the final source of truth.

Use this file for:

- naming inspiration
- page-storytelling concepts
- operator-centric interaction ideas that may still be useful during implementation

Do not use this file as the final arbiter for page structure or implementation behavior.

## Strong Concepts Worth Keeping

- `Workspace Sandbox`: the protected work interval where agents may read and write
- `Mission Control Dashboard`: the run-level command center for autonomous delivery
- `Active Task Detail`: the deep inspection surface for one task, one diff, one evidence thread
- `Evidence-First Review`: the final human acceptance surface
- `Self-Healing Loop`: the visible defect-detect, repair, and re-verify cycle
- `Token Pulse Monitor`: a compact operational view of token usage and cost

## Interaction Story

Recommended product narrative:

1. operator opens `Projects`
2. operator selects one project and submits a requirement
3. the requirement expands into a multi-task delivery run
4. the run advances through the six-stage flow with visible status changes
5. defects and retries appear as part of the same run story, not as detached incidents
6. the run ends in one review-ready packet for human validation

## UI Language Guidance

The product should talk like an operator console, not like a generic project tracker.

Prefer terms such as:

- `workspace`
- `run`
- `task`
- `evidence`
- `review packet`
- `repair`

Avoid turning the product into:

- a chat app
- a Kanban clone
- a generic CI dashboard

## Implementation Note

When this file conflicts with canonical docs, follow:

1. [Web Control Plane Product Design](/Users/cliff/workspace/Spec2Flow/docs/ui/operator-console.md)
2. [UI Visual Language](/Users/cliff/workspace/Spec2Flow/docs/ui/visual-language.md)
3. [Project Workspace Autonomous Delivery Design](/Users/cliff/workspace/Spec2Flow/docs/project-workspace-autonomous-delivery-design.md)
