# Ticket 52: state.resuming Can Get Stuck Permanently

## Priority: MEDIUM

## Problem

In `app.js:929-934`, when a session resume is initiated, `state.resuming` is set to `true`. If the WebSocket message confirming the resume is lost (e.g., connection drops mid-resume), `state.resuming` stays `true` forever. While in this state, the user cannot start any new session because the UI treats the app as mid-resume.

**Audit ref:** Issue #13

## Files
- `frontend/app.js` (resume flow and state management)

## Requirements

1. Add a timeout for the resume operation — if no confirmation is received within N seconds (e.g., 10s), reset `state.resuming` to `false` and show an error message
2. Clear `state.resuming` on WebSocket close/error events
3. Clear `state.resuming` if a new `start_session` is initiated (user gave up on resume)
4. Add a UI indication that resume is in progress (spinner/message) so the user knows what's happening

## Scope
- `frontend/app.js`: Add timeout and cleanup for the `state.resuming` flag
