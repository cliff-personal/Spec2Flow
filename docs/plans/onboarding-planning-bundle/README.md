# Planning onboarding: planning_bundle

这是当前任务的 planning bundle。

建议使用顺序：

1. 先写 `spec.md`
2. 再补 `plan.md`
3. 再确认 `task-graph.md`
4. 最后在 `validation.md` 里写最小验证路线

## Onboarding State
- state file: `.agents-memory/onboarding-state.json`
- bootstrap ready: `yes`
- bootstrap complete: `yes`
- next group: `Refactor`
- next key: `refactor_bundle`
- next command: `python3 scripts/memory.py refactor-bundle . --token hotspot-5e763c06073a`
- verify with: `amem doctor .`
- done when: `amem doctor .` no longer reports `.github/prompts/ui-ux-pro-max/scripts/design_system.py::format_master_md` as the top refactor hotspot.
