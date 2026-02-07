# Ticket 04: Fix WebSocket Error Handling (Server + Client)

**Priority:** HIGH
**Component:** `backend/server.py`, `frontend/app.js`
**Estimated Scope:** Medium

## Problem

### Server Side (`backend/server.py`)

1. **JSON parse crash** (line 101): `json.loads(data)` throws `JSONDecodeError` on malformed messages, crashing the WebSocket handler. Not caught by the `except WebSocketDisconnect` block.

2. **Missing key crash** (lines 103, 108, 113): `msg["type"]`, `msg["problem_id"]`, `msg["mode"]` use bracket access with no validation. Missing keys raise `KeyError`, crashing the handler.

3. **Tutor not cleaned up on non-disconnect exceptions** (lines 98-218): If any exception other than `WebSocketDisconnect` occurs, `tutor.end_session()` is never called, leaking the Claude SDK resource. Needs a `finally` block.

4. **Exception details leaked to client** (lines 141, 159): `str(e)` is sent to the client, potentially exposing internal paths and library versions.

### Client Side (`frontend/app.js`)

1. **No JSON.parse error handling** (line 68): Malformed server messages crash the handler silently.

2. **No exponential backoff** (line 73): Fixed 3-second reconnect retry hammers the server during outages.

3. **Old WebSocket not closed** (line 59-76): `initWebSocket` creates a new socket without closing the old one, potentially creating duplicate connections.

## Files to Modify

- `backend/server.py` — WebSocket handler (`/ws/chat`)
- `frontend/app.js` — `initWebSocket`, `handleWebSocketMessage`

## Requirements

### Server
1. Wrap the WebSocket message loop body in `try/except Exception` that catches `JSONDecodeError`, `KeyError`, `TypeError`, etc. Send a generic error message to the client and `continue` the loop.
2. Add a `finally` block that calls `tutor.end_session()` and `session_logger.end_session()`.
3. Validate required keys using `.get()` with appropriate defaults or early returns.
4. Replace `str(e)` in error responses with generic messages; log the actual exception server-side.

### Client
1. Wrap `JSON.parse(event.data)` in try/catch.
2. Implement exponential backoff with jitter for reconnects (e.g., 1s, 2s, 4s, 8s... capped at 30s).
3. Call `state.ws.close()` before creating a new WebSocket in `initWebSocket`.

## Acceptance Criteria

- Sending `{invalid json}` over WebSocket does not crash the server handler.
- Sending `{"type": "start_session"}` (missing `problem_id`) returns an error message, not a crash.
- Tutor and session resources are always cleaned up, even on unexpected errors.
- Client reconnects with backoff, not a fixed 3s loop.
- No duplicate WebSocket connections after reconnect.
