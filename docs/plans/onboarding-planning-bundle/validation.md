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

## Onboarding Verification
- primary verification command: `amem doctor .`
- expected completion: `amem doctor .` no longer reports `.github/prompts/ui-ux-pro-max/scripts/design_system.py::format_master_md` as the top refactor hotspot.

## State Snapshot
```json
{
  "project_bootstrap_ready": true,
  "project_bootstrap_complete": true,
  "recommended_next_command": "python3 scripts/memory.py refactor-bundle . --token hotspot-5e763c06073a",
  "recommended_verify_command": "amem doctor ."
}
```
