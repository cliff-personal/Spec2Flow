# UI Docs Index

- Status: active
- Source of truth: `docs/ui/operator-console.md`, `docs/ui/visual-language.md`, `docs/project-workspace-autonomous-delivery-design.md`, `packages/web/src/pages/control-plane-projects-page.tsx`, `packages/web/src/pages/control-plane-run-detail-page.tsx`
- Verified with: `npm run validate:docs`, `npm run web:build`
- Last verified: 2026-03-25

## Purpose

This file is the shortest stable map for the Spec2Flow UI docs set.

Use it when you need to answer three questions fast:

1. which UI document is canonical for product behavior?
2. which document defines the visual language?
3. where do the exported mockups and generator artifacts live?

## Read First

1. [Web Control Plane Product Design](/Users/cliff/workspace/Spec2Flow/docs/ui/operator-console.md)
2. [UI Visual Language](/Users/cliff/workspace/Spec2Flow/docs/ui/visual-language.md)
3. [Project Workspace Autonomous Delivery Design](/Users/cliff/workspace/Spec2Flow/docs/project-workspace-autonomous-delivery-design.md)
4. [UI Interaction Concepts](/Users/cliff/workspace/Spec2Flow/docs/ui/interaction-concepts.md)
5. [UI Reference Explorations](/Users/cliff/workspace/Spec2Flow/docs/ui/reference/README.md)

## Canonical Docs

- [Web Control Plane Product Design](/Users/cliff/workspace/Spec2Flow/docs/ui/operator-console.md): product IA, page model, operator workflows, and the `project -> workspace -> run -> task -> evidence -> review packet` shape.
- [UI Visual Language](/Users/cliff/workspace/Spec2Flow/docs/ui/visual-language.md): color, typography, surface, motion, and component rules for implementation.
- [Project Workspace Autonomous Delivery Design](/Users/cliff/workspace/Spec2Flow/docs/project-workspace-autonomous-delivery-design.md): domain model behind project registration, workspaces, worktrees, and autonomous delivery.

## Supporting Docs

- [UI Interaction Concepts](/Users/cliff/workspace/Spec2Flow/docs/ui/interaction-concepts.md): naming, storytelling, and page-flow concepts distilled from early UI notes.
- [UI Reference Explorations](/Users/cliff/workspace/Spec2Flow/docs/ui/reference/README.md): exported mockups, screenshots, and prototype HTML kept as reference assets rather than source of truth.

## Route Mapping

- `Projects`: [Web Control Plane Product Design](/Users/cliff/workspace/Spec2Flow/docs/ui/operator-console.md), [UI Interaction Concepts](/Users/cliff/workspace/Spec2Flow/docs/ui/interaction-concepts.md)
- `Project Detail`: [Web Control Plane Product Design](/Users/cliff/workspace/Spec2Flow/docs/ui/operator-console.md), [Project Workspace Autonomous Delivery Design](/Users/cliff/workspace/Spec2Flow/docs/project-workspace-autonomous-delivery-design.md)
- `New Requirement`: [Web Control Plane Product Design](/Users/cliff/workspace/Spec2Flow/docs/ui/operator-console.md), [UI Interaction Concepts](/Users/cliff/workspace/Spec2Flow/docs/ui/interaction-concepts.md)
- `Run Detail`: [Web Control Plane Product Design](/Users/cliff/workspace/Spec2Flow/docs/ui/operator-console.md), [UI Visual Language](/Users/cliff/workspace/Spec2Flow/docs/ui/visual-language.md)
- `Review Packet`: [Web Control Plane Product Design](/Users/cliff/workspace/Spec2Flow/docs/ui/operator-console.md), [UI Reference Explorations](/Users/cliff/workspace/Spec2Flow/docs/ui/reference/README.md)

## Rules

- `docs/ui/operator-console.md` is the canonical source for page responsibilities and operator behavior.
- `docs/ui/visual-language.md` is the canonical source for the look and feel.
- `docs/ui/reference/` contains mockups and generated artifacts. These files can inspire implementation, but they do not overrule the canonical docs.
- If a UI behavior becomes real in code, update both the relevant page doc and the React implementation under `packages/web/src/`.
