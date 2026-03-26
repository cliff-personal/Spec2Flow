# Collaboration Workflow

- Status: active
- Source of truth: `docs/playbooks/collaboration.md`, `docs/usage-guide.md`, `package.json`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`
- Last verified: 2026-03-26

## Goal

Define a simple, reviewable workflow that connects Copilot, Playwright, GitHub Actions, and GitHub Issues.

## Default Workflow

### 1. Requirement Intake
- Capture feature requests, test gaps, and defects in GitHub Issues.
- Link supporting specs, design docs, or screenshots.
- Use Copilot to summarize the issue, assumptions, and impacted areas.

### 2. Implementation Planning
- Turn the approved requirement into an implementation checklist.
- Keep the checklist small enough for reviewable pull requests.
- Record test impact and rollout risk before code changes begin.

### 3. Code Implementation
- Use Copilot to assist with code changes, refactors, and documentation updates.
- Keep commits scoped to a single reviewable objective.
- Require human review before merge.

### 4. Test Design
- Use Copilot to produce smoke, regression, edge, and failure scenarios.
- Mark which cases are suitable for Playwright automation.
- Prefer stable coverage over broad but fragile coverage.

### 5. Automated Execution
- Run Playwright locally before opening or updating a pull request.
- Run the same smoke path in GitHub Actions.
- Upload traces, screenshots, and logs for failed runs.

### 6. Defect Feedback
- Convert failed executions into a bug draft.
- Review the draft before publishing it to GitHub Issues.
- Link the bug back to the source pull request or execution run.

### 7. Review And Closure
- Use pull requests to review implementation quality and validation evidence.
- Use GitHub Issues to track open defects and follow-up work.
- Close the loop by linking merged pull requests, successful runs, and resolved issues.

Controller-side publication is now part of the collaboration closeout path:

- when policy allows, Spec2Flow can create a scoped `spec2flow/...` branch and deterministic commit after the collaboration handoff
- when policy blocks auto-commit or requires approval, Spec2Flow writes a `publication-record` and optional PR draft artifact, then leaves the route blocked for an explicit operator publication action
- when an operator approves publication, Spec2Flow now replays publication through the real orchestration path: push the branch, create a pull request through `gh`, and request merge orchestration before completing the route

## Tool Responsibilities

### Copilot
- analyze requirements
- inspect repository context
- support implementation
- generate test design
- help draft defects

### Playwright
- execute browser flows
- validate expected outcomes
- capture traces and screenshots
- provide deterministic failure evidence

### GitHub Actions
- run validation in a repeatable environment
- publish artifacts
- expose run status to pull requests

### GitHub Issues
- track requirements
- track defects
- preserve team decisions and follow-up actions

## Review Boundaries

Human review is required for:
- merging code changes
- deciding issue priority and severity
- publishing externally visible bug reports
- changing workflow conventions

Remote publication is now inside the automation boundary for explicit operator-approved publication, but merge approval and repository policy still remain governed by the target Git provider and its branch protections.

## Recommended Labels

- `type:feature`
- `type:defect`
- `type:test`
- `area:requirements`
- `area:implementation`
- `area:execution`
- `priority:p0`
- `priority:p1`
- `priority:p2`

## Minimal Working Agreement

For the MVP, the workflow is good enough if:
- every change starts from a tracked requirement or issue
- every pull request includes validation notes
- every failed automated run can produce a reviewable defect draft
- every important defect is visible in GitHub Issues
