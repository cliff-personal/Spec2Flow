# UI Visual Language

- Status: active
- Source of truth: `docs/ui/operator-console.md`, `packages/web/src/styles.css`, `packages/web/src/components/app-sidebar.tsx`, `packages/web/src/pages/control-plane-projects-page.tsx`, `packages/web/src/pages/control-plane-run-detail-page.tsx`
- Verified with: `npm run validate:docs`, `npm run web:build`
- Last verified: 2026-03-25

## Goal

Define the visual system for Spec2Flow as a local-first autonomous engineering control plane.

This document is the canonical answer for:

- how the UI should feel
- how information density should be handled
- how surfaces, type, motion, and controls should be implemented without drifting into generic admin UI

## Design Thesis

Spec2Flow should feel like a calm mission-control product, not a noisy cyberpunk demo and not a default enterprise dashboard.

The right vibe is:

- dark, atmospheric, and high-density
- evidence-first, not chart-first
- premium and deliberate, not decorative
- technical enough for engineering workflows, but still readable during long review sessions

## Visual Principles

- use contrast sparingly; let important states earn the brightest accents
- prefer tonal separation over hard borders
- keep the page hierarchy obvious from layout before adding color
- show system confidence through clarity, not through excessive chrome
- let motion reinforce status change and handoff moments, not distract from task evidence

## Color And Surface

Base palette:

- background: deep charcoal and midnight navy
- accent: electric cyan for active flow, vivid green for healthy completion, restrained red for defects and intervention states
- support accent: muted violet only for secondary highlights and not as the default brand color

Surface model:

- base canvas should feel like one continuous workspace
- cards and panels should be separated primarily by background shifts
- border usage should stay subtle and low-contrast
- glass or blur effects are allowed only where they improve depth, not as decoration on every panel

Implementation rule:

- define shared CSS variables once in `packages/web/src/styles.css`
- avoid hard-coded one-off colors inside component files unless the value is semantically unique

## Typography

Typography should split into three jobs:

- editorial headline font for page titles and product moments
- readable sans-serif for summaries, labels, and body copy
- monospace for evidence, logs, metrics, file paths, token counts, and code-related metadata

Implementation rule:

- page titles should feel designed, not default
- dense operational panels should optimize for scanning speed first
- logs, diffs, and event feeds should use monospace consistently

## Layout Grammar

Use one product grammar across the app:

- left rail for product sections
- main stage for the current project, run, or review surface
- optional right-side contextual detail for task evidence and operator actions

Page composition rules:

- `Projects` should open with project context and one obvious primary action
- `Run Detail` should prioritize stage progression and task evidence
- `Review Packet` should compress the whole run into one approval-grade narrative
- avoid stacking too many equal-weight cards above the fold

## Motion

Motion should signal system state, not decorate the page.

Allowed motion patterns:

- subtle pulse on active tasks
- staged reveal when a new run is created
- soft highlight when a task changes ownership or status
- completion flourish only on run completion or review packet readiness

Do not use:

- constant looping animations unrelated to live state
- bouncy spring behavior on dense operator panels
- motion that hides state changes behind transitions

## Component Rules

Primary controls:

- one strong CTA per page section
- primary buttons should feel confident but not oversized
- destructive actions should be clearly separated from routine actions

Task cards:

- status first
- owner and stage second
- evidence and code deltas one click away

Evidence panels:

- prioritize artifacts, logs, diffs, and validation outcomes
- do not bury the evidence behind decorative tabs if one evidence type dominates the task

Metric chips:

- use compact, monospace-friendly presentation
- token totals, cost estimates, retry counts, and defect counts should share one chip language

## Implementation Guidance

No new frontend framework is required for these UI designs.

Spec2Flow already has the right base stack:

- React
- Vite
- React Router
- route-scoped components under `packages/web/src/`

The winning move is to deepen the current stack, not replace it.

Implementation order:

1. stabilize shared tokens and layout primitives in `styles.css`
2. implement project-first pages and route shells
3. build a reusable task-detail evidence panel
4. build the review packet surface last, after run detail data is stable

Avoid:

- adding a second component framework on top of the current shell
- mixing mockup HTML directly into production routes
- building page visuals before the data model and navigation hierarchy are clear
