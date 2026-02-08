# Ticket 29: Friction on Destructive Actions

**Priority:** Medium-High
**Component:** `frontend/app.js`, `frontend/style.css`
**Estimated Scope:** Small
**Depends on:** Ticket 21 (Settings Panel — for `confirmDestructive` toggle)

## Overview

Add confirmation dialogs with encouraging language to destructive actions like resetting code and ending sessions. Currently, these actions execute immediately with no confirmation. The research identifies impulsive quitting as a key ADHD failure mode and recommends "selective friction" — adding a brief pause that gives the prefrontal cortex time to override impulse.

## Research Context

Section 3.3 of the cognitive ergonomics report distinguishes between **destructive friction** (barriers to starting) and **constructive friction** (barriers to quitting). For ADHD users, "a modal asking 'Are you sure? You've written 50 lines. Maybe take a break instead?' acts as an inhibition brake, giving the user's prefrontal cortex a moment to catch up with their impulsive desire to quit."

Conversely, the report recommends **removing friction** from getting started — the existing session resume feature (Ticket 18) already addresses this.

## Actions That Need Confirmation

| Action | Trigger | Current Behavior |
|--------|---------|-----------------|
| Reset Code | "Reset" button in editor toolbar | Instantly replaces code with starter code |
| End Session | "End Session" / switching problems | Immediately tears down session |
| Leave Page | Browser back/close while session active | No warning |
| Clear Chat | If a "Clear Chat" action exists | Instantly clears |

## Confirmation Dialog Design

### Modal Structure
```
┌─────────────────────────────────────────┐
│                                         │
│   Are you sure you want to reset?       │
│                                         │
│   You've written 23 lines of code.      │
│   Maybe take a break and come back      │
│   with fresh eyes instead?              │
│                                         │
│   [ Take a Break ]    [ Reset Code ]    │
│                                         │
└─────────────────────────────────────────┘
```

### Key Design Principles
- **Encouraging, not guilt-tripping**: "Maybe take a break" not "You'll lose everything!"
- **Contextual stats**: Show concrete progress (line count, tests passed) to make the cost tangible
- **Default action is non-destructive**: "Take a Break" is visually primary (filled button); "Reset Code" is secondary (outline button)
- **Keyboard support**: Escape cancels (non-destructive default), Enter activates the primary (non-destructive) button

### Per-Action Messages

**Reset Code:**
> "You've written {lineCount} lines. Reset to starter code?"
> Secondary: "Maybe save your approach in the chat first — describe what you've tried so far."
> Buttons: [Keep Coding] [Reset]

**End Session:**
> "End this session? Your progress on {problemTitle} will be saved."
> Secondary: "You can resume this session later from the history."
> Buttons: [Keep Going] [End Session]

**Leave Page (beforeunload):**
> Standard browser `beforeunload` prompt: "You have an active coding session. Leave anyway?"

### Settings Toggle
The `confirmDestructive` setting (Ticket 21) controls this:
- `true` (default): Show confirmation dialogs
- `false`: Execute actions immediately (for users who find the dialogs annoying)

## Implementation Steps

1. **Create reusable confirmation modal component** — accepts title, message, primary/secondary button config
2. **Wire Reset Code** — intercept reset action, show confirmation with line count
3. **Wire End Session** — intercept end/switch action, show confirmation with problem title
4. **Wire beforeunload** — add `window.onbeforeunload` when session is active
5. **Add settings toggle** — `confirmDestructive` in Settings panel
6. **Respect toggle** — bypass dialogs entirely when setting is false

## Acceptance Criteria

- [ ] Resetting code shows a confirmation dialog with current line count
- [ ] Ending a session shows a confirmation dialog with problem title
- [ ] Closing/navigating away from the page triggers a `beforeunload` warning during active sessions
- [ ] Dialogs use encouraging language, not guilt or fear
- [ ] Default (Enter/Escape) behavior favors the non-destructive action
- [ ] `confirmDestructive` setting can disable all confirmation dialogs
- [ ] Dialogs are styled consistently with the current theme
- [ ] Dialogs are keyboard-accessible (Tab between buttons, Escape to cancel)
