# Ticket 15: Fix Retry Logic Yielding Duplicate Chunks in Tutor

**Priority:** CRITICAL
**Component:** `backend/tutor.py`
**Estimated Scope:** Medium

## Problem

The `_send_and_receive` method retries inside an async generator. If a timeout or error occurs after some chunks have already been yielded to the caller, the retry restarts from scratch. The caller receives duplicate partial content — the chunks from the failed attempt followed by the complete content from the retry. Users see duplicated text in the chat.

Additionally:
- The response streaming (`receive_response()`) has no timeout — only `query()` is wrapped in `wait_for`. A stalled stream hangs forever.
- When `self.client` is None, `chat()` silently returns an empty generator with no error to the user.

## Files to Modify

- `backend/tutor.py`

## Requirements

1. **Do not retry once any chunk has been yielded.** If streaming has started and then fails, propagate the error rather than retrying with duplicate output. Only retry if the error occurs before the first chunk.

2. **Add a timeout to the streaming loop.** Wrap the `async for` over `receive_response()` in a per-chunk or overall timeout (e.g., 60s total for the full response, or 15s per chunk).

3. **When `self.client` is None, yield an error message** instead of silently returning empty.

4. **Clean up client on connect timeout** — call `await client.disconnect()` before setting `self.client = None`.

## Acceptance Criteria

- A retry after partial streaming does not produce duplicate text.
- A stalled response stream times out rather than hanging forever.
- Missing client produces a visible error in the chat.
