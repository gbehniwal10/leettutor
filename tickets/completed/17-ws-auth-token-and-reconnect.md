# Ticket 17: Fix WebSocket Auth Token Leakage and Reconnect Issues

**Priority:** HIGH
**Component:** `frontend/app.js`, `backend/server.py`
**Estimated Scope:** Medium

## Problem

1. **Auth token in WebSocket URL**: The token is passed as `?token=...` query parameter (app.js line 159), visible in server logs, browser history, and proxy logs.

2. **Infinite reconnect after server restart**: When the server restarts, in-memory tokens are lost. The frontend reconnects with a stale token, gets rejected with code 4001, but the `onclose` handler just retries with backoff forever — never re-prompts for login.

3. **Login modal keydown listener accumulates**: Each call to `showLoginModal()` adds another `keydown` listener (line 89), causing multiple login attempts per Enter press.

## Files to Modify

- `frontend/app.js` — WebSocket init, login modal
- `backend/server.py` — WebSocket auth handler

## Requirements

1. **Move token to first message**: Remove token from URL. After WebSocket connects, send `{"type": "auth", "token": "..."}` as the first message. Backend should validate before processing other messages.

2. **Detect auth rejection on reconnect**: In `onclose`, check if `event.code === 4001`. If so, clear the stored token and show the login modal instead of reconnecting.

3. **Fix login modal listener leak**: Remove the old keydown listener before adding a new one, or use `{ once: true }`, or check if already bound.

## Acceptance Criteria

- Auth token does not appear in WebSocket URL.
- After server restart, user is prompted to log in again (not infinite reconnect).
- Pressing Enter in login modal fires login exactly once.
