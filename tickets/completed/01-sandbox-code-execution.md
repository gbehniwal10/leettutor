# Ticket 01: Sandbox Code Execution

**Priority:** CRITICAL
**Component:** `backend/executor.py`
**Estimated Scope:** Large

## Problem

User-submitted code runs via `subprocess.run` using the host Python interpreter with the same OS user privileges as the server. There is zero sandboxing — no containers, no seccomp, no chroot, no resource limits. A user can:

- Read/write arbitrary files on the server filesystem
- Execute system commands, install reverse shells
- Exfiltrate environment variables, API keys, source code
- Fork bomb or memory bomb the host (no `RLIMIT_NPROC` or memory caps)
- Make network requests (SSRF, data exfiltration)
- Spawn child processes that survive the 5-second timeout

Additionally, `test["function_call"]` from problem JSON (line 127) is interpolated as raw Python — a compromised problem file means RCE.

## Files to Modify

- `backend/executor.py` (primary)
- Potentially add a `Dockerfile` or sandbox config

## Requirements

1. Run user code inside an isolated environment (Docker container with `--network=none`, or `nsjail`, or similar).
2. Set resource limits: memory (e.g., 256MB), CPU time (5s), max processes (10), max file size (1MB).
3. Mount filesystem as read-only except for a temp working directory.
4. Kill the entire process tree on timeout, not just the parent process (use `subprocess.run` with `start_new_session=True` and kill the process group).
5. Sanitize or parameterize `test["function_call"]` instead of raw string interpolation — e.g., pass function name and args separately and construct the call safely.
6. Validate that `code` input has a reasonable max length (e.g., 50KB).

## Acceptance Criteria

- User code cannot access the host filesystem, network, or environment.
- Fork bombs and memory bombs are contained and do not affect the server.
- Timeout kills all child processes.
- `function_call` injection is no longer possible.
- All existing tests/functionality still works (run + submit endpoints).
