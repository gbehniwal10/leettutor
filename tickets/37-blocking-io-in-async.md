# Ticket 37: Blocking Synchronous I/O in Async Handlers

## Priority: HIGH

## Problem

`SessionLogger` and `ProblemHistory` perform synchronous file I/O (`json.load`, `json.dump`, `open()`, `os.replace()`) inside async request/WebSocket handlers. This blocks the entire event loop for all connections during every:

- Chat message (logs message to disk)
- Hint request (logs hint count)
- Editor code update (saves last code)
- Timer update (saves time remaining)
- Session list/get API calls (reads from disk, iterates directory)
- Problem history reads/writes

On a single-user local app this is tolerable, but under any concurrent load (multiple tabs, or future multi-user), these blocking calls serialize all async work.

## Files
- `backend/session_logger.py`: `_save()`, `list_sessions()`, `get_session()`, `find_latest_resumable_session()`, `resume_session()`
- `backend/problem_history.py`: `_load()`, `_save()`

## Options

### Option A: `asyncio.to_thread()` (minimal change)
Wrap blocking calls in `await asyncio.to_thread(self._save)` etc. Requires callers to be async, which means `SessionLogger` methods that call `_save()` become async.

### Option B: `aiofiles` library
Replace `open()` with `aiofiles.open()` for non-blocking file I/O. More invasive but properly async.

### Option C: Accept for now, document limitation
This is a local single-user app. Add a comment documenting the limitation and revisit if multi-user support is added.

## Recommendation
Option A is the best balance — `asyncio.to_thread()` is stdlib, requires minimal refactoring, and unblocks the event loop. The main cost is making `SessionLogger` methods async, which ripples through `server.py` WebSocket handler calls.

## Scope
- `backend/session_logger.py`: Make I/O methods async via `to_thread()`
- `backend/problem_history.py`: Same
- `backend/server.py`: Add `await` to all `session_logger.*()` and `_problem_history.*()` calls
