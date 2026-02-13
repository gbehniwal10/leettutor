# Ticket 72: Auth Rate-Limit Memory Pruning

**Priority:** Medium
**Component:** `backend/auth.py`
**Estimated Scope:** Small (< 20 lines)
**Depends on:** None
**Port of:** focus-engine `backend/auth.py` rate-limit pruning fix

## Overview

The `_prune_expired_tokens()` function in `auth.py` currently only prunes expired auth tokens. It does not prune stale entries in the `_login_attempts` dict, which tracks per-IP login attempt timestamps for rate limiting. On a long-running instance, this dict grows without bound as new IPs attempt logins.

## Problem

Each unique IP that attempts a login gets an entry in `_login_attempts`. These entries are never cleaned up, even after the rate-limit window passes. Over days/weeks of uptime, this is a slow memory leak.

## Implementation

In `_prune_expired_tokens()`, after pruning expired tokens, also prune `_login_attempts` entries where the most recent attempt timestamp is older than `_LOGIN_RATE_WINDOW`:

```python
def _prune_expired_tokens():
    now = time.time()
    # Existing: prune expired tokens
    expired = [t for t, exp in _token_expiry.items() if exp < now]
    for t in expired:
        _valid_tokens.discard(t)
        del _token_expiry[t]

    # NEW: prune stale rate-limit entries
    stale_ips = [
        ip for ip, attempts in _login_attempts.items()
        if attempts and attempts[-1] < now - _LOGIN_RATE_WINDOW
    ]
    for ip in stale_ips:
        del _login_attempts[ip]
```

## Acceptance Criteria

- [ ] `_prune_expired_tokens()` also prunes stale `_login_attempts` entries
- [ ] Stale = last attempt older than `_LOGIN_RATE_WINDOW`
- [ ] Existing auth tests pass
- [ ] New test: verify stale rate-limit entries are cleaned up after window expires
