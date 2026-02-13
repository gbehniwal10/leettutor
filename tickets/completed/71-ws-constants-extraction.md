# Ticket 71: Extract WebSocket Constants to Dedicated Module

**Priority:** High
**Component:** `backend/ws_handler.py`, all backend handlers
**Estimated Scope:** Small (mechanical extraction, no logic changes)
**Depends on:** None
**Port of:** focus-engine `backend/ws_constants.py`

## Overview

Extract all WebSocket message types (`MSG_*`) and error codes (`ERR_*`) from inline string literals scattered across `ws_handler.py` into a dedicated `backend/ws_constants.py` module. This prevents typos, enables IDE autocomplete, and breaks circular import chains.

## Problem

Currently, message type strings like `"start_session"`, `"message"`, `"error"` appear as inline literals throughout `ws_handler.py` and are duplicated in any handler modules that need them. This creates:
- Typo risk (silent bugs — misspelled type string never matches)
- Circular imports when extracting handler logic into separate modules
- No single source of truth for the WebSocket protocol

## Implementation

### 1. Create `backend/ws_constants.py`

Pure data module — exempt from line-count limits per CLAUDE.md rules.

```python
# Client → Server
MSG_START_SESSION = "start_session"
MSG_MESSAGE = "message"
MSG_REQUEST_HINT = "request_hint"
MSG_RESUME_SESSION = "resume_session"
MSG_END_SESSION = "end_session"
MSG_TIME_UPDATE = "time_update"
MSG_TIME_UP = "time_up"
MSG_AUTH = "auth"

# Server → Client
MSG_SESSION_STARTED = "session_started"
MSG_SESSION_RESUMED = "session_resumed"
MSG_ASSISTANT_CHUNK = "assistant_chunk"
MSG_ASSISTANT_MESSAGE = "assistant_message"
MSG_ERROR = "error"

# Error codes
ERR_MISSING_FIELDS = "MISSING_FIELDS"
ERR_INVALID_SESSION = "INVALID_SESSION"
ERR_SESSION_NOT_FOUND = "SESSION_NOT_FOUND"
ERR_TUTOR_FAILED = "TUTOR_FAILED"
ERR_CHAT_FAILED = "CHAT_FAILED"
ERR_INTERNAL = "INTERNAL"
```

Audit `ws_handler.py` for the complete set — the above is a starting point.

### 2. Update all consumers

Replace every inline string literal with the corresponding constant import. Affected files:
- `backend/ws_handler.py` (primary consumer)
- Any future handler extraction modules
- Frontend `modules/constants.js` should already have matching constants (verify parity)

### 3. Verify frontend parity

Cross-check `frontend/modules/constants.js` `WS_MESSAGE_TYPES` object against the new backend constants. Document any mismatches.

## Acceptance Criteria

- [ ] `backend/ws_constants.py` created with all message types and error codes
- [ ] Zero inline string literals for message types in `ws_handler.py`
- [ ] All imports verified (no circular imports introduced)
- [ ] Frontend `constants.js` matches backend constants
- [ ] Existing tests pass unchanged
