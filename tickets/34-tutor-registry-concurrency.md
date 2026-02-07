# Ticket 34: TutorRegistry Concurrency Safety

## Priority: CRITICAL

## Problem

`TutorRegistry._parked` is a plain dict accessed concurrently from:
- WebSocket handlers calling `park()` and `reclaim()` (per-connection async tasks)
- The background `_cleanup_loop()` task iterating and popping expired entries

This can cause:
- `KeyError` or skipped entries if the dict is mutated during iteration
- Lost parks if `park()` evicts while `_cleanup_loop()` pops the same key
- Stale reads in `is_alive()` during concurrent mutations

Additionally, `_cleanup_loop()` has **no exception handling** around `await self._kill()`. A single exception (e.g., from `force_kill()` hitting a missing process) kills the loop permanently — parked tutors never expire again, leaking subprocesses indefinitely.

The `asyncio.ensure_future(self._kill(evicted))` calls in `park()` and `reclaim()` are fire-and-forget with no error handling. If they fail, resources leak silently.

## Files
- `backend/tutor_registry.py` (entire class)

## Requirements

1. Add an `asyncio.Lock` to `TutorRegistry` protecting all access to `_parked`
2. Wrap `await self._kill(parked)` in `_cleanup_loop()` with try/except so one failure doesn't kill the loop
3. Replace fire-and-forget `asyncio.ensure_future(self._kill(...))` in `park()` and `reclaim()` with awaited calls or properly error-handled tasks
4. Add `add_done_callback` or similar to log exceptions from any background kill tasks

## Scope
- `backend/tutor_registry.py`: Refactor class to use `asyncio.Lock`, harden cleanup loop
