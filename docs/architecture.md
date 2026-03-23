# Architecture Overview

Spec2Flow is organized around a six-stage workflow implemented through three cooperating layers.

## Workflow Stages

1. Requirements analysis
2. Code implementation
3. Test design
4. Automated execution
5. Defect feedback
6. Collaboration workflow

## 1. Copilot Workflow Layer
This layer is responsible for the stages where human intent and repository context need interpretation.

Responsibilities:
- analyze specs and repository context
- generate implementation tasks
- support code changes and reviews
- design test plans and test cases
- interpret failed runs
- draft bug reports

Primary tool:
- Copilot

Primary outputs:
- requirement summaries
- implementation checklists
- test plans
- test cases
- bug drafts

## 2. Execution Layer
This layer is responsible for deterministic automation against a real or test environment.

Responsibilities:
- start services or test environments
- execute Playwright tests
- collect screenshots, traces, logs, and videos
- summarize execution output in a reusable format

Primary tool:
- Playwright

Primary outputs:
- execution reports
- artifacts
- pass/fail summaries

## 3. Collaboration Layer
This layer makes the workflow repeatable and reviewable across contributors.

Responsibilities:
- run validation in CI
- preserve execution artifacts
- create visibility through pull requests and issue updates
- route approved bug drafts into GitHub Issues
- keep implementation and validation history discoverable

Primary tools:
- GitHub Actions
- GitHub Issues

Primary outputs:
- CI runs
- artifact links
- issue records
- review history

## Design Principle

Copilot should decide what needs to change and what needs to be tested.
Playwright should deterministically handle how flows are executed.
GitHub Actions and GitHub Issues should ensure the process is reviewable, repeatable, and collaborative.

## Stage-to-Tool Mapping

### Requirements Analysis
- primary tool: Copilot
- inputs: specs, design docs, repository context
- outputs: summaries, assumptions, task list

### Code Implementation
- primary tool: Copilot
- inputs: approved requirements and target modules
- outputs: code changes, implementation notes, PR summary

### Test Design
- primary tool: Copilot
- inputs: requirements, changed code, risk areas
- outputs: test plan, test cases, smoke scope

### Automated Execution
- primary tool: Playwright
- inputs: runnable app, test cases, startup commands
- outputs: run results, traces, screenshots, logs

### Defect Feedback
- primary tools: Copilot and GitHub Issues
- inputs: failed execution reports and artifacts
- outputs: reviewable bug drafts and issue-ready content

### Collaboration Workflow
- primary tools: GitHub Actions and GitHub Issues
- inputs: pull requests, CI runs, approved bug drafts
- outputs: shared status, audit trail, triaged issues