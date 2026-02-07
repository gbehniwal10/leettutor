# Ticket 10: Frontend WebSocket Resilience and State Management

**Priority:** MEDIUM
**Component:** `frontend/app.js`
**Estimated Scope:** Medium

## Problem

1. **No session re-association after reconnect** (line 73): After WebSocket reconnects, there is no logic to re-send `start_session` or re-associate with the current session. The backend treats the new connection as anonymous.

2. **Messages silently dropped** (lines 78-85): `wsSend` returns `false` when disconnected but callers ignore the return value. User messages, hints, and time updates are lost without notification.

3. **No message ordering or deduplication**: No sequence numbering. A reconnect mid-stream can lose or duplicate `assistant_chunk` messages, producing garbled output.

4. **Race condition in `selectProblem`** (lines 166-192): No guard against concurrent invocations. Rapid clicks cause overlapping fetches that can mismatch the editor content with the session.

5. **Keyboard shortcuts bypass disabled buttons** (lines 114-115): `Ctrl+Enter` and `Ctrl+Shift+Enter` call `runCode`/`submitCode` directly regardless of button state, allowing parallel requests.

6. **`initProblemFilters` adds duplicate listeners** (lines 130-137): If `loadProblems` is ever called again, event listeners accumulate.

## Files to Modify

- `frontend/app.js`

## Requirements

1. After WebSocket reconnects, if there is an active session (`state.sessionId` and `state.currentProblem`), re-send a `start_session` message to restore server-side state.

2. Show a user-visible notification when messages fail to send (e.g., "Connection lost, reconnecting...").

3. Add an `isLoading` guard to `selectProblem` — reject concurrent calls or cancel the previous one.

4. Add function-level guards to `runCode` and `submitCode` (not just button disabling) so keyboard shortcuts are also blocked during execution.

5. Use `AbortController` or a flag to prevent duplicate listener registration.

## Acceptance Criteria

- After a reconnect, the session continues working (chat, run, submit).
- Users see a visible indicator when disconnected.
- Rapidly clicking two different problems does not produce a mismatched state.
- `Ctrl+Enter` during an active run is ignored.
