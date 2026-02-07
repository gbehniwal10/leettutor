# Ticket 22: Zen / Focus Mode Toggle

**Priority:** High
**Component:** `frontend/app.js`, `frontend/style.css`
**Estimated Scope:** Small
**Depends on:** Ticket 21 (Settings Panel)

## Overview

Add a one-click "Zen Mode" that strips the interface down to just the code editor and a minimal status bar. This is the highest-impact ADHD feature identified in the cognitive ergonomics research — it directly combats Attention Capture Damaging Patterns (ACDPs) by removing all visual noise.

## Research Context

Section 2.3.2 of the report identifies workspace customization as a "potent anxiety-reducing mechanism." The "Purpose Mode" research from MIT (Section 2.3.1) demonstrates that toggling attention between "focused" and "full" views reduces distraction and increases task completion. Zen mode mimics "distraction-free writing" modes but applied to code, addressing the "Attentional Roach Motel" pattern.

## UI Design

### Toggle Button
- Add a prominent button in the header: a simple expand icon (⛶) or "Focus" label
- Keyboard shortcut: `Ctrl+Shift+Z` (or `Cmd+Shift+Z` on Mac)
- The button should be visible even in Zen Mode (part of the minimal status bar)

### What Zen Mode Hides
- Problem description panel (left side)
- Chat panel (right side)
- Header navigation (mode selector, problem selector, difficulty filters)
- Session history button
- Any non-essential chrome

### What Zen Mode Shows
- **Code editor** — expanded to fill the full viewport width
- **Minimal status bar** at the top or bottom containing:
  - Problem title (text only, not the full description)
  - Run / Submit buttons
  - Zen Mode exit button
  - Timer (if in Interview mode)
  - Hint button (small, unobtrusive)
- **Test results** — shown as a compact overlay/toast when code is run, auto-dismisses after a few seconds

### Transitions
- If `prefers-reduced-motion` is active or the `reducedMotion` setting is "on": instant toggle, no animation
- Otherwise: panels slide out with a quick 200ms transition

### State Preservation
- Entering Zen Mode remembers current panel widths
- Exiting Zen Mode restores the exact previous layout
- Zen Mode state persists via the SettingsManager (`zenMode: true/false`)
- If the user refreshes while in Zen Mode, they should return to Zen Mode

## Implementation Steps

1. **Add `body.zen-mode` CSS class** that hides panels and expands editor
2. **Create minimal status bar** element (hidden by default, shown in Zen Mode)
3. **Add toggle button** in header + keyboard shortcut
4. **Wire to SettingsManager** — `zenMode` setting drives the toggle
5. **Handle test results in Zen Mode** — compact toast overlay instead of full results panel
6. **Respect reduced motion** — skip transitions when appropriate

## Acceptance Criteria

- [ ] Single click/keypress toggles Zen Mode on and off
- [ ] In Zen Mode, only the editor, status bar, and run/submit are visible
- [ ] Problem title is shown in the status bar so user knows what they're working on
- [ ] Test results appear as a temporary overlay in Zen Mode
- [ ] Panel widths are preserved and restored on exit
- [ ] Keyboard shortcut `Ctrl+Shift+Z` / `Cmd+Shift+Z` works
- [ ] Zen Mode persists across page refresh via SettingsManager
- [ ] Transitions respect the reduced motion setting
- [ ] Chat messages received while in Zen Mode are not lost (queued for when user exits)
