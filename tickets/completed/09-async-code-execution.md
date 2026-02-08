# Ticket 09: Make Code Execution Non-Blocking

**Priority:** MEDIUM
**Component:** `backend/executor.py`, `backend/server.py`
**Estimated Scope:** Small

## Problem

`CodeExecutor.run_tests` calls `subprocess.run` synchronously (executor.py line 144). The `/api/run` and `/api/submit` endpoints are `async def`, so this blocking call freezes the entire asyncio event loop for up to 5 seconds per test case, stalling all other requests (WebSocket messages, other HTTP requests).

## Files to Modify

- `backend/executor.py` — `run_tests` method
- `backend/server.py` — endpoints calling `run_tests`

## Requirements

1. Replace `subprocess.run` with `asyncio.create_subprocess_exec` (preferred) or run the blocking call in a thread pool via `asyncio.to_thread()` / `loop.run_in_executor()`.

2. If using `asyncio.create_subprocess_exec`, use `asyncio.wait_for()` for the timeout instead of the subprocess timeout parameter.

3. Ensure process cleanup (kill process group on timeout) still works correctly with the async approach.

4. Use `start_new_session=True` (or `preexec_fn=os.setsid` on Unix) and kill the process group on timeout to catch child processes that outlive the parent.

## Acceptance Criteria

- Running user code does not block other concurrent requests.
- Timeout behavior is preserved.
- All child processes are killed on timeout.
