# Ticket 74: Focus Mode — Click Debouncing & Scroll Bookmarks

**Priority:** Medium
**Component:** `frontend/modules/` (new module), `frontend/app.js`
**Estimated Scope:** Small (new ~80-line module)
**Depends on:** None
**Port of:** focus-engine `frontend/modules/focus-mode.js`

## Overview

Add a `focus-mode.js` module that prevents accidental double-clicks on action buttons and bookmarks scroll positions so users don't lose their place when switching contexts.

## Problem

- Double-clicking "Run" or "Submit" sends duplicate requests
- Scrolling through a long problem description, switching to chat, then switching back resets scroll position
- These are especially problematic for users with ADHD (impulsive clicking, context switching)

## Implementation

### 1. Create `frontend/modules/focus-mode.js`

```javascript
import { CLICK_DEBOUNCE_MS } from './constants.js';

// --- Click debouncing ---
function debounceButton(btn) {
    btn.addEventListener('click', () => {
        btn.disabled = true;
        setTimeout(() => { btn.disabled = false; }, CLICK_DEBOUNCE_MS);
    }, { capture: true });
}

// --- Scroll bookmarking (sessionStorage) ---
function bookmarkScroll(container, key) {
    const saved = sessionStorage.getItem(`scroll-${key}`);
    if (saved) container.scrollTop = parseInt(saved, 10);
    container.addEventListener('scroll', () => {
        sessionStorage.setItem(`scroll-${key}`, container.scrollTop);
    }, { passive: true });
}

export function initFocusMode() {
    const debounceIds = [
        'run-btn', 'submit-btn', 'reset-btn', 'give-up-btn'
    ];
    for (const id of debounceIds) {
        const btn = document.getElementById(id);
        if (btn) debounceButton(btn);
    }

    const problemDesc = document.getElementById('problem-description');
    if (problemDesc) bookmarkScroll(problemDesc, 'problem-desc');
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) bookmarkScroll(chatMessages, 'chat-messages');
}
```

### 2. Add constant

In `constants.js`: `export const CLICK_DEBOUNCE_MS = 300;`

### 3. Wire in `app.js`

Import and call `initFocusMode()` during DOMContentLoaded.

## Acceptance Criteria

- [ ] New `focus-mode.js` module with `initFocusMode()` export
- [ ] Run/Submit/Reset/Give-up buttons debounced (300ms)
- [ ] Problem description and chat scroll positions persisted in sessionStorage
- [ ] `CLICK_DEBOUNCE_MS` defined in `constants.js`
- [ ] Wired in `app.js`
- [ ] No visual changes
