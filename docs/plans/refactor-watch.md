# Refactor Watch

- Project: `spec2flow`
- Root: `/Users/cliff/workspace/Spec2Flow`

## Purpose

Track Python functions that are already high-complexity or are approaching the configured refactor thresholds.

## Thresholds

- Hard gate: more than 40 effective lines, more than 5 control-flow branches, nesting depth >= 4, or more than 8 local variables.
- Watch zone: around 30 effective lines, 4 branches, nesting depth 3, or 6 local variables.
- Complex logic should include a short guiding comment when it cannot be cleanly decomposed yet.

## Workflow Entry

- Primary command: `amem refactor-bundle .`
- Prefer stable targeting with: `amem refactor-bundle . --token <hotspot-token>`
- Fallback positional targeting: `amem refactor-bundle . --index <n>`
- The command creates or refreshes `docs/plans/refactor-<slug>/` using the first current hotspot as execution context.

## Hotspots

1. [WARN] `.spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/services/platform/tasks/deposit_indexer/backfill.py::run_backfill_scan_once` line=112 metrics=(lines=114, branches=8, nesting=3, locals=22)
   - token: `hotspot-8610e372dd76`
   - issues: `lines=114>40, branches=8>5, locals=22>8, nesting=3, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-8610e372dd76`
2. [WARN] `.spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/storage/postgres/repositories/balance_repository.py::BalanceRepository.read_balance_ledger` line=136 metrics=(lines=61, branches=5, nesting=4, locals=14)
   - token: `hotspot-8b5b79ba8fd6`
   - issues: `lines=61>40, nesting=4>=4, locals=14>8, branches=5, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-8b5b79ba8fd6`
3. [WARN] `.spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/storage/postgres/repositories/idempotency_repository.py::IdempotencyRepository.read_idempotency_rows` line=54 metrics=(lines=58, branches=4, nesting=4, locals=14)
   - token: `hotspot-bed864ad1085`
   - issues: `lines=58>40, nesting=4>=4, locals=14>8, branches=4, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-bed864ad1085`
4. [WARN] `.spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/services/platform/service_health_service.py::probe_service_health` line=518 metrics=(lines=81, branches=8, nesting=3, locals=17)
   - token: `hotspot-cd0b53434b7e`
   - issues: `lines=81>40, branches=8>5, locals=17>8, nesting=3, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-cd0b53434b7e`
5. [WARN] `.spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/services/platform/service_health_service.py::refresh_all_service_health` line=607 metrics=(lines=49, branches=7, nesting=2, locals=15)
   - token: `hotspot-075a548c7704`
   - issues: `lines=49>40, branches=7>5, locals=15>8, missing_guiding_comment`
   - bundle command: `amem refactor-bundle . --token hotspot-075a548c7704`
6. [WARN] .spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/services/platform/service_health_service.py::refresh_all_service_health high complexity (lines=49>40, branches=7>5, locals=15>8, missing_guiding_comment)

## Suggested Action

1. Run `amem refactor-bundle .` to materialize the first hotspot into an executable planning bundle.
2. If a hotspot cannot be split yet, add a guiding comment that explains the main decision path and risk boundaries.
3. Re-run `amem doctor .` after the change and confirm `refactor_watch` findings shrink or disappear.
