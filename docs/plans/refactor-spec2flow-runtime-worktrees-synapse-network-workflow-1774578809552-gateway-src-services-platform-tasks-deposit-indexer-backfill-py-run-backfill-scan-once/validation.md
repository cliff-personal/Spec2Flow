---
created_at: 2026-03-27
updated_at: 2026-03-27
doc_status: active
---

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
- expected outcome: `.spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/services/platform/tasks/deposit_indexer/backfill.py::run_backfill_scan_once` is no longer the first hotspot, or its issue list is smaller.

## Hotspot Snapshot
```json
{
  "identifier": ".spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/services/platform/tasks/deposit_indexer/backfill.py::run_backfill_scan_once",
  "rank_token": "hotspot-8610e372dd76",
  "relative_path": ".spec2flow/runtime/worktrees/synapse-network-workflow-1774578809552/gateway/src/services/platform/tasks/deposit_indexer/backfill.py",
  "function_name": "run_backfill_scan_once",
  "qualified_name": "run_backfill_scan_once",
  "line": 112,
  "status": "WARN",
  "effective_lines": 114,
  "branches": 8,
  "nesting": 3,
  "local_vars": 22,
  "has_guiding_comment": false,
  "issues": [
    "lines=114>40",
    "branches=8>5",
    "locals=22>8",
    "nesting=3",
    "missing_guiding_comment"
  ],
  "score": 32
}
```
