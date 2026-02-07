# Ticket 16: Fix Zombie Processes and preexec_fn in Executor

**Priority:** HIGH
**Component:** `backend/executor.py`
**Estimated Scope:** Medium

## Problem

1. **Zombie processes**: After `_kill_process_group(proc)` on timeout (line 277) and in the exception handler (line 340), `await proc.wait()` is never called. The killed process remains in the process table as a zombie. Under load, zombies accumulate until PID table exhaustion.

2. **`preexec_fn` unsafe with asyncio**: `asyncio.create_subprocess_exec` with `preexec_fn` can deadlock in multi-threaded event loops (e.g., uvloop). Python 3.12+ deprecates `preexec_fn` when threads are present.

3. **`RLIMIT_NPROC` is per-UID**: Limits total processes for the entire user, not just this subprocess. Concurrent test executions will hit the limit and fail spuriously.

4. **`RLIMIT_AS` 256MB may be too low**: Python 3.11+ can map 100-150MB at startup. Some systems fail immediately.

## Files to Modify

- `backend/executor.py`

## Requirements

1. Add `await proc.wait()` after every `_kill_process_group(proc)` call (with a short timeout guard to avoid hanging on an unkillable process).

2. Move resource limits into the wrapper Python script itself (call `resource.setrlimit` inside the generated code before running user code) instead of using `preexec_fn`. Remove `preexec_fn` from the subprocess call.

3. Remove `RLIMIT_NPROC` or raise it significantly (e.g., 200). Consider documenting that proper process limits require a dedicated UID or container.

4. Raise `RLIMIT_AS` to 512MB.

5. Add `json.dumps(test["input"], ensure_ascii=True)` to prevent Unicode line separator issues in generated Python source.

## Acceptance Criteria

- No zombie processes after timeouts (verify with `ps aux | grep defunct`).
- Executor works correctly without `preexec_fn`.
- Resource limits are applied inside the wrapper script.
- Concurrent test runs don't fail due to NPROC limits.
