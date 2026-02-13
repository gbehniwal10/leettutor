# Ticket 75: Session Lifecycle UI Cleanup

**Priority:** Medium
**Component:** `frontend/modules/session.js`, `frontend/app.js`
**Estimated Scope:** Small
**Depends on:** None
**Port of:** focus-engine `frontend/modules/session.js` lifecycle improvements

## Overview

Fix several session transition issues where stale state from a previous session bleeds into the next one, and improve the resume UX.

## Problems

1. **Stale chat messages**: Starting a new session doesn't clear the chat panel — old messages from the previous session remain visible until a new message arrives
2. **Resume has no loading state**: When resuming a session, the problem panel shows the previous problem (or nothing) while waiting — no indication that resume is in progress
3. **Resume timeout too short**: 10 seconds may not be enough for slow connections or cold-start SDK

## Implementation

### 1. Clear chat on new session start

In `handleSessionStarted()`, before rendering the new problem:
```javascript
const chatContainer = document.getElementById('chat-messages');
if (chatContainer) chatContainer.innerHTML = '';
```

### 2. Resume loading state

In `resumeSession()`, immediately show loading UI:
```javascript
const titleEl = document.getElementById('problem-title');
if (titleEl) titleEl.textContent = 'Resuming session...';
const diffEl = document.getElementById('problem-difficulty');
if (diffEl) { diffEl.textContent = ''; diffEl.className = 'difficulty'; }
const descEl = document.getElementById('problem-description');
if (descEl) {
    descEl.innerHTML = '';
    const loader = document.createElement('div');
    loader.className = 'generation-loading';
    loader.textContent = 'Restoring your session...';
    descEl.appendChild(loader);
}
```

On timeout, clean up the loading state:
```javascript
const loader = document.querySelector('.generation-loading');
if (loader) loader.remove();
const title = document.getElementById('problem-title');
if (title) title.textContent = 'Select a Problem';
```

### 3. Increase resume timeout

`RESUME_TIMEOUT_MS`: 10000 → 30000

## Acceptance Criteria

- [ ] Chat panel cleared when a new session starts
- [ ] Problem panel shows "Resuming session..." during resume
- [ ] Loading state cleaned up on resume timeout
- [ ] Resume timeout increased to 30 seconds
- [ ] No stale state visible between sessions
