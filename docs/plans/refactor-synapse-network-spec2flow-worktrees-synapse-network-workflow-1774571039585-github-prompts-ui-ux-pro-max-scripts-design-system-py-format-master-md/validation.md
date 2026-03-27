# Validation Route

## Required Checks

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 -m py_compile $(find agents_memory scripts -name '*.py' -print)
python3 scripts/memory.py docs-check .
```

## Task-Specific Checks

- 写下本任务额外需要跑的命令

## Review Notes

- docs diff:
- code diff:
- test diff:

## Refactor Verification
- primary verification command: `amem doctor .`
- expected outcome: `Synapse-Network/.spec2flow/worktrees/synapse-network-workflow-1774571039585/.github/prompts/ui-ux-pro-max/scripts/design_system.py::format_master_md` is no longer the first hotspot, or its issue list is smaller.

## Hotspot Snapshot
```json
{
  "identifier": "Synapse-Network/.spec2flow/worktrees/synapse-network-workflow-1774571039585/.github/prompts/ui-ux-pro-max/scripts/design_system.py::format_master_md",
  "rank_token": "hotspot-134ec6c66e09",
  "relative_path": "Synapse-Network/.spec2flow/worktrees/synapse-network-workflow-1774571039585/.github/prompts/ui-ux-pro-max/scripts/design_system.py",
  "function_name": "format_master_md",
  "qualified_name": "format_master_md",
  "line": 542,
  "status": "WARN",
  "effective_lines": 228,
  "branches": 12,
  "nesting": 3,
  "local_vars": 12,
  "has_guiding_comment": true,
  "issues": [
    "lines=228>40",
    "branches=12>5",
    "locals=12>8",
    "nesting=3"
  ],
  "score": 31
}
```
