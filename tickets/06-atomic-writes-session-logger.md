# Ticket 06: Atomic Writes and Resilience in Session Logger

**Priority:** HIGH
**Component:** `backend/session_logger.py`
**Estimated Scope:** Small

## Problem

1. **Non-atomic writes** (lines 78-79): `open(filepath, "w")` truncates the file immediately before `json.dump` finishes. A crash mid-write leaves a corrupt or empty file, permanently losing that session.

2. **`list_sessions` crashes on any corrupt file** (lines 83-93): A single corrupt JSON file causes the entire listing to fail — no try/catch around `json.load`.

3. **`get_session` crashes on corrupt file** (line 100): Same issue — `json.load` without error handling.

4. **Truncated UUID collision** (line 14): `str(uuid4())[:8]` = 32 bits. ~65K sessions gives 50% collision chance, silently overwriting an existing session file.

5. **Silent data loss** (lines 33, 41, 49, 57, 63): All `log_*` methods silently return if no active session. No warning, no logging.

## Files to Modify

- `backend/session_logger.py`

## Requirements

1. **Atomic writes**: Write to a temp file in the same directory, then `os.replace()` to the final path:
   ```python
   import tempfile, os
   tmp_fd, tmp_path = tempfile.mkstemp(dir=self.sessions_dir, suffix=".tmp")
   try:
       with os.fdopen(tmp_fd, "w") as f:
           json.dump(self.current_session, f, indent=2)
       os.replace(tmp_path, filepath)
   except:
       os.unlink(tmp_path)
       raise
   ```

2. **Resilient listing**: Wrap `json.load` in `list_sessions` and `get_session` in try/except. Skip corrupt files in listing, return `None` for corrupt files in get.

3. **Longer session ID**: Use full UUID or at least 16 hex chars to reduce collision risk.

4. **Log warnings** when `log_*` methods are called without an active session (use Python `logging` module).

## Acceptance Criteria

- A simulated crash during `_save()` does not corrupt existing session data.
- `list_sessions()` returns valid sessions even if some JSON files are corrupt.
- `get_session()` returns `None` (not an exception) for corrupt files.
- Session ID collisions are statistically negligible.
