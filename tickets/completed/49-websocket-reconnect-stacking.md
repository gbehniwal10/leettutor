# Ticket 49: WebSocket Reconnect Timeout Stacking

## Priority: MEDIUM

## Problem

In `app.js:515-533`, when the WebSocket closes, a `setTimeout` schedules a reconnect attempt. If the connection rapidly closes and reopens multiple times, each close event stacks another pending `setTimeout`. This can cause multiple simultaneous reconnect attempts, leading to duplicate connections or race conditions.

**Audit ref:** Issue #9

## Files
- `frontend/app.js` (WebSocket reconnect logic)

## Requirements

1. Track the reconnect timeout ID and clear any pending timeout before scheduling a new one (`clearTimeout` before `setTimeout`)
2. Add a guard so only one reconnect attempt is in-flight at a time
3. Consider adding a small debounce or increasing backoff to prevent rapid-fire reconnects

## Scope
- `frontend/app.js`: Fix the reconnect scheduling to prevent stacked timeouts
