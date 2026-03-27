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

1. [WARN] `Synapse-Network/.spec2flow/worktrees/synapse-network-workflow-1774571039585/.github/prompts/ui-ux-pro-max/scripts/design_system.py::format_master_md` line=542 metrics=(lines=228, branches=12, nesting=3, locals=12)
   - token: `hotspot-134ec6c66e09`
   - issues: `lines=228>40, branches=12>5, locals=12>8, nesting=3`
   - bundle command: `amem refactor-bundle . --token hotspot-134ec6c66e09`
2. [WARN] `Synapse-Network/.spec2flow/worktrees/synapse-network-workflow-1774571039585/.github/prompts/ui-ux-pro-max/scripts/design_system.py::_generate_intelligent_overrides` line=914 metrics=(lines=80, branches=13, nesting=3, locals=31)
   - token: `hotspot-2b9795766e0f`
   - issues: `lines=80>40, branches=13>5, locals=31>8, nesting=3`
   - bundle command: `amem refactor-bundle . --token hotspot-2b9795766e0f`
3. [WARN] `.github/prompts/ui-ux-pro-max/scripts/design_system.py::format_master_md` line=542 metrics=(lines=228, branches=12, nesting=3, locals=12)
   - token: `hotspot-5e763c06073a`
   - issues: `lines=228>40, branches=12>5, locals=12>8, nesting=3`
   - bundle command: `amem refactor-bundle . --token hotspot-5e763c06073a`
4. [WARN] `.github/prompts/ui-ux-pro-max/scripts/design_system.py::_generate_intelligent_overrides` line=914 metrics=(lines=80, branches=13, nesting=3, locals=31)
   - token: `hotspot-f43d8ef2b6a8`
   - issues: `lines=80>40, branches=13>5, locals=31>8, nesting=3`
   - bundle command: `amem refactor-bundle . --token hotspot-f43d8ef2b6a8`
5. [WARN] `.github/prompts/ui-ux-pro-max/scripts/design_system.py::DesignSystemGenerator._select_best_match` line=122 metrics=(lines=27, branches=10, nesting=5, locals=9)
   - token: `hotspot-1473d73de1c0`
   - issues: `branches=10>5, nesting=5>=4, locals=9>8`
   - bundle command: `amem refactor-bundle . --token hotspot-1473d73de1c0`

## Suggested Action

1. Run `amem refactor-bundle .` to materialize the first hotspot into an executable planning bundle.
2. If a hotspot cannot be split yet, add a guiding comment that explains the main decision path and risk boundaries.
3. Re-run `amem doctor .` after the change and confirm `refactor_watch` findings shrink or disappear.
