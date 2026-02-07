# Ticket 46: Strip PYTHONPATH from Sandbox Environment

## Priority: LOW

## Problem

The code executor in `executor.py:471` builds a restricted environment for the sandbox subprocess but preserves `PYTHONPATH`. If the host's `PYTHONPATH` points to directories with user-installed or malicious modules, the sandboxed code could import them — potentially escaping the sandbox's intended restrictions.

**Audit ref:** Issue #25

## Files
- `backend/executor.py` (environment construction for subprocess)

## Requirements

1. Remove `PYTHONPATH` from the environment passed to the sandboxed subprocess
2. Also remove `PYTHONSTARTUP` if present (it can execute arbitrary code on interpreter startup)
3. Consider stripping other Python-specific env vars that could influence behavior: `PYTHONHOME`, `PYTHONUSERBASE`, `PYTHONPLATLIBDIR`
4. Keep `PATH` restricted to system directories as currently implemented

## Scope
- `backend/executor.py`: Update the environment dict construction to exclude Python-specific variables
