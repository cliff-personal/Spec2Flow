# Bootstrap Checklist

- Project: `spec2flow`
- Root: `/Users/cliff/workspace/Spec2Flow`
- Overall: `READY`

## Checklist
- [x] Core - Core status=HEALTHY (ok=7, warn=0, fail=0, info=0)
- [x] Planning - Planning status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [x] Integration - Integration status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [ ] Optional - Optional status=WATCH (ok=2, warn=6, fail=0, info=0)
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
- [OK] `planning_bundle` 5 planning bundle(s) passed plan-check

### Integration
- Summary: Integration status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [OK] `bridge_instruction` /Users/cliff/workspace/Spec2Flow/.github/instructions/agents-memory-bridge.instructions.md
- [OK] `mcp_config` agents-memory server configured -> /Users/cliff/workspace/Spec2Flow/.vscode/mcp.json

### Optional
- Summary: Optional status=WATCH (ok=2, warn=6, fail=0, info=0)
- [OK] `copilot_activation` Agents-Memory activation block present -> /Users/cliff/workspace/Spec2Flow/.github/copilot-instructions.md
- [OK] `agents_read_order` AGENTS.md references current bridge and 8 managed standard(s)
- [WARN] `refactor_watch` unable to inspect .spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/examples/synapse_client_quickstart.py: unterminated string literal (detected at line 38) (<unknown>, line 38)
- [WARN] `refactor_watch` .spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/services/platform/tasks/deposit_indexer/backfill.py::run_backfill_scan_once high complexity (lines=114>40, branches=8>5, locals=22>8, nesting=3, missing_guiding_comment)
- [WARN] `refactor_watch` .spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/storage/postgres/repositories/balance_repository.py::BalanceRepository.read_balance_ledger high complexity (lines=61>40, nesting=4>=4, locals=14>8, branches=5, missing_guiding_comment)
- [WARN] `refactor_watch` .spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/storage/postgres/repositories/idempotency_repository.py::IdempotencyRepository.read_idempotency_rows high complexity (lines=58>40, nesting=4>=4, locals=14>8, branches=4, missing_guiding_comment)
- [WARN] `refactor_watch` .spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/services/platform/service_health_service.py::probe_service_health high complexity (lines=81>40, branches=8>5, locals=17>8, nesting=3, missing_guiding_comment)
- [WARN] `refactor_watch` .spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/services/platform/service_health_service.py::refresh_all_service_health high complexity (lines=49>40, branches=7>5, locals=15>8, missing_guiding_comment)
