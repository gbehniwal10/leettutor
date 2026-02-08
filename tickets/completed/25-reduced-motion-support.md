# Ticket 25: Reduced Motion Support

**Priority:** High
**Component:** `frontend/style.css`, `frontend/app.js`
**Estimated Scope:** Small
**Depends on:** Ticket 21 (Settings Panel — for the manual override setting)

## Overview

Add `prefers-reduced-motion` media query support and a manual override toggle. Currently, the codebase has CSS transitions on panel resizing and various UI interactions with no opt-out. For autistic users with sensory hypersensitivity or users with vestibular disorders, unexpected motion can be distressing or physically disorienting.

## Research Context

Section 3.1 of the cognitive ergonomics report emphasizes that all animations and micro-interactions "must be toggleable" and that the OS `prefers-reduced-motion` preference "should be respected immediately." This is also a WCAG 2.1 Level AAA requirement (2.3.3 Animation from Interactions).

## Current State

Animations/transitions in the codebase that need to be addressed:

- Panel resize transitions (`style.css` — `transition` properties on panels)
- Modal open/close animations
- Test result banner appearance
- Button hover/active state transitions
- Any future micro-feedback animations (Ticket 27)
- Loading spinners (these should remain — they indicate progress, not decoration)

## Implementation

### CSS Approach
Wrap all decorative transitions in a media query:

```css
/* Default: animations enabled */
.panel { transition: width 0.2s ease; }
.modal { transition: opacity 0.15s ease; }

/* Respect OS preference */
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
}

/* Manual override: user forced reduced motion on */
[data-reduced-motion="on"] *,
[data-reduced-motion="on"] *::before,
[data-reduced-motion="on"] *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
}
```

Using `0.01ms` instead of `0` preserves animation end-state callbacks and `transitionend` event firing.

### Settings Integration
The `reducedMotion` setting (from Ticket 21) has three values:
- `"system"` (default) — respect `prefers-reduced-motion` media query only
- `"on"` — always reduce motion, regardless of OS setting
- `"off"` — never reduce motion, even if OS says reduce

Set `data-reduced-motion` attribute on `<html>`:
- `"system"` → no attribute (let the media query handle it)
- `"on"` → `data-reduced-motion="on"`
- `"off"` → `data-reduced-motion="off"` (override the media query with a more specific selector)

### JavaScript Check
Expose a helper for JS-driven animations (confetti in Ticket 27, etc.):
```javascript
function shouldReduceMotion() {
    const setting = settingsManager.get('reducedMotion');
    if (setting === 'on') return true;
    if (setting === 'off') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

## Implementation Steps

1. **Audit CSS** for all `transition` and `animation` properties
2. **Add `prefers-reduced-motion` media query** with blanket override
3. **Add `[data-reduced-motion]` attribute selectors** for manual override
4. **Wire to SettingsManager** — set attribute on `<html>` based on setting
5. **Expose `shouldReduceMotion()` helper** for JS animations
6. **Test** with macOS "Reduce motion" accessibility setting toggled

## Acceptance Criteria

- [ ] When OS "Reduce motion" is on, all CSS transitions and animations are suppressed
- [ ] Settings panel has a three-way toggle: System / On / Off
- [ ] Manual "On" overrides OS preference (reduces motion even if OS allows it)
- [ ] Manual "Off" overrides OS preference (allows motion even if OS reduces it)
- [ ] Loading spinners and progress indicators are NOT affected (they serve a functional purpose)
- [ ] `shouldReduceMotion()` JS helper is available for Tickets 27 and 33
- [ ] `transitionend` and `animationend` events still fire (using 0.01ms, not 0)
