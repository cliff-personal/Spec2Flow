# Runtime Configuration Reference

- Status: active
- Source of truth: `.spec2flow/model-adapter-runtime.json`, `docs/examples/synapse-network/model-adapter-runtime.json`, `packages/cli/src/adapters/`, `schemas/model-adapter-runtime.schema.json`
- Verified with: `npm run build`, `npm run test:unit`, `npm run validate:docs`

## Goal

Keep one stable reference for `model-adapter-runtime.json` so runtime wiring, provider overrides, session policy, and controller-injected environment variables do not drift across multiple docs.

## What This Document Covers

- top-level `adapterRuntime` fields
- bundled Copilot runtime defaults
- deterministic stage delegation through `stageRuntimeRefs`
- environment variables used by the bundled runtimes
- which fields should usually stay unchanged
- which fields are normal override points

## Runtime Contract Shape

`model-adapter-runtime.json` tells Spec2Flow how to execute one claimed task through an external adapter command or a delegated deterministic runtime.

Minimal shape:

```json
{
  "adapterRuntime": {
    "name": "github-copilot-cli-adapter",
    "provider": "github-copilot-cli",
    "command": "node",
    "args": [
      "docs/examples/synapse-network/example-command-adapter.mjs",
      "--claim",
      "${claimPath}"
    ],
    "outputMode": "stdout"
  }
}
```

## Minimal Working Runtime Example

Use this as the smallest practical starting point when a repository wants one provider-backed runtime without stage-specific delegation:

```json
{
  "adapterRuntime": {
    "name": "github-copilot-cli-adapter",
    "provider": "github-copilot-cli",
    "model": "gpt-5.4",
    "command": "node",
    "args": [
      "docs/examples/synapse-network/example-command-adapter.mjs",
      "--claim",
      "${claimPath}"
    ],
    "cwd": ".",
    "env": {
      "SPEC2FLOW_COPILOT_CWD": ".",
      "SPEC2FLOW_COPILOT_SESSION_KEY": "${specialistSessionKey}",
      "SPEC2FLOW_COPILOT_SESSION_DIR": ".spec2flow/runtime/copilot-sessions",
      "SPEC2FLOW_STATE": "${statePath}",
      "SPEC2FLOW_TASK_GRAPH": "${taskGraphPath}",
      "SPEC2FLOW_TASK_ID": "${taskId}",
      "SPEC2FLOW_RUN_ID": "${runId}"
    },
    "timeoutMs": 1200000,
    "outputMode": "stdout"
  }
}
```

Keep this version simple first. Add `stageRuntimeRefs`, permission flags, or persistence overrides only when the repository actually needs them.

## Top-Level Field Reference

### `adapterRuntime.name`

Human-readable runtime id used in logs, receipts, and debugging output.

Default guidance:
- keep it stable
- change it only when you are intentionally defining a different runtime identity

### `adapterRuntime.provider`

Declares which provider-specific policy and preflight path apply.

Common values in this repository:
- `github-copilot-cli`
- `spec2flow-deterministic`

Default guidance:
- do not change this unless the adapter command is really targeting a different provider surface

### `adapterRuntime.model`

Optional model pin for provider-backed runtimes.

Default guidance:
- leave unset if provider default selection is safer for the target account
- set it only when you need a fixed model such as `gpt-5.4`

### `adapterRuntime.command`

Executable that Spec2Flow launches.

Bundled examples use:
- `node`

Default guidance:
- change this only when the adapter is launched through a different executable

### `adapterRuntime.args`

Arguments passed to the command.

Bundled Copilot runtime uses:
- adapter script path
- `--claim`
- `${claimPath}`

Default guidance:
- treat this as the adapter entry contract
- change it only when the external adapter command surface changes

### `adapterRuntime.cwd`

Working directory for the adapter process.

Default guidance:
- keep this explicit when the adapter depends on relative paths
- if omitted, ensure the adapter command is still correct from the calling directory

### `adapterRuntime.env`

Template-expanded environment variables passed into the adapter process.

This is the main override surface for:
- provider behavior
- session reuse scope
- controller-to-adapter path wiring
- permission flags

Default guidance:
- do not treat all env keys as user-tunable
- some are normal override points and some are controller-owned internal wiring

### `adapterRuntime.timeoutMs`

Maximum execution time for one claimed task.

Default guidance:
- keep the default unless a real task class routinely exceeds it
- increase only with a concrete execution need

### `adapterRuntime.outputMode`

How the adapter returns its normalized result.

Bundled runtimes use:
- `stdout`

Default guidance:
- leave unchanged unless the adapter contract changes

### `adapterRuntime.stageRuntimeRefs`

Optional per-stage runtime overrides.

This lets one top-level runtime file delegate selected stages to another runtime file.

Bundled self-dogfood runtime uses this for:
- `environment-preparation`
- `automated-execution`

Default guidance:
- use this only when some stages should bypass the default provider runtime
- keep one top-level runtime file as the main loop entrypoint

## Bundled Runtime Defaults

The repository's default self-dogfood runtime is `.spec2flow/model-adapter-runtime.json`.

Its operating model is:
- provider-backed by default through Copilot CLI
- deterministic override for `environment-preparation`
- deterministic override for `automated-execution`
- specialist-scoped session reuse by default
- cleanup-safe session persistence by default
- file writes and test runs allowed
- git write side effects disabled
- PR creation disabled

The example runtime at `docs/examples/synapse-network/model-adapter-runtime.json` is intentionally smaller. It demonstrates the external adapter contract without carrying the repository's full self-dogfood permission surface.

## Bundled Runtime Comparison

Use the self-dogfood runtime at `.spec2flow/model-adapter-runtime.json` when you want the repository's full operating model:
- deterministic delegation for `environment-preparation` and `automated-execution`
- repository policy flags for writes, test runs, git writes, and PR creation
- the exact runtime shape used by Spec2Flow to dogfood itself

Use the example runtime at `docs/examples/synapse-network/model-adapter-runtime.json` when you want a smaller adoption template:
- one provider-backed runtime without the full self-dogfood policy surface
- clearer starting material for another repository to copy and simplify
- fewer repository-specific defaults to explain or remove

## Environment Variable Reference

Environment keys fall into three categories:

1. provider configuration
2. session configuration
3. controller-injected internal wiring

## Provider Configuration

### `SPEC2FLOW_COPILOT_MODEL`

Effective model passed into the adapter.

Default guidance:
- prefer setting `adapterRuntime.model`
- do not usually edit this env directly in repository runtimes

### `SPEC2FLOW_COPILOT_ADAPTER_NAME`

Optional adapter display-name override.

Default guidance:
- leave unset unless you need to distinguish multiple similar adapter wrappers in receipts or logs

### `SPEC2FLOW_COPILOT_CWD`

Working directory that Copilot CLI should use.

Default guidance:
- keep aligned with `adapterRuntime.cwd`
- override only when the adapter must run against a different repository root

## Session Configuration

### `SPEC2FLOW_COPILOT_SESSION_KEY`

Declares the session reuse scope.

Bundled default:
- `${specialistSessionKey}`

What that means:
- one durable session per specialist agent name
- `requirements-agent`, `implementation-agent`, `test-design-agent`, `execution-agent`, `defect-agent`, and `collaboration-agent` reuse their own stable session identities

Default guidance:
- keep the bundled default unless you have a concrete isolation requirement

Override choices exposed by the adapter template context:
- `${specialistSessionKey}`
- `${runSessionKey}`
- `${routeSessionKey}`
- `${stageSessionKey}`
- `${executorSessionKey}`
- `${routeExecutorSessionKey}`
- `${taskSessionKey}`

Use them this way:
- `${specialistSessionKey}`: built-in default and correct for most repositories
- `${executorSessionKey}`: use when run-scoped specialist isolation matters more than continuity
- `${routeExecutorSessionKey}`: use when route-level isolation matters more than reuse
- `${taskSessionKey}`: use only when maximum isolation is worth the extra session churn

### `SPEC2FLOW_COPILOT_SESSION_ID`

Explicit session id override.

Default guidance:
- leave unset for normal operation
- use only when you intentionally want to attach the adapter to one already-known provider session id

### `SPEC2FLOW_COPILOT_SESSION_DIR`

Directory where durable session records are stored.

Bundled default:
- `.spec2flow/runtime/copilot-sessions`

Default guidance:
- keep it stable so cleanup and migration tooling can find it
- change it only when you intentionally relocate the session store

### `SPEC2FLOW_COPILOT_SESSION_PERSIST_MODE`

Optional persistence-policy override.

Built-in default behavior:
- no explicit env is required
- stable specialist keys persist
- dynamic multi-part keys are ephemeral

Override guidance:
- do not set this for normal operation
- set `always` only when you explicitly want durable dynamic keys
- set `never` only when you explicitly want all session records suppressed

## Controller-Injected Internal Wiring

These variables are controller-owned. They are not normal business-facing configuration knobs.

### `SPEC2FLOW_STATE`

Path to the active `execution-state.json` for the claimed task.

### `SPEC2FLOW_TASK_GRAPH`

Path to the active `task-graph.json` for the claimed task.

### `SPEC2FLOW_TASK_ID`

Current claimed task id.

### `SPEC2FLOW_RUN_ID`

Current workflow run id.

Default guidance for all four:
- do not hard-code them by hand in normal runtime authoring
- let Spec2Flow inject them from `${statePath}`, `${taskGraphPath}`, `${taskId}`, and `${runId}`

## Permission Flags In The Bundled Self-Dogfood Runtime

These flags are repository-policy controls, not generic provider settings.

### `SPEC2FLOW_ALLOW_FILE_WRITES`

Whether the adapter may edit repository files.

Bundled default:
- `true`

Use this when:
- code or test stages are expected to write files

### `SPEC2FLOW_ALLOW_TEST_RUNS`

Whether the adapter may execute repository validation commands.

Bundled default:
- `true`

Use this when:
- the runtime is allowed to run controller-approved validation commands

### `SPEC2FLOW_ALLOW_GIT_WRITE`

Whether the adapter may perform write-side git actions.

Bundled default:
- `false`

Default guidance:
- keep `false` unless the repository explicitly wants adapters to create commits or similar side effects

### `SPEC2FLOW_ALLOW_PR_CREATE`

Whether the adapter may create pull requests directly.

Bundled default:
- `false`

Default guidance:
- keep `false` unless the repository explicitly wants runtime-side PR creation

## Where To Change What

Use this rule of thumb:

- change `adapterRuntime.model` when you want a different model
- change `SPEC2FLOW_COPILOT_SESSION_KEY` only when you want a different reuse scope
- add `SPEC2FLOW_COPILOT_SESSION_PERSIST_MODE` only when you want to override the built-in cleanup-safe default
- change `stageRuntimeRefs` when some stages should use a different runtime implementation
- change permission flags only when the repository's automation policy changes
- leave controller-injected path variables alone

## Related Docs

- [docs/usage-guide.md](usage-guide.md)
- [docs/architecture.md](architecture.md)
- [docs/examples/synapse-network/README.md](examples/synapse-network/README.md)
- [schemas/model-adapter-runtime.schema.json](../schemas/model-adapter-runtime.schema.json)
