# Bootstrap Checklist

- Project: `spec2flow`
- Root: `/Users/cliff/workspace/Spec2Flow`
- Overall: `READY`

## Checklist
- [x] Core - Core status=HEALTHY (ok=7, warn=0, fail=0, info=0)
- [x] Planning - Planning status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [x] Integration - Integration status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [ ] Optional - Optional status=WATCH (ok=2, warn=5, fail=0, info=0)
- [x] Final verification - latest `amem doctor .` already reflects the current healthy state

## Action Sequence
1. Optional (recommended): Refactor flagged functions before adding more behavior, and add a short guiding comment when complex logic must remain in place.
## Group Health
### Core
- Summary: Core status=HEALTHY (ok=7, warn=0, fail=0, info=0)
- [OK] `registry` registered as 'spec2flow'
- [OK] `active` active=true
- [OK] `root` /Users/cliff/workspace/Spec2Flow
- [OK] `python3.12` /opt/homebrew/bin/python3.12
- [OK] `mcp_package` mcp import OK
- [OK] `profile_manifest` applied profile 'python-service'
- [OK] `profile_consistency` profile 'python-service' consistency OK

### Planning
- Summary: Planning status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [OK] `planning_root` present: /Users/cliff/workspace/Spec2Flow/docs/plans
- [OK] `planning_bundle` 4 planning bundle(s) passed plan-check

### Integration
- Summary: Integration status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [OK] `bridge_instruction` /Users/cliff/workspace/Spec2Flow/.github/instructions/agents-memory-bridge.instructions.md
- [OK] `mcp_config` agents-memory server configured -> /Users/cliff/workspace/Spec2Flow/.vscode/mcp.json

### Optional
- Summary: Optional status=WATCH (ok=2, warn=5, fail=0, info=0)
- [OK] `copilot_activation` Agents-Memory activation block present -> /Users/cliff/workspace/Spec2Flow/.github/copilot-instructions.md
- [OK] `agents_read_order` AGENTS.md references current bridge and 8 managed standard(s)
- [WARN] `refactor_watch` Synapse-Network/.spec2flow/worktrees/synapse-network-workflow-1774571039585/.github/prompts/ui-ux-pro-max/scripts/design_system.py::format_master_md high complexity (lines=228>40, branches=12>5, locals=12>8, nesting=3)
- [WARN] `refactor_watch` Synapse-Network/.spec2flow/worktrees/synapse-network-workflow-1774571039585/.github/prompts/ui-ux-pro-max/scripts/design_system.py::_generate_intelligent_overrides high complexity (lines=80>40, branches=13>5, locals=31>8, nesting=3)
- [WARN] `refactor_watch` .github/prompts/ui-ux-pro-max/scripts/design_system.py::format_master_md high complexity (lines=228>40, branches=12>5, locals=12>8, nesting=3)
- [WARN] `refactor_watch` .github/prompts/ui-ux-pro-max/scripts/design_system.py::_generate_intelligent_overrides high complexity (lines=80>40, branches=13>5, locals=31>8, nesting=3)
- [WARN] `refactor_watch` .github/prompts/ui-ux-pro-max/scripts/design_system.py::DesignSystemGenerator._select_best_match high complexity (branches=10>5, nesting=5>=4, locals=9>8)
