# Ticket 23: Theme System (Dark / Sepia / Low-Distraction)

**Priority:** High
**Component:** `frontend/style.css`, `frontend/app.js`, `frontend/index.html`
**Estimated Scope:** Medium
**Depends on:** Ticket 21 (Settings Panel)

## Overview

Replace the hardcoded dark theme with a CSS variable-driven theme system supporting three modes: Dark (current), Sepia/Cream (optimized for dyslexia and visual stress), and Low-Distraction (desaturated for high distractibility). Respect the OS `prefers-color-scheme` preference.

## Research Context

Section 2.2 of the cognitive ergonomics report details how extreme contrast (pure black on pure white) can trigger Scotopic Sensitivity Syndrome — text appearing to "vibrate" or "river" — in dyslexic and autistic users. Research shows cream/sepia backgrounds (#FAFAC8, #FDF6E3) produce the highest reading speed among dyslexic subjects. Conversely, users with photophobia benefit from dark grey (#2D2D2D) rather than pure black, which causes "haloing." The report also recommends a low-saturation monochromatic mode for users with high distractibility.

## Theme Definitions

### Dark (current, refined)
The existing theme, adjusted slightly to avoid pure black:
```css
[data-theme="dark"] {
    --bg-primary: #1e1e1e;        /* was #1e1e1e — keep */
    --bg-secondary: #252526;       /* panel backgrounds */
    --bg-tertiary: #2d2d2d;        /* input fields, hover states */
    --text-primary: #d4d4d4;       /* main text — off-white, not pure white */
    --text-secondary: #888888;     /* muted text */
    --text-accent: #569cd6;        /* links, highlights */
    --border-color: #3e3e3e;
    --success: #4ec9b0;
    --error: #f48771;
    --warning: #dcdcaa;
    /* Monaco theme: "leetcode-dark" (existing) */
}
```

### Sepia (dyslexia-optimized)
Warm cream background with dark grey text, reducing glare and visual stress:
```css
[data-theme="sepia"] {
    --bg-primary: #fdf6e3;        /* Solarized Light base */
    --bg-secondary: #f5eed6;
    --bg-tertiary: #eee8c8;
    --text-primary: #1e1e1e;
    --text-secondary: #586e75;
    --text-accent: #268bd2;
    --border-color: #d3c6a6;
    --success: #2aa198;
    --error: #dc322f;
    --warning: #b58900;
    /* Monaco theme: map to a light solarized-like theme */
}
```

### Low-Distraction (desaturated)
Muted greys with minimal color, reducing the "angry fruit salad" effect of excessive syntax highlighting:
```css
[data-theme="low-distraction"] {
    --bg-primary: #2b2b2b;
    --bg-secondary: #313131;
    --bg-tertiary: #383838;
    --text-primary: #c0c0c0;
    --text-secondary: #808080;
    --text-accent: #a0a0a0;       /* muted, not vibrant */
    --border-color: #404040;
    --success: #8fbc8f;           /* desaturated green */
    --error: #cd8c8c;             /* desaturated red */
    --warning: #cdcd8c;           /* desaturated yellow */
    /* Monaco theme: custom monochromatic theme */
}
```

## Implementation

### CSS Variables Migration
- Replace all hardcoded color values in `style.css` with `var(--variable-name)` references
- Define the three themes using `[data-theme="..."]` selectors on the `<html>` element
- The `data-theme` attribute is set by SettingsManager on load

### Monaco Editor Theme Sync
- Create three Monaco themes corresponding to the three app themes
- When the theme changes, call `monaco.editor.setTheme()` to update the editor
- Map:
  - `dark` → existing `leetcode-dark` theme (refined)
  - `sepia` → new `leetcode-sepia` theme (light background, warm tones)
  - `low-distraction` → new `leetcode-muted` theme (dark, desaturated syntax colors)

### OS Preference Detection
- On first load (no saved preference), check `window.matchMedia('(prefers-color-scheme: light)')
- If OS prefers light, default to `sepia`; otherwise default to `dark`
- User's explicit choice in settings always overrides OS preference

### Syntax Highlighting Accessibility
- Ensure no information is conveyed by color alone in any theme
- Keywords use **bold** in addition to color
- Error indicators use an icon (⚠) in addition to color
- Test results use icons (✓ / ✗) alongside colored text

## Implementation Steps

1. **Audit `style.css`** — identify all hardcoded color values
2. **Create CSS variable system** — define variables, replace hardcoded values
3. **Define three themes** — dark, sepia, low-distraction as `[data-theme]` selectors
4. **Create Monaco themes** — register `leetcode-sepia` and `leetcode-muted` editor themes
5. **Wire to SettingsManager** — theme dropdown in settings triggers `data-theme` attribute change + Monaco theme swap
6. **Add OS preference detection** — `matchMedia` listener for first-load default
7. **Add non-color indicators** — icons and bold for error states, keywords, test results

## Acceptance Criteria

- [ ] All colors in `style.css` use CSS variables (no hardcoded hex outside theme definitions)
- [ ] Three themes selectable from Settings panel
- [ ] Theme applies instantly on change — no page refresh needed
- [ ] Monaco editor theme syncs with app theme
- [ ] Sepia theme has warm cream background with high readability
- [ ] Low-Distraction theme has desaturated syntax highlighting
- [ ] OS `prefers-color-scheme` sets sensible default on first visit
- [ ] Error/success states use icons in addition to color in all themes
- [ ] No flash of wrong theme on page load
