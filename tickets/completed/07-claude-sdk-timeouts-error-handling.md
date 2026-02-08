# Ticket 07: Claude SDK Timeouts and Error Handling

**Priority:** HIGH
**Component:** `backend/tutor.py`
**Estimated Scope:** Medium

## Problem

1. **No timeout on SDK calls** (lines 102, 131-136): `await self.client.connect()` and `await self.client.query()` / `self.client.receive_response()` have no timeout. If the Claude SDK hangs or the network stalls, the WebSocket handler blocks indefinitely.

2. **Partial initialization** (lines 96-102): `self.client` is assigned before `connect()` is awaited. If `connect()` raises, `self.client` is left set to a non-connected object. Subsequent `chat()` calls pass the `if not self.client` guard and try to use a broken client.

3. **Stale system prompt** (lines 97-98): The system prompt is built once at session start with `hint_count=0`, `time_remaining=45:00`, `interview_phase="clarification"`. As these values change during the session, the model never sees the updates — making hint tracking, timer, and phase transitions non-functional from the AI's perspective.

4. **`hint_count` increments before the SDK call** (line 140): If the call fails, the hint count is already incremented, skipping a level on the next attempt.

5. **No input length limit** (lines 104, 128-131): Arbitrarily large user messages are forwarded to the SDK, potentially exceeding token limits and incurring large costs.

## Files to Modify

- `backend/tutor.py`

## Requirements

1. Wrap all SDK calls in `asyncio.wait_for()` with a reasonable timeout (e.g., 60s for responses, 15s for connect).

2. Fix initialization order: only set `self.client` after `connect()` succeeds, or set it to `None` in the except block.

3. Update the system prompt dynamically or pass state updates as context in messages so the model sees current `hint_count`, `time_remaining`, and `interview_phase`.

4. Move `self.hint_count += 1` to after the successful SDK response.

5. Add input length validation — reject or truncate messages over a reasonable limit (e.g., 10KB).

6. Add retry logic for transient failures (rate limits, network hiccups) — 1-2 retries with short backoff.

## Acceptance Criteria

- A hung SDK call times out after the configured duration and returns an error to the user.
- A failed `connect()` leaves the tutor in a clean state (client is `None`).
- The AI model sees accurate hint count, time remaining, and interview phase.
- Failed hint requests don't skip hint levels.
- Oversized messages are rejected with a user-friendly error.
