# Ticket 21: Settings Panel + Preference Persistence

**Priority:** High
**Component:** `frontend/app.js`, `frontend/index.html`, `frontend/style.css`
**Estimated Scope:** Medium
**Depends on:** None (foundation for tickets 22–25, 30, 32, 33)

## Overview

Add a user-facing Settings panel with localStorage persistence. This is the foundation that all other neuro-inclusive features plug into — theme, typography, audio, zen mode, etc. all need a place to live and a way to persist across sessions.

Currently, the only localStorage usage is Pattern Quiz stats. There is no settings UI and no preference system.

## Research Context

The cognitive ergonomics report (Section 2.3) identifies user control over the environment as a "potent anxiety-reducing mechanism." Users who can customize their workspace experience lower extraneous cognitive load (Cognitive Load Theory, Section 1.1.3). A settings system is the prerequisite for nearly every other neuro-inclusive feature.

## UI Design

### Settings Button
- Add a gear icon (⚙) button in the header bar, right-aligned near existing controls
- Opens a modal/slide-out panel overlay
- Close via X button, Escape key, or clicking outside

### Settings Panel Layout
- Organized into collapsible sections:
  1. **Appearance** — Theme, font size, font family, line height, editor ligatures
  2. **Focus** — Zen mode toggle, inactivity nudge timer, Pomodoro settings
  3. **Audio** — Ambient sounds toggle/volume, earcons toggle, TTS voice selection
  4. **Accessibility** — Reduced motion, high contrast, confirmation dialogs
- Each section has a header that expands/collapses its contents
- Changes apply immediately (live preview) — no "Save" button needed

### Settings Categories (Initial)
For this ticket, implement the panel shell and persistence layer. Populate with these initial settings only (other tickets add their own):

```javascript
const DEFAULT_SETTINGS = {
    // Appearance
    theme: "dark",              // "dark", "sepia", "low-distraction"
    editorFontSize: 14,         // 12–24, step 1
    editorFontFamily: "default", // "default", "jetbrains-mono", "fira-code"
    editorLineHeight: 1.5,     // 1.2–2.0, step 0.1
    editorLigatures: false,     // on/off

    // Focus
    zenMode: false,
    inactivityNudgeMinutes: 2,  // 0 = disabled, 1–10

    // Audio
    ambientSound: "off",        // "off", "brown-noise", "pink-noise"
    ambientVolume: 0.3,         // 0.0–1.0
    earcons: false,

    // Accessibility
    reducedMotion: "system",    // "system", "on", "off"
    confirmDestructive: true,   // confirm reset/quit actions
};
```

## Persistence Layer

### localStorage Schema
```javascript
// Key: "leettutor_settings"
// Value: JSON string of user settings (only stores overrides from defaults)
{
    "theme": "sepia",
    "editorFontSize": 16,
    "editorLineHeight": 1.8
}
```

### API
```javascript
class SettingsManager {
    constructor(defaults) { ... }

    get(key)            // Returns current value (user override or default)
    set(key, value)     // Saves override, emits change event
    reset(key)          // Removes override, reverts to default
    resetAll()          // Clears all overrides
    getAll()            // Returns merged defaults + overrides

    onChange(key, callback)  // Subscribe to changes on a specific key
    onAnyChange(callback)   // Subscribe to any change
}
```

- Emit events via a simple pub/sub pattern so other components can react to setting changes without polling
- On page load, read from localStorage and apply all settings immediately (before first render if possible, to avoid flash)

### Settings Applied On Load
Settings must be applied early to prevent visual flash:
1. Read `leettutor_settings` from localStorage in a `<script>` tag in `<head>` (before CSS loads)
2. Set `data-theme` attribute on `<html>` element
3. Set `data-reduced-motion` attribute
4. Apply editor settings when Monaco initializes

## Implementation Steps

1. **Create `SettingsManager` class** in `app.js` with get/set/persist/event logic
2. **Add settings button** to header in `index.html`
3. **Build settings modal** — panel shell with collapsible sections
4. **Wire up initial controls** — theme dropdown, font size slider, line height slider, reduced motion toggle, confirm destructive toggle
5. **Apply settings on load** — early script in `<head>` for theme, Monaco config for editor settings
6. **Emit change events** — so other features (tickets 22–33) can subscribe

## Acceptance Criteria

- [ ] Gear icon button visible in header
- [ ] Settings panel opens/closes cleanly (modal or slide-out)
- [ ] Settings are organized into collapsible sections
- [ ] All settings in `DEFAULT_SETTINGS` have corresponding UI controls
- [ ] Changes persist in localStorage across page refreshes
- [ ] Changes apply immediately without requiring page refresh
- [ ] `SettingsManager` exposes `onChange` events for other features to subscribe
- [ ] "Reset to defaults" button works
- [ ] Settings panel is keyboard-navigable (Tab, Enter, Escape to close)
- [ ] No visual flash on load — theme/font applied before first paint
