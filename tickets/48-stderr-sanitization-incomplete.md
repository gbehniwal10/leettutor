# Ticket 48: Incomplete stderr Path Sanitization

## Priority: MEDIUM

## Problem

The stderr sanitization in `executor.py:419` only strips `/tmp/` and `/var/` paths from error output returned to the user. On macOS, paths under `/Users/` leak through, and on Linux, `/home/` paths leak. This exposes the host filesystem layout (usernames, directory structure) to the user via tracebacks.

**Audit ref:** Issue #8

## Files
- `backend/executor.py` (stderr sanitization logic)

## Requirements

1. Extend path sanitization to also strip `/Users/` (macOS) and `/home/` (Linux) prefixes from stderr output
2. Replace leaked paths with a generic placeholder (e.g., `<sandbox>/script.py`)
3. Consider using a regex that catches any absolute path (`/[^ :]+`) and replaces the directory portion while keeping the filename
4. Ensure the sanitization doesn't break the readability of Python tracebacks — line numbers and filenames should still make sense

## Scope
- `backend/executor.py`: Update the stderr sanitization regex/logic
