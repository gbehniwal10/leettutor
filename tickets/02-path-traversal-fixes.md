# Ticket 02: Fix Path Traversal Vulnerabilities

**Priority:** CRITICAL
**Component:** `backend/session_logger.py`, `backend/server.py`
**Estimated Scope:** Small

## Problem

User-supplied `session_id` is passed directly into file path construction without validation:

```python
# session_logger.py line 97
filepath = self.sessions_dir / f"{session_id}.json"
```

A crafted `session_id` like `../../etc/passwd` or `../backend/tutor` can read arbitrary files. The `.json` suffix limits but does not eliminate the risk.

Similarly, `problem_id` from user input is stored unchecked and could be exploited if ever used in path construction.

## Files to Modify

- `backend/session_logger.py` — `get_session()` (line 97)
- `backend/server.py` — any endpoint accepting `problem_id` or `session_id`
- `backend/problems.py` — if `problem_id` is used in file lookups

## Requirements

1. In `get_session()`, resolve the constructed path and verify it is still inside `self.sessions_dir`:
   ```python
   filepath = (self.sessions_dir / f"{session_id}.json").resolve()
   if not filepath.is_relative_to(self.sessions_dir.resolve()):
       return None
   ```
2. Validate `session_id` format — it should be an 8-character hex string (from UUID). Reject anything else.
3. Validate `problem_id` against the loaded problem catalog rather than using it in filesystem operations directly.
4. Apply the same `resolve()` + `is_relative_to()` check in `list_sessions()` if iterating user-influenced paths.

## Acceptance Criteria

- `get_session("../../etc/passwd")` returns `None`, not file contents.
- `get_session("valid-id")` still works normally.
- `problem_id` values are validated against the known problem set.
