# Ticket 47: Disconnect MutationObservers on Cleanup

## Priority: LOW

## Problem

Two `MutationObserver` instances created in `app.js` (at approximately lines 2561 and 3102) are connected but never disconnected. These observers — used for TTS and earcons features — continue running indefinitely even after the features they support are no longer active. While the memory impact is small, they fire callbacks on every DOM mutation in their observed subtree, causing unnecessary work.

**Audit ref:** Issue #26

## Files
- `frontend/app.js` (MutationObserver creation and lifecycle)

## Requirements

1. Store references to both MutationObserver instances
2. Call `.disconnect()` on each observer when:
   - The observed feature is disabled (e.g., TTS turned off, earcons muted)
   - The session ends
   - The component they observe is removed from the DOM
3. Re-connect the observer when the feature is re-enabled
4. Ensure no callbacks fire after disconnect

## Scope
- `frontend/app.js`: Add observer lifecycle management (store refs, disconnect on feature disable / session end, reconnect on enable)
