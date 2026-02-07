# Ticket 19: Make CORS and Binding Configurable for Deployment

**Priority:** MEDIUM
**Component:** `backend/server.py`, `run.py`
**Estimated Scope:** Small

## Problem

1. **CORS hardcoded to `http://localhost:8000`** (server.py line 85). Any other host, port, or domain is rejected.

2. **Server binds to `localhost` only** (run.py line 9). Not accessible from other machines.

## Files to Modify

- `backend/server.py`
- `run.py`

## Requirements

1. Read CORS origins from `LEETTUTOR_CORS_ORIGINS` env var (comma-separated). Default to `http://localhost:8000` if not set.
2. Read host and port from `LEETTUTOR_HOST` (default `localhost`) and `LEETTUTOR_PORT` (default `8000`) env vars in `run.py`.
3. Dynamically add the server's own origin to CORS allowed origins.

## Acceptance Criteria

- Setting `LEETTUTOR_CORS_ORIGINS=https://myapp.com` allows that origin.
- Setting `LEETTUTOR_HOST=0.0.0.0` makes the server accessible externally.
- Default behavior (no env vars) is unchanged from current.
