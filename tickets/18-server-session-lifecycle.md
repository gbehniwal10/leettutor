# Ticket 18: Fix Server Session Lifecycle Issues

**Priority:** MEDIUM
**Component:** `backend/server.py`
**Estimated Scope:** Small

## Problem

1. **Session not ended before re-start**: When a `start_session` message arrives and a tutor already exists (line 203-205), `tutor.end_session()` is called but `session_logger.end_session()` is NOT called. The old session's JSON file never gets `ended_at` or `duration_seconds`.

2. **`log_code_submission` never called**: The `session_logger.log_code_submission()` method exists but is never invoked from the run/submit endpoints. The `code_submissions` array is always empty.

3. **No HTTP status check on run/submit in frontend**: app.js lines 455, 487 call `response.json()` without checking `response.ok`. Error responses (404, 500) crash `displayTestResults`.

4. **`loadProblems` missing auth headers**: app.js line 260 fetches `/api/problems` without `authHeaders()`. If this endpoint ever requires auth, it fails silently.

## Files to Modify

- `backend/server.py` — session lifecycle, log_code_submission calls
- `frontend/app.js` — response status checks, auth headers

## Requirements

1. Call `session_logger.end_session()` before `session_logger.start_session()` when re-starting a session on the same connection.
2. Call `session_logger.log_code_submission()` in the `/api/run` and `/api/submit` handlers (or pass session_logger through somehow — note these are REST endpoints, not WebSocket, so this may need a design decision).
3. Add `if (!response.ok)` checks in `runCode` and `submitCode` before parsing JSON. Show an error message to the user.
4. Add `authHeaders()` to the `loadProblems` fetch call.

## Acceptance Criteria

- Re-starting a session properly finalizes the previous session's JSON.
- Run/submit results are logged to the session.
- Backend error responses show user-friendly errors instead of crashing.
- `loadProblems` works when auth is enabled.
