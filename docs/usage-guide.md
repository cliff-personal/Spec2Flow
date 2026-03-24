# Usage Guide

- Status: active
- Source of truth: `package.json`, `docs/examples/synapse-network/README.md`, `docs/playbooks/index.md`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`, `npm run validate:synapse-example`

## Goal

Explain how another project can adopt the Spec2Flow workflow using repository config, adapter-backed agents, deterministic execution, and collaboration tooling.

## Who This Is For

This guide is for teams that already have an application repository and want to use Spec2Flow as their requirements-to-execution workflow.

Typical adopters:
- product teams with web applications
- solo developers who want repeatable smoke validation
- QA or engineering teams that want issue-ready defect feedback

## What External Projects Need

Before adopting Spec2Flow, an external project should already have:

- a Git repository
- markdown-based requirements or design docs
- a runnable local application or test environment
- a GitHub repository with Actions enabled
- a willingness to review generated tasks, tests, and bug drafts

If the external project does not already have standardized docs, startup scripts, or workflow configs, Spec2Flow should first run an **environment preparation** step to generate the minimum onboarding templates.

## Adoption Model

An external project uses Spec2Flow as an orchestrated workflow. At a high level:

### 1. Provide Inputs
The project supplies:
- product requirements
- design notes
- repository context
- startup commands
- target URLs or environments

### 2. Generate Structured Outputs
Spec2Flow generates:
- requirement summaries
- implementation tasks
- test plans
- test cases
- execution reports
- bug drafts

### 3. Run Automated Validation
The project uses repository-native validation commands and Playwright when browser validation is needed.

### 4. Publish Team Signals
The project uses GitHub Actions and GitHub Issues to publish run status, artifacts, and defect follow-up.

The execution boundary should stay explicit:

- Spec2Flow orchestrates runs, task graphs, execution state, and artifacts
- an external adapter maps one claimed task into a task-scoped agent runtime
- deterministic executors handle startup, validation, and evidence capture

## Runtime Loop

The minimal runtime loop in an adopting repository is:

1. generate `task-graph.json` from requirement text, requirement file, or change scope
2. initialize `execution-state.json`
3. claim the next ready `taskId`
4. send the emitted claim payload to the external adapter
5. apply deterministic edits or command execution
6. submit the task result back into Spec2Flow state
7. repeat until the run is completed, blocked, or failed

For early adoption or integration testing, `simulate-model-run` can stand in for a real provider adapter so the team can validate controller behavior before wiring Copilot or another API.

Once that works, the next step is to add a `model-adapter-runtime.json` file and point `run-task-with-adapter` or `run-workflow-loop --adapter-runtime ...` at a real external adapter command.

For controller-safe stages, Spec2Flow now also has a deterministic path. `run-deterministic-task` can execute a claimed `environment-preparation` or `automated-execution` task directly, run the declared verification commands, and write schema-backed report artifacts without going through an external provider.

The repository's self-dogfood runtime for that path lives at `.spec2flow/model-adapter-runtime.deterministic.json`.

If one workflow needs both deterministic and provider-backed stages, keep one top-level runtime file and use `adapterRuntime.stageRuntimeRefs` to delegate specific stages. The repository's `.spec2flow/model-adapter-runtime.json` now does exactly that: it keeps Copilot CLI as the default runtime while routing `environment-preparation` and `automated-execution` to `.spec2flow/model-adapter-runtime.deterministic.json`.

Runtime configuration details now live in [docs/runtime-config-reference.md](runtime-config-reference.md).

Use that reference for:

- top-level `adapterRuntime` field meanings
- bundled Copilot runtime defaults
- session reuse and persistence overrides
- environment variable semantics
- controller-injected internal wiring versus real user-facing override points

For requirement-driven execution, the most direct entrypoint is:

```bash
npm run spec2flow -- generate-task-graph \
  --project .spec2flow/project.yaml \
  --topology .spec2flow/topology.yaml \
  --risk .spec2flow/policies/risk.yaml \
  --requirement "Describe the feature request here" \
  --output .spec2flow/task-graph.requirement.json
```

When `--requirement` or `--requirement-file` is provided, Spec2Flow selects matching workflow routes first and only falls back to all routes if no route signals match the request.

That adapter command can be a thin wrapper around Copilot CLI, OpenAI, Azure OpenAI, Claude, or an internal agent platform. Spec2Flow does not need to know those provider details as long as the command returns one normalized JSON result.

The bundled example adapter in this repository now uses GitHub Copilot CLI via `gh copilot -p`.

To use it:

1. install Copilot CLI or ensure `gh copilot` can download and run it
2. run `gh copilot login`
3. verify auth with `gh auth status`
4. optionally set `adapterRuntime.model` in `model-adapter-runtime.json` to pin a model that your Copilot CLI account can actually use

If you do not set `adapterRuntime.model`, the adapter will let Copilot CLI choose its default model. This is the safest default because model availability differs by account and plan.

Run a preflight before the first workflow execution:

```bash
npm run spec2flow -- preflight-copilot-cli \
  --adapter-runtime docs/examples/synapse-network/model-adapter-runtime.json
```

The preflight confirms command availability, authentication, and that `gh copilot -p` can complete a minimal JSON probe with the configured model or the account default.

For Copilot-backed adapter runs, Spec2Flow executes that preflight automatically before `run-task-with-adapter` and `run-workflow-loop`.

Use `--skip-preflight` only when you intentionally want to bypass the guardrail, for example while debugging the adapter itself.

Spec2Flow still keeps workflow state in `execution-state.json`, not inside any provider chat history. The adapter may reuse provider sessions, but the session is never the workflow truth source.

The bundled Copilot adapter can optionally reuse Copilot CLI sessions with `--resume` when the runtime supplies a stable session key.

The bundled runtime now defaults to `specialistSessionKey`, which scopes sessions by specialist agent name such as `requirements-agent`, `implementation-agent`, or `defect-agent`. That keeps useful continuity for one responsibility without creating a new session every time a new workflow run starts.

The bundled adapter uses cleanup-safe session persistence by default. No extra runtime setting is required:

- stable single-role keys such as `requirements-agent` are persisted and reused
- dynamic multi-part keys such as `runId + route + executorType` are canonicalized back to the stable specialist session by default, so older runtime configs do not keep spawning new task sessions
- successful Copilot preflight checks are cached for a short window, so repeated runs against the same runtime do not keep creating identical probe sessions
- old dynamic session files can be consolidated with `npm run migrate:copilot-sessions`

Leave the default unchanged unless you have a concrete isolation requirement. Override the session key only when the default specialist-scoped reuse is not the behavior you want.

If you do need an override, the available session scopes and env semantics are documented in [docs/runtime-config-reference.md](runtime-config-reference.md).

After that, `run-workflow-loop` can act as the first autonomous controller loop for local rehearsals, integration tests, and eventually provider-backed execution. For deterministic stages, the same loop can now point at a runtime that dispatches into `run-deterministic-task` instead of an external provider adapter.

In practical terms, one feature request becomes one workflow run identified by `runId`, and that run contains many `taskId` values.

## Platform Persistence Bootstrap

Spec2Flow now also includes the first PostgreSQL-backed platform persistence slice for Phase 1 work.

The new commands are:

- `migrate-platform-db`: apply the platform schema migrations
- `init-platform-run`: persist one repository, one run, its tasks, initial events, and task-graph artifact metadata into PostgreSQL

Example bootstrap flow:

```bash
npm run migrate:platform-db -- \
  --database-url postgresql://synapse:12345678@127.0.0.1:5432/synapse_gateway \
  --database-schema spec2flow_platform

npm run init:platform-run -- \
  --database-url postgresql://synapse:12345678@127.0.0.1:5432/synapse_gateway \
  --database-schema spec2flow_platform \
  --task-graph docs/examples/synapse-network/generated/task-graph.json \
  --repository-id spec2flow \
  --repository-name Spec2Flow \
  --repo-root .
```

This persistence layer does not replace `task-graph.json` or `execution-state.json` yet.
It establishes the first shared runtime truth for:

- `repositories`
- `runs`
- `tasks`
- `task_attempts`
- `artifacts`
- `events`
- `review_gates`
- `publications`

## Recommended Integration Layout

Another repository does not need to copy the entire Spec2Flow repository structure.

The minimal recommended layout is:

```text
your-project/
├─ docs/
│  ├─ requirements/
│  ├─ design/
│  └─ testing/
├─ playwright/
│  ├─ tests/
│  └─ playwright.config.ts
├─ scripts/
│  ├─ start-service.sh
│  ├─ run-smoke.sh
│  └─ collect-artifacts.sh
├─ .github/
│  ├─ ISSUE_TEMPLATE/
│  └─ workflows/
└─ spec2flow/
   ├─ outputs/
   │  ├─ requirements/
   │  ├─ test-plans/
   │  ├─ execution/
   │  └─ bugs/
   └─ config/
      └─ project.yaml
```

## Suggested Project Configuration

Each adopting project should define a small configuration file that answers these questions:

- where the requirement docs live
- how to start the application
- what base URL to test
- where Playwright artifacts should be stored
- which smoke flows are critical
- which labels should be applied to bug issues

A practical configuration shape can include:

```yaml
project:
  name: sample-app
requirements:
  paths:
    - docs/requirements
    - docs/design
runtime:
  install: npm install
  start: ./scripts/start-service.sh
  baseUrl: http://localhost:3000
testing:
  smokeSuite: playwright/tests/smoke
  artifactsDir: spec2flow/outputs/execution
reporting:
  bugDraftDir: spec2flow/outputs/bugs
  issueLabels:
    - type:defect
    - area:execution
```

## External Project Onboarding Steps

### Step 0. Run Environment Preparation
- scan the repository structure
- detect existing docs, startup commands, tests, and CI
- generate the minimum `.spec2flow/` templates
- produce a gap report for missing inputs that still need human confirmation

### Step 1. Organize Inputs
- keep requirements and design docs in markdown
- make sure the application can start with one clear command
- identify the critical smoke flow to automate first

### Step 2. Confirm Or Adjust Generated Templates
- confirm project topology
- confirm service startup commands
- confirm risk policy and workflow definitions

### Step 3. Add Local Execution Hooks
- create `scripts/start-service.sh`
- create `scripts/run-smoke.sh`
- decide where screenshots, traces, and logs will be stored

### Step 4. Add Playwright
- install Playwright in the target repository
- configure one smoke test for the most important user path
- confirm failures collect evidence consistently

### Step 5. Add GitHub Workflow Files
- add a workflow to install dependencies
- add a workflow to start the app
- add a workflow to run Playwright
- upload artifacts on failure

### Step 6. Add GitHub Issue Workflow
- add a bug issue template
- define labels for severity, area, and type
- define who reviews draft defects before issue publication

### Step 7. Start Using The Workflow
- summarize a requirement with Copilot
- derive implementation tasks
- generate test design
- run Playwright locally
- run the same smoke path in CI
- convert failures into issue-ready bug drafts

## Day-To-Day Usage

### Feature Work
1. Create or update a GitHub Issue with the requirement.
2. Use an adapter-backed agent to summarize the requirement and impacted modules.
3. Use an adapter-backed agent to generate implementation tasks and validation scope.
4. Implement the change.
5. Generate or update the smoke and regression cases.
6. Run Playwright locally.
7. Open a pull request with validation notes.
8. Let GitHub Actions rerun the smoke path.

### Bug Investigation
1. Reproduce the issue locally or in CI.
2. Capture screenshot, trace, logs, and failing assertion.
3. Convert evidence into a structured bug draft.
4. Review the draft.
5. Publish it to GitHub Issues.
6. Link the issue to the failing run and the fixing PR.

### Regression Review
1. Identify the changed feature area.
2. Regenerate risk-based test scope if needed.
3. Run smoke coverage first.
4. Expand into focused regression only where risk justifies it.

## Example Operating Model

### Product Manager Or Tech Lead
- writes or curates requirements
- reviews summaries and assumptions

### Engineer
- uses Copilot for implementation planning and code changes
- runs Playwright locally before PR updates

### Reviewer
- checks code, validation notes, and artifacts
- confirms failures are turned into proper defect records

### Maintainer
- keeps GitHub Actions, templates, and workflow conventions healthy

## Integration Rules

When using Spec2Flow in another project, keep these rules:

- do not skip requirement summarization for non-trivial work
- do not skip environment preparation when repository conventions are missing
- do not treat generated bug drafts as auto-publishable truth
- keep local and CI execution paths aligned
- automate only the flows that are stable enough to maintain
- keep outputs in a repository-visible location

## Minimal Success Criteria For Adopters

An external project is successfully using Spec2Flow when:

- at least one critical requirement can be summarized and traced to implementation tasks
- at least one smoke flow runs with Playwright locally and in CI
- failed runs produce usable evidence
- bug drafts can be reviewed and published to GitHub Issues

## Common Mistakes

### Mistake 1. Starting With Too Much Automation
Fix:
- automate one stable smoke path first

### Mistake 2. No Stable Startup Command
Fix:
- normalize local startup into a single script entrypoint

### Mistake 3. Weak Bug Evidence
Fix:
- require trace, screenshot, and exact expected versus actual result

### Mistake 4. CI And Local Runs Behave Differently
Fix:
- reuse the same scripts and environment assumptions in both places

### Mistake 5. No Traceability
Fix:
- link requirements, PRs, CI runs, and issues explicitly

## Recommended First Adoption Milestone

For an external team, the first realistic milestone is:

1. choose one feature area
2. summarize one requirement
3. generate one implementation task list
4. automate one smoke flow with Playwright
5. run it in GitHub Actions
6. prove one failed run can become a GitHub Issue draft

Once that works, expand gradually instead of trying to automate the whole product at once.
