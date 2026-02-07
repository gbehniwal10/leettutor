# Ticket 36: Frontend Missing Fetch Error Handling

## Priority: HIGH

## Problem

Six `fetch()` calls parse `response.json()` without first checking `response.ok`. If the server returns a non-2xx status with a JSON body, the frontend treats it as a successful response, leading to silent failures or confusing behavior.

Affected locations in `app.js`:
- **Line ~630** `loadProblems()`: `state.allProblems = await response.json()` — no `.ok` check
- **Line ~772** `selectProblem()`: `state.currentProblem = await response.json()` — no `.ok` check
- **Line ~783** `selectProblem()` resumable session check: `res.json()` — no `.ok` check
- **Line ~951** `handleSessionResumed()`: `response.json()` — no `.ok` check
- **Line ~1318** `loadSessions()`: `response.json()` — no `.ok` check
- **Line ~1373** `viewSession()`: `response.json()` — no `.ok` check

## Files
- `frontend/app.js`

## Requirements

1. Add `response.ok` checks before calling `.json()` on all six fetch calls
2. On failure, show appropriate user feedback (e.g., "Failed to load problems", "Session not found")
3. For `loadProblems()`, consider a retry or visible error state instead of silent blank list
4. Handle the case where `.json()` itself throws (malformed response body) — wrap in try/catch or let outer catch handle it

## Scope
- `frontend/app.js`: Add guards to 6 fetch call sites
