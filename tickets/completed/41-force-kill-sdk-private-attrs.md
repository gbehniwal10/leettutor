# Ticket 41: Replace Private SDK Attribute Access in force_kill()

## Priority: LOW

## Problem

`LeetCodeTutor.force_kill()` in `tutor.py:341-375` accesses private/internal attributes of the Claude Code SDK client to find and kill the subprocess:

- `self.client._query._closed`
- `self.client._transport._process`

These are implementation details that could change in any SDK update, breaking the kill functionality silently and leaving zombie subprocesses.

**Audit ref:** Issue #19

## Files
- `backend/tutor.py` (`force_kill()` method)

## Requirements

1. Check if the Claude Code SDK provides a public API for cancellation or process termination (e.g., `client.cancel()`, `client.close()`, or `client.abort()`)
2. If a public API exists, replace the private attribute access with it
3. If no public API exists:
   - Add a comment documenting which SDK version these internals were tested against
   - Wrap the private attribute access in try/except to handle missing attributes gracefully
   - Log a warning if the expected attributes are not found
   - Consider tracking the subprocess PID independently at spawn time as a fallback
4. Add a note to check this code when upgrading the `claude-code-sdk` package

## Scope
- `backend/tutor.py`: Refactor `force_kill()` method
