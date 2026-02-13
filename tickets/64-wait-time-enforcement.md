# Ticket 64: Wait Time Enforcement

**Priority:** High
**Component:** `backend/ws_handler.py`, `frontend/modules/inactivity.js`
**Estimated Scope:** Small
**Depends on:** None
**Port of:** focus-engine ticket 048
**Reference:** `focus-engine/backend/focus_session.py` lines 63–74, 128, 147–157, 441, 475, 514

## Overview

After the tutor asks a question (message ending with `?`), suppress idle nudges for 5 seconds to give the student productive thinking time. Currently, the nudge system runs on fixed timers regardless of whether the tutor just asked something — this can interrupt the student's cognitive processing at exactly the wrong moment.

## Research Evidence

- Mary Budd Rowe (1972, replicated extensively): 3–5 second educator silence after a question significantly improves answer quality, length, and logical coherence
- ADHD vision research: the "linger" / disengagement effect means interruptions during thinking are disproportionately costly for ADHD users — recovery time from an interruption is longer

## Implementation

### Backend (`ws_handler.py`)

Add to `WebSocketSession`:

```python
WAIT_TIME_SECS = 5  # Rowe (1972) wait-time research

# Instance variable
self._wait_time_until: float = 0.0

def _set_wait_time_if_question(self, response: str) -> None:
    """If tutor response ends with '?', suppress nudges briefly."""
    if response.rstrip().endswith("?"):
        self._wait_time_until = time.time() + WAIT_TIME_SECS

def _is_wait_time_active(self) -> bool:
    return time.time() < self._wait_time_until

def _clear_wait_time(self) -> None:
    self._wait_time_until = 0.0
```

Integration points:
1. After streaming a complete `assistant_message`, call `_set_wait_time_if_question(full_response)`
2. In `handle_nudge_request()`, check `if self._is_wait_time_active(): return` before forwarding to tutor
3. On user message receipt, call `_clear_wait_time()`
4. On code submission (`run`/`submit`), call `_clear_wait_time()`

### Frontend (`inactivity.js`)

No changes strictly required — the backend suppresses the nudge. But optionally:
- During wait time, do NOT show typing indicator (silence is the point)
- This would require a `wait_time_active` field in assistant messages, which may be overengineering for now

## Constants

| Constant | Value | Location |
|----------|-------|----------|
| `WAIT_TIME_SECS` | `5` | `ws_handler.py` (module-level) |

## Acceptance Criteria

- [ ] After tutor sends a message ending with `?`, nudges are suppressed for 5 seconds
- [ ] Wait time clears on: user message, code submission, or natural timeout
- [ ] `WAIT_TIME_SECS` is a named constant at module level
- [ ] Nudge handler returns early (silently) during wait time
- [ ] Existing tests pass
- [ ] New test in `test_ws_protocol.py`: nudge suppressed after question, resumes after timeout
