# Spec

## Task

Planning onboarding: planning_bundle

## Problem

- 当前问题是什么？

## Goal

- 这次变更要达成什么结果？

## Non-Goals

- 这次不解决什么？

## Acceptance Criteria

- [ ] 有明确可验证的功能结果
- [ ] 有对应 docs / code / tests 同步要求
- [ ] 验收标准可被测试或命令验证

## Onboarding Inputs
- state file: `.agents-memory/onboarding-state.json`

```json
[
  {
    "name": "Core",
    "status": "HEALTHY",
    "summary": "Core status=HEALTHY (ok=7, warn=0, fail=0, info=0)",
    "checks": [
      {
        "status": "OK",
        "key": "registry",
        "detail": "registered as 'spec2flow'"
      },
      {
        "status": "OK",
        "key": "active",
        "detail": "active=true"
      },
      {
        "status": "OK",
        "key": "root",
        "detail": "."
      },
      {
        "status": "OK",
        "key": "python3.12",
        "detail": "/opt/homebrew/bin/python3.12"
      },
      {
        "status": "OK",
        "key": "mcp_package",
        "detail": "mcp import OK"
      },
      {
        "status": "OK",
        "key": "profile_manifest",
        "detail": "applied profile 'python-service'"
      },
      {
        "status": "OK",
        "key": "profile_consistency",
        "detail": "profile 'python-service' consistency OK"
      }
    ]
  },
  {
    "name": "Planning",
    "status": "HEALTHY",
    "summary": "Planning status=HEALTHY (ok=2, warn=0, fail=0, info=0)",
    "checks": [
      {
        "status": "OK",
        "key": "planning_root",
        "detail": "present: ./docs/plans"
      },
      {
        "status": "OK",
        "key": "planning_bundle",
        "detail": "4 planning bundle(s) passed plan-check"
      }
    ]
  },
  {
    "name": "Integration",
    "status": "HEALTHY",
    "summary": "Integration status=HEALTHY (ok=2, warn=0, fail=0, info=0)",
    "checks": [
      {
        "status": "OK",
        "key": "bridge_instruction",
        "detail": "./.github/instructions/agents-memory-bridge.instructions.md"
      },
      {
        "status": "OK",
        "key": "mcp_config",
        "detail": "agents-memory server configured -> ./.vscode/mcp.json"
      }
    ]
  },
  {
    "name": "Optional",
    "status": "WATCH",
    "summary": "Optional status=WATCH (ok=2, warn=5, fail=0, info=0)",
    "checks": [
      {
        "status": "OK",
        "key": "copilot_activation",
        "detail": "Agents-Memory activation block present -> ./.github/copilot-instructions.md"
      },
      {
        "status": "OK",
        "key": "agents_read_order",
        "detail": "AGENTS.md references current bridge and 8 managed standard(s)"
      },
      {
        "status": "WARN",
        "key": "refactor_watch",
        "detail": "Synapse-Network/.spec2flow/worktrees/synapse-network-workflow-1774571039585/.github/prompts/ui-ux-pro-max/scripts/design_system.py::format_master_md high complexity (lines=228>40, branches=12>5, locals=12>8, nesting=3)"
      },
      {
        "status": "WARN",
        "key": "refactor_watch",
        "detail": "Synapse-Network/.spec2flow/worktrees/synapse-network-workflow-1774571039585/.github/prompts/ui-ux-pro-max/scripts/design_system.py::_generate_intelligent_overrides high complexity (lines=80>40, branches=13>5, locals=31>8, nesting=3)"
      },
      {
        "status": "WARN",
        "key": "refactor_watch",
        "detail": ".github/prompts/ui-ux-pro-max/scripts/design_system.py::format_master_md high complexity (lines=228>40, branches=12>5, locals=12>8, nesting=3)"
      },
      {
        "status": "WARN",
        "key": "refactor_watch",
        "detail": ".github/prompts/ui-ux-pro-max/scripts/design_system.py::_generate_intelligent_overrides high complexity (lines=80>40, branches=13>5, locals=31>8, nesting=3)"
      },
      {
        "status": "WARN",
        "key": "refactor_watch",
        "detail": ".github/prompts/ui-ux-pro-max/scripts/design_system.py::DesignSystemGenerator._select_best_match high complexity (branches=10>5, nesting=5>=4, locals=9>8)"
      }
    ]
  }
]
```
