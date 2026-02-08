# Ticket 35: ProblemHistory Concurrency Safety

## Priority: HIGH

## Problem

`ProblemHistory` is a shared singleton (`_problem_history` in `server.py`) accessed from multiple async handlers without any synchronization:

- `api_list_problems()` reads `_data` via `get_all()`
- `api_submit()` writes via `record_solve()`
- `websocket_chat()` writes via `record_attempt()`
- `api_problem_history()` reads via `get_all()`

`record_attempt()` and `record_solve()` both do read-modify-write on `_data` then call `_save()`. Two concurrent calls can:
- Read the same state, both increment, both write — one increment lost
- Interleave file writes, corrupting the JSON on disk

## Files
- `backend/problem_history.py`

## Requirements

1. Add an `asyncio.Lock` to `ProblemHistory` protecting `record_attempt()`, `record_solve()`, and `_save()`
2. Reads (`get_all()`, `get()`) should also acquire the lock to prevent reading mid-write state
3. The atomic file write pattern (tempfile + os.replace) is already correct for crash safety — the lock is for in-process concurrency

## Scope
- `backend/problem_history.py`: Add lock, acquire in all public methods
