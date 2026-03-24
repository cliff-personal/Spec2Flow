# Full Implementation Plan

- Status: historical
- Source of truth: `docs/architecture.md`, `docs/usage-guide.md`, `docs/playbooks/index.md`
- Verified with: archived for reference only

## Archive Note

This long-form implementation plan is preserved for history only. The active source of truth has moved into narrower docs, ADRs, and playbooks.

## Goal

Define the complete implementation path for Spec2Flow from documentation bootstrap to a production-ready open workflow framework built around Copilot, Playwright, GitHub Actions, and GitHub Issues.

## Target End State

A complete Spec2Flow implementation should allow a team to:

1. ingest product and technical specifications
2. inspect repository context and changed code
3. generate implementation tasks and validation scope
4. produce structured test plans and test cases
5. execute browser-based validation with Playwright
6. retain artifacts and execution reports
7. draft or publish defect reports into GitHub Issues
8. run the same core workflow locally and in GitHub Actions
9. support repeated use across many external repositories

## Product Capabilities

### Capability 1. Requirements Analysis
Deliverables:
- requirement ingestion contract
- requirement summary schema
- issue-to-summary workflow
- assumptions and open-questions format

Dependency:
- if inputs are missing or inconsistent, trigger environment preparation and template generation first

Implementation details:
- support markdown-based product docs first
- support repository document discovery
- support issue-linked requirement context
- store outputs in a stable structured format

### Capability 2. Code Implementation
Deliverables:
- implementation task schema
- code-change handoff format
- minimal CLI or script entrypoint
- review summary format

Implementation details:
- map requirements to impacted modules
- generate implementation checklists
- keep outputs human-reviewable
- link changes back to requirements and tests

### Capability 3. Test Design
Deliverables:
- test plan schema
- test case schema
- automation suitability field definitions
- examples for smoke, regression, and edge coverage

Implementation details:
- separate smoke coverage from broader regression coverage
- explicitly record risk-based prioritization
- preserve traceability from requirement to test case

### Capability 4. Automated Execution
Deliverables:
- Playwright project setup
- startup scripts for local services
- artifact collection convention
- execution report schema

Implementation details:
- standardize app startup commands
- support environment variable injection
- capture trace, screenshot, console, and video where appropriate
- summarize outputs into a reusable report

### Capability 5. Defect Feedback
Deliverables:
- bug report schema
- bug draft markdown template
- failure-to-bug mapping rules
- evidence reference convention

Implementation details:
- map failed assertions and artifacts into issue-ready content
- keep defect output reviewable before publication
- preserve links to CI run, PR, and source branch

### Capability 6. Collaboration Workflow
Deliverables:
- GitHub Actions workflow definitions
- GitHub Issues templates and labels
- PR validation checklist
- status and artifact linking conventions

Implementation details:
- run the same smoke path locally and in CI
- publish artifact links for failures
- keep issue, PR, and run records connected
- define minimal team operating rules

### Capability 7. Environment Preparation And Template Generation
Deliverables:
- repository scan report
- generated `.spec2flow/` config templates
- generated docs and bug templates
- onboarding gap report

Implementation details:
- detect missing docs, scripts, tests, and CI entrypoints
- generate the minimum maintainable configuration set
- keep generated outputs small and human-readable
- require human confirmation only for truly ambiguous facts

### Capability 8. Model And Agent Runtime Abstraction
Deliverables:
- provider adapter interface
- capability negotiation schema
- multi-agent controller contract
- provider-specific adapters such as Copilot and OpenClaw

Implementation details:
- separate workflow contracts from model providers
- support provider-specific feature downgrades
- keep execution state outside model sessions
- support controller-plus-specialist multi-agent orchestration

## Architecture Delivery Plan

### Layer 1. Domain Contracts
Build first:
- `schemas/requirement-summary.schema.json`
- `schemas/implementation-task.schema.json`
- `schemas/test-plan.schema.json`
- `schemas/test-case.schema.json`
- `schemas/execution-report.schema.json`
- `schemas/bug-report.schema.json`
- `schemas/model-adapter-capability.schema.json`

Why this comes first:
- every later workflow depends on stable artifact shapes
- prompts, scripts, reporters, and examples become easier to evolve safely

### Layer 2. Environment Preparation Generator
Build second:
- repository scanner
- onboarding gap reporter
- minimal template generator

Why this comes second:
- many real repositories will not start with clean inputs
- automation needs a stable config baseline before planning and execution

### Layer 3. Reference Examples
Build second:
- sample spec
- sample requirement summary
- sample implementation tasks
- sample test plan
- sample test cases
- sample execution report
- sample bug draft

Why this comes second:
- examples prove the contracts are usable
- contributors can reason about the workflow before code exists

### Layer 4. Local Execution Runtime
Build fourth:
- Playwright config
- browser smoke tests
- `scripts/start-service.sh`
- `scripts/run-smoke.sh`
- `scripts/collect-artifacts.sh`

Why this comes third:
- execution is the first place where the framework proves practical value
- defect feedback depends on consistent evidence capture

### Layer 5. Reporting And Defect Drafting
Build fifth:
- execution report generator
- failed-run to bug-draft transformer
- markdown renderer for issue-ready bug reports

Why this comes fourth:
- structured execution results must exist before reliable bug drafting can exist

### Layer 6. GitHub Integration
Build sixth:
- `.github/workflows/ci.yml`
- `.github/workflows/playwright.yml`
- issue templates
- pull request checklist

Why this comes fifth:
- local workflow should be stable before CI hardens it
- issue and review conventions should build on existing report formats

### Layer 7. Reusable External Project Integration
Build seventh:
- reusable configuration format for external repos
- onboarding guide for external adopters
- example adapter conventions for startup command and base URL
- example integration repository

Why this comes sixth:
- reuse only works once the internal workflow contract is stable

### Layer 8. Multi-Model And Multi-Agent Runtime
Build eighth:
- provider adapters
- capability negotiation
- controller agent
- specialist agent contracts

Why this comes eighth:
- it keeps workflow logic portable across model providers
- it prepares the framework for OpenClaw and future runtimes

## Implementation Phases

### Phase 1. Foundation
Scope:
- schemas
- environment preparation contracts
- documentation alignment

Exit criteria:
- all core artifacts have schemas
- every core artifact has at least one example
- documentation consistently reflects the six-stage workflow

### Phase 2. Local MVP Runtime
Scope:
- repository scanning and template generation
- Playwright baseline
- startup scripts
- local smoke execution
- artifact capture

Exit criteria:
- a sample project can be started locally
- at least one smoke test runs end-to-end
- failures preserve enough evidence for bug drafting

### Phase 3. Reporting And Feedback
Scope:
- execution report generation
- bug draft generation
- issue-ready markdown format

Exit criteria:
- a failed run can produce a structured report
- the report can be transformed into a reviewable bug draft

### Phase 4. GitHub Workflow Integration
Scope:
- Actions workflows
- issue templates
- PR validation conventions

Exit criteria:
- smoke tests run in CI
- artifacts are uploaded on failure
- issue and PR conventions are documented and usable

### Phase 5. External Adoption Path
Scope:
- reusable configuration
- onboarding documentation
- example external integration

Exit criteria:
- another repository can adopt Spec2Flow without editing core framework assumptions

### Phase 6. Multi-Provider Runtime
Scope:
- model adapter interface
- OpenClaw readiness
- multi-agent controller

Exit criteria:
- the same workflow contracts run through more than one provider adapter
- multi-agent orchestration works without provider-specific workflow rewrites

### Phase 7. Production Hardening
Scope:
- reliability
- versioning
- upgrade guidance
- contributor workflows

Exit criteria:
- contracts are versioned
- breaking changes are documented
- adopters can upgrade with predictable migration steps

## Suggested Repository Deliverables

### Core Framework Docs
- workflow overview
- architecture
- MVP scope
- complete implementation plan
- usage guide for adopters

### Contracts
- JSON schemas for every artifact
- field definitions and examples

### Runtime
- Playwright configuration
- execution scripts
- artifact directories

### GitHub Integration
- workflows
- issue templates
- PR templates or checklists

### Demonstrations
- sample spec
- sample outputs
- example failed run to bug draft

## Delivery Backlog

### P0
- define all schemas
- define environment preparation outputs
- add all example outputs
- bootstrap Playwright
- define local startup and artifact paths

### P1
- generate execution reports
- generate bug drafts
- add GitHub Actions workflows
- add GitHub Issues templates
- add repository scanner and template generator

### P2
- package reusable CLI entrypoints
- support external-project configuration file
- provide starter integration templates
- add model adapter interface

### P3
- support multiple execution profiles
- support richer regression orchestration
- support OpenClaw and other providers through adapters
- support multi-agent controller policies

## Risks And Controls

### Risk 1. Schema Drift
Control:
- version schemas from the beginning
- keep examples beside schemas

### Risk 2. Fragile Browser Automation
Control:
- keep smoke scope narrow
- prefer deterministic selectors and flows

### Risk 3. CI-Only Behavior Differences
Control:
- ensure local and CI commands share the same entrypoints
- minimize hidden CI setup assumptions

### Risk 4. Low-Quality Bug Drafts
Control:
- require execution evidence links
- standardize expected and actual result fields

### Risk 5. Hard Adoption For External Teams
Control:
- make onboarding config explicit
- avoid repository-specific assumptions in core docs and scripts

## Definition Of Complete

Spec2Flow can be considered fully implemented when:

- the six workflow stages each have stable contracts and examples
- the framework can run a real smoke path locally and in GitHub Actions
- failed runs can be converted into issue-ready bug drafts
- an external repository can adopt the workflow with documented setup only
- contributors can understand, run, and extend the framework from documentation alone