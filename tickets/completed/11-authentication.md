# Ticket 11: Add Basic Authentication

**Priority:** HIGH
**Component:** `backend/server.py`
**Estimated Scope:** Medium

## Problem

There is no authentication on any endpoint. Anyone with network access to the server can:

- Execute arbitrary code via `/api/run` and `/api/submit`
- Read all session data via `/api/sessions`
- Open WebSocket connections and consume Claude API credits
- Access other users' sessions

This is especially dangerous given that code execution has no sandboxing (see Ticket 01).

## Files to Modify

- `backend/server.py`
- `frontend/app.js` — add login UI or token handling
- `frontend/index.html` — login form if needed

## Requirements

At minimum, implement one of:

**Option A: Simple shared secret (simplest)**
- Environment variable `LEETTUTOR_PASSWORD` sets a password
- Login endpoint returns a session cookie/token
- All API and WebSocket endpoints validate the token
- Suitable for single-user or small-team deployments

**Option B: Per-user auth**
- Simple user registration/login with hashed passwords (e.g., `bcrypt`)
- JWT or session-based authentication
- Sessions are scoped to the authenticated user
- Suitable if multi-user isolation is needed

The choice depends on the intended deployment model. Option A is recommended for an MVP.

## Acceptance Criteria

- Unauthenticated requests to `/api/run`, `/api/submit`, `/ws/chat` are rejected with 401.
- `/api/problems` can optionally remain public (read-only, no security risk).
- Sessions are scoped — users can only see their own sessions.
- The frontend handles authentication (login form or prompt).
