# Spec2Flow MVP

- Status: historical
- Source of truth: `README.md`, `docs/architecture.md`, `docs/usage-guide.md`
- Verified with: archived for reference only

## Archive Note

This MVP plan is kept for historical context. Current behavior and workflow expectations now live in the active repository docs and playbooks.

## Objective

Build a practical first version of Spec2Flow that can connect requirements analysis, code implementation support, test design, deterministic execution, defect feedback, and team collaboration into one usable workflow.

## MVP Scope

### 1. Requirements Analysis
Support reading and summarizing:
- product requirement documents
- technical design documents
- markdown docs in the repository
- structured notes provided by the user

Expected outputs:
- requirement summary
- assumptions and constraints
- impacted areas
- implementation checklist

### 2. Code Implementation
Support adapter-backed implementation planning and code generation for:
- repository structure
- key source directories
- routes and pages
- API modules
- integration points

Expected outputs:
- implementation tasks
- change plan
- pull request-ready summary

### 3. Test Design
Generate a structured test design including:
- scope
- critical flows
- risk analysis
- smoke scenarios
- regression scenarios
- edge and error scenarios

### 4. Test Case Generation
Generate structured test cases with fields:
- id
- title
- module
- preconditions
- steps
- expected_result
- priority
- automation_candidate

### 5. Automated Execution
Support configurable startup and execution commands such as:
- npm install
- npm run dev
- npm run start
- docker compose up
- canonical validation commands
- Playwright smoke or targeted regression runs when browser coverage is needed

Execution outputs should include:
- execution summary
- pass/fail status
- screenshots
- logs
- trace artifacts

### 6. Defect Feedback
Generate a bug draft for failed cases including:
- title
- environment
- reproduction steps
- expected result
- actual result
- evidence references
- severity suggestion
- suggested GitHub Issue labels

### 7. Collaboration Workflow
Support a simple collaboration loop based on GitHub-native primitives:
- GitHub Issues for requirement intake and bug tracking
- pull requests for code review
- GitHub Actions for repeatable validation
- artifact links for reviewer feedback

## MVP Tooling

The MVP is intentionally centered on a narrow execution stack:

- **adapter-backed agent runtimes** for requirements analysis, implementation support, and test design
- **repository-native command execution** for deterministic validation
- **Playwright** for browser automation and evidence capture when needed
- **GitHub Actions** for CI execution and artifact publishing
- **GitHub Issues** for bug tracking and workflow coordination

## Out of Scope for MVP

- multi-agent orchestration
- plugin marketplace
- advanced memory systems
- autonomous code fixing loops without review
- enterprise RBAC
- issue tracker integrations beyond GitHub
- broad language or runtime abstraction layers

## MVP Success Criteria

Spec2Flow MVP is successful if it can:

1. Ingest a spec or design doc and repository context
2. Produce a requirement summary and implementation task list
3. Produce a usable test plan and structured test cases
4. Run at least one meaningful validation path, including browser-based smoke coverage when needed
5. Save execution evidence and summarize results
6. Generate at least one bug draft that maps cleanly to a GitHub Issue
7. Run the validation path in GitHub Actions with retained artifacts

## Non-Goals

- replacing all existing QA tooling
- fully autonomous engineering
- handling every project type from day one
- automatic issue filing without human review

## Recommended MVP Deliverables

- aligned README and core docs
- docs for requirement, plan, case, execution, and bug schemas
- sample requirement summary
- sample test plan
- sample test case set
- deterministic execution example
- bug draft template
- GitHub Actions workflow example
- collaboration workflow documentation