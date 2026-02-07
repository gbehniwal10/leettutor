# Ticket 13: Fix API Field Name Mismatches

**Priority:** CRITICAL (broken features)
**Component:** `frontend/app.js`, `backend/session_logger.py`
**Estimated Scope:** Small

## Problem

Two field name mismatches between frontend and backend cause broken functionality:

1. **Session history date**: Frontend reads `s.start_time` (app.js line 666) but backend returns `started_at` (session_logger.py line 113). Result: every session shows "Invalid Date".

2. **Session detail messages**: Frontend reads `session.messages` (app.js line 697) but backend stores `chat_history` (session_logger.py line 48). Result: session detail always shows "No messages".

## Files to Modify

- `frontend/app.js`

## Requirements

1. Change `s.start_time` to `s.started_at` in the session history rendering.
2. Change `session.messages` to `session.chat_history` in the session detail view.
3. Verify the message object shape matches too (check field names like `role`, `content` vs what the frontend expects).

## Acceptance Criteria

- Session history list shows correct dates.
- Session detail view shows the actual chat messages.
