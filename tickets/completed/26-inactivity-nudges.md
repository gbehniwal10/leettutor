# Ticket 26: Inactivity Nudges in Learning Mode

**Priority:** High
**Component:** `frontend/app.js`, `backend/server.py`, `backend/tutor.py`
**Estimated Scope:** Medium
**Depends on:** Ticket 21 (Settings Panel — for nudge timer configuration)

## Overview

Detect when a learner has gone idle in Learning Mode and trigger a context-aware AI nudge via the existing chat system. Currently, Interview Mode has a 2-minute stuck prompt, but Learning Mode has no proactive intervention — the AI waits passively for user messages. The research identifies this passivity as a critical failure mode for ADHD learners who experience "drift" (attention wandering without conscious awareness).

## Research Context

Section 4.2.1 of the report describes the "Tether" model for ADHD support, where inactivity and "flailing" are detected and met with proactive, context-aware nudges. The key distinction is between **bad nudges** ("Are you still there?" — annoying, guilt-inducing) and **good nudges** ("This part is tricky. Do you want a hint about the base case?" — supportive, specific). Section 4.2.1 also identifies "flailing" — running the same error repeatedly or deleting large blocks — as a separate trigger.

## Detection Logic

### Inactivity Detection (Frontend)
Track three activity signals:
1. **Keystrokes in Monaco editor** — `editor.onDidChangeModelContent`
2. **Mouse movement over the app** — debounced `mousemove` on the app container
3. **Chat messages sent** — message submission resets the timer

```javascript
class InactivityDetector {
    constructor(settingsManager, onInactive, onFlailing) {
        this.lastActivity = Date.now();
        this.enabled = true;
        // ...
    }

    recordActivity() {
        this.lastActivity = Date.now();
    }

    check() {
        const idleMinutes = (Date.now() - this.lastActivity) / 60000;
        const threshold = settingsManager.get('inactivityNudgeMinutes');
        if (threshold > 0 && idleMinutes >= threshold) {
            this.onInactive();
            this.lastActivity = Date.now(); // reset so it doesn't fire continuously
        }
    }
}
```

- Run the check every 30 seconds via `setInterval`
- Only active in Learning Mode (Interview Mode has its own system)
- Disabled when Zen Mode is active? Or still active — user might want nudges even in Zen Mode. Default: active everywhere in Learning Mode.

### Flailing Detection (Frontend)
Track rapid repeated failures:
- Count consecutive `POST /api/run` calls that return errors
- If 3+ consecutive runs produce the same error type within 5 minutes → trigger flailing nudge
- Also detect: large deletions (>10 lines removed in a single edit action)

### Nudge Delivery
When inactivity or flailing is detected, the frontend sends a new WebSocket message type:

```javascript
// Frontend → Backend
{
    "type": "nudge_request",
    "trigger": "inactivity",    // or "flailing"
    "context": {
        "idle_seconds": 145,
        "last_error": "IndexError: list index out of range",  // if flailing
        "consecutive_errors": 3,  // if flailing
        "current_code_length": 25  // lines, to gauge progress
    }
}
```

### Backend Nudge Handling
In `server.py`, handle the `nudge_request` message type:
1. Forward context to the tutor's chat method with a special system-level prompt
2. The tutor generates a context-aware nudge based on the problem, conversation history, and trigger context
3. Stream the response back as normal `assistant_chunk` / `assistant_message`

### Tutor Prompt Injection
In `tutor.py`, when a nudge is triggered, inject context into the user message:

**Inactivity nudge:**
```
[SYSTEM: The student has been inactive for {idle_seconds}s. They may be stuck or distracted.
Offer a gentle, specific nudge related to where they likely are in the problem.
Do NOT say "are you still there?" — instead, offer a concrete next step or ask a
targeted question about their approach. Keep it to 1-2 sentences.]
```

**Flailing nudge:**
```
[SYSTEM: The student has hit the same error {consecutive_errors} times: "{last_error}".
They appear frustrated. Offer a specific, empathetic hint about this error.
Explain what typically causes this error in the context of this problem.
Keep it supportive and concise.]
```

## Settings

| Setting | Control | Range | Default |
|---------|---------|-------|---------|
| `inactivityNudgeMinutes` | Slider | 0 (off), 1–10 | 2 |

When set to 0, inactivity nudges are fully disabled. Flailing detection is always on (but can be reconsidered if users find it intrusive).

## UI Considerations

- Nudge messages appear in the chat panel like normal AI messages
- Add a subtle visual indicator that this was a proactive nudge (e.g., a small "💡" prefix or italicized text) so the user knows it wasn't a response to something they said
- If the user is in Zen Mode, show the nudge as a toast notification with a "View in chat" action

## Implementation Steps

1. **Create `InactivityDetector` class** in `app.js` — tracks activity, runs timer
2. **Add flailing detection** — track consecutive same-error runs
3. **Add `nudge_request` WebSocket message type** — frontend → backend
4. **Handle nudge in `server.py`** — route to tutor with injected context
5. **Add nudge prompt templates** in `tutor.py` — inactivity and flailing variants
6. **Add setting** — `inactivityNudgeMinutes` slider in Settings panel
7. **Style nudge messages** — subtle visual differentiation in chat
8. **Zen Mode integration** — toast notification for nudges

## Acceptance Criteria

- [ ] After configured idle time in Learning Mode, AI sends a context-aware nudge
- [ ] Nudge is specific to the current problem, not generic
- [ ] After 3+ consecutive same-error runs, AI sends a flailing nudge referencing the specific error
- [ ] Nudge timer resets on any user activity (typing, mouse, chat)
- [ ] Nudges are clearly distinguishable from responses to user messages
- [ ] Setting allows disabling nudges entirely (slider to 0)
- [ ] Nudges do not fire in Interview Mode or Pattern Quiz Mode
- [ ] Nudges do not fire repeatedly — minimum 2-minute cooldown after a nudge
- [ ] If user sends a message while a nudge is pending, the nudge is cancelled
