# Ticket 40: Token Expiry and Login Rate Limiting

## Priority: LOW

## Problem

When `LEETTUTOR_PASSWORD` is set, the `POST /api/login` endpoint issues tokens that never expire and accumulate in the `active_tokens` set forever. There is also no rate limiting on the login endpoint, so a brute-force attack could try passwords indefinitely.

While this is a local-only app and the risk is low, these are easy hardening wins.

**Audit ref:** Issue #18

## Files
- `backend/server.py` (login endpoint and token validation)

## Requirements

1. **Token expiry**: Store tokens with a creation timestamp. Reject tokens older than a configurable TTL (default 24 hours). Periodically prune expired tokens from the set.
2. **Rate limiting**: Add a simple per-IP rate limiter on `POST /api/login` — e.g., max 5 attempts per minute. Return `429 Too Many Requests` when exceeded. A simple in-memory dict with timestamps is sufficient (no need for Redis).
3. Keep the current behavior when `LEETTUTOR_PASSWORD` is not set (no auth required).

## Scope
- `backend/server.py`: Token storage refactor (dict with timestamps instead of set), rate-limit middleware or decorator on login endpoint
