# Ticket 38: Interleaved Chat Responses from Concurrent Messages

## Priority: HIGH

## Problem

In the WebSocket handler (`server.py`), when a user sends two messages in rapid succession, both hit the `elif msg_type == "message"` branch and call `tutor.chat()` concurrently. Since `tutor.chat()` is an async generator that yields streamed chunks, the chunks from both responses arrive interleaved on the WebSocket, producing garbled output.

Example:
1. User sends "How do I start?"
2. User immediately sends "Should I use a hash map?"
3. Both `tutor.chat()` calls stream simultaneously
4. Frontend receives: "Great question" + "Yes, a hash" + "! Let's think" + " map would be" + ...

This also affects `request_hint` and `nudge_request` handlers — any concurrent streaming response.

## Files
- `backend/server.py`: WebSocket handler (`websocket_chat`)

## Requirements

1. Add a per-connection `asyncio.Lock` (e.g., `_chat_lock`) that serializes all calls to `tutor.chat()`, `tutor.request_hint()`, and `tutor.enter_review_phase()`
2. Acquire the lock before streaming and release after the final `assistant_message` is sent
3. Messages that arrive while the lock is held should queue and execute in order, not be dropped

## Implementation Notes
- The lock should be created per-connection (inside `websocket_chat()`), not global
- The lock does NOT need to cover `time_update` or `end_session` — only streaming response handlers
- Consider also guarding the `start_session` greeting to prevent overlap with an early user message

## Scope
- `backend/server.py`: Add per-connection lock around streaming chat calls
