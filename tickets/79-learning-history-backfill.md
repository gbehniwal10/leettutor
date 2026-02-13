# Ticket 79: Learning History Backfill from Session Logs

**Priority:** Low–Medium
**Component:** `backend/session_logger.py` or new `backend/learning_history.py`
**Estimated Scope:** Small–Medium (~60 lines)
**Depends on:** Ticket 69 (spaced review, if implementing learning history)
**Port of:** focus-engine `backend/learning_history.py` `_backfill_from_sessions()`

## Overview

When a learning history feature is added (ticket 69), existing users will have session logs in `sessions/` but no `learning_history.json`. Rather than starting from scratch, backfill the history by scanning existing session files on first load.

## Implementation

On `LearningHistory.load()`, if no `learning_history.json` exists:

1. Scan `sessions/*.json` for files matching UUID pattern (`^[0-9a-f]{8,}$`)
2. For each session file, extract: `difficulty`, `final_result` (solved/unsolved), `duration_seconds`, `hint_count`, `problem_tags`
3. Group by topic tags, sort by timestamp
4. Write the backfilled `learning_history.json`

### Safety

- Use compiled regex `_SESSION_FILE_RE = re.compile(r'^[0-9a-f]{8,}\.json$')` to filter filenames (prevents path traversal)
- Backfill runs once and is idempotent — if `learning_history.json` already exists, skip
- Log how many sessions were backfilled

## Note

This ticket only makes sense if leettutor implements a learning history / spaced review system (ticket 69). If ticket 69 is deferred, this ticket should be deferred too.

## Acceptance Criteria

- [ ] Backfill runs automatically on first load when no history file exists
- [ ] Only processes files matching UUID pattern (no path traversal risk)
- [ ] Extracts relevant fields from session logs
- [ ] Runs once, idempotent
- [ ] Logs backfill count at INFO level
- [ ] Test: backfill from 3 sample session files produces correct history
