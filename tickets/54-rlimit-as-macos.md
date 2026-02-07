# Ticket 54: RLIMIT_AS Ineffective on macOS

## Priority: MEDIUM

## Problem

In `executor.py:170`, the code sandbox sets `RLIMIT_AS` (address space limit) to 512MB to prevent user code from exhausting memory. However, macOS often ignores `RLIMIT_AS`, meaning memory limiting does not work on the primary development platform. User code could allocate unbounded memory and crash the server.

**Audit ref:** Issue #17

## Files
- `backend/executor.py` (resource limit setup in `preexec_fn` or subprocess configuration)

## Requirements

1. Detect the platform at runtime (`sys.platform`)
2. On macOS, use an alternative memory limiting strategy:
   - Option A: Use `RLIMIT_RSS` instead (soft limit on resident set size — more reliably enforced on macOS)
   - Option B: Monitor memory usage from the parent process and kill the subprocess if it exceeds the threshold (e.g., using `psutil.Process(pid).memory_info().rss`)
   - Option C: Use a watchdog thread/task that polls `/proc/{pid}/status` (Linux) or `psutil` (cross-platform)
3. On Linux, keep `RLIMIT_AS` as-is (it works correctly)
4. Log a warning at startup if neither `RLIMIT_AS` nor the fallback is available

## Scope
- `backend/executor.py`: Add platform-aware memory limiting with macOS fallback
