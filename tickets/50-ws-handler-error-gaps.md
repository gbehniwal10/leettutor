# Ticket 50: WebSocket Handler Error Handling Gaps

## Priority: MEDIUM

## Problem

Two issues in the WebSocket handler in `server.py`:

1. **Unprotected handlers** (`server.py:507-511, 741-747`): The `end_session` and `time_update` message type handlers have no try/except. If `tutor.end_session()` or time update logic throws, the entire WebSocket connection crashes with no error message to the client.

2. **Fragile finally block** (`server.py:759-792`): In the WebSocket handler's `finally` block, if `tutor.end_session()` throws, subsequent cleanup steps (`session_logger.end_session()`, workspace directory cleanup) are skipped entirely, leaving orphaned resources.

**Audit ref:** Issues #10, #11

## Files
- `backend/server.py` (WebSocket handler)

## Requirements

1. Wrap `end_session` and `time_update` handlers in try/except blocks that log the error and send an error message to the client
2. In the `finally` block, wrap each cleanup step individually in its own try/except so that one failure doesn't skip the rest:
   ```python
   finally:
       try:
           await tutor.end_session()
       except Exception:
           logger.exception("tutor end_session failed")
       try:
           session_logger.end_session(session_id)
       except Exception:
           logger.exception("session_logger end_session failed")
       try:
           cleanup_workspace(session_id)
       except Exception:
           logger.exception("workspace cleanup failed")
   ```
3. Ensure any exception in the finally block is logged, not silently swallowed

## Scope
- `backend/server.py`: Add try/except to unprotected handlers and restructure the finally block
