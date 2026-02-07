# Ticket 05: Per-Connection State Isolation

**Priority:** HIGH
**Component:** `backend/server.py`, `backend/session_logger.py`, `backend/tutor.py`
**Estimated Scope:** Medium

## Problem

Several pieces of state are shared across all WebSocket connections:

1. **`SessionLogger` is a singleton** (server.py line 26). `current_session` is a single dict. If two users connect, the second user's `start_session` overwrites the first user's session, corrupting logging for both.

2. **Workspace directory is shared** (tutor.py lines 93-94, server.py line 119). All connections write to the same `WORKSPACE_DIR/solution.py`. One user's code overwrites another's, and Claude can read the wrong user's code.

3. **No concurrency protection** on `hint_count`, `time_remaining`, or `interview_phase` in the tutor.

## Files to Modify

- `backend/server.py` — WebSocket handler
- `backend/session_logger.py` — make instance-based, not singleton
- `backend/tutor.py` — per-connection workspace

## Requirements

1. Create a **new `SessionLogger` instance per WebSocket connection** instead of using a module-level singleton. Instantiate it inside the WebSocket handler.

2. Create a **per-connection workspace directory** (e.g., `workspace/{session_id}/`) and pass it to the tutor. Clean it up when the connection closes.

3. Ensure the tutor's mutable state (`hint_count`, `time_remaining`, `interview_phase`) is already per-instance (it is, since a new `Tutor` is created per connection — verify this).

4. Remove the module-level `session_logger = SessionLogger()` from server.py.

## Acceptance Criteria

- Two simultaneous WebSocket connections maintain independent sessions.
- Each connection's session log is written correctly without interference.
- Each connection has its own workspace directory for `solution.py`.
- Workspace directories are cleaned up on disconnect.
