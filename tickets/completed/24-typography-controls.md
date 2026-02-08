# Ticket 24: Typography Controls (Font Size, Line Height, Font Family)

**Priority:** High
**Component:** `frontend/app.js`, `frontend/style.css`
**Estimated Scope:** Small-Medium
**Depends on:** Ticket 21 (Settings Panel)

## Overview

Add user-adjustable typography settings for the code editor and the problem description text. Currently, font size (14px), font family (Consolas), and line height are hardcoded. The cognitive ergonomics research identifies typography controls — especially increased line height and high character differentiation — as more impactful than specialized "dyslexia fonts."

## Research Context

Section 2.1 of the report details how "visual crowding" (letters blurring together) is a primary reading barrier for dyslexic users. The key interventions are:

- **Line height ≥ 1.5** (standard editors use 1.2) — provides "breathing room" for eye tracking
- **Character differentiation** — clear distinction between `1`/`l`/`I` and `0`/`O`
- **Increased letter spacing** — reduces crowding effects
- **Modern developer fonts** (JetBrains Mono, Fira Code) — designed with increased x-heights and optimized code readability

Section 2.1.2 notes that **ligatures** should be available but disabled by default — they help advanced users via "chunking" but can confuse beginners who can't map symbols (→) back to keystrokes (`->`).

## Settings

These settings are registered with the SettingsManager (Ticket 21):

| Setting | Control | Range | Default | Applies to |
|---------|---------|-------|---------|------------|
| `editorFontSize` | Slider | 12–24px, step 1 | 14 | Monaco editor |
| `editorFontFamily` | Dropdown | see below | "default" | Monaco editor |
| `editorLineHeight` | Slider | 1.2–2.0, step 0.1 | 1.5 | Monaco editor |
| `editorLigatures` | Toggle | on/off | off | Monaco editor |
| `uiFontSize` | Slider | 13–20px, step 1 | 14 | Problem description, chat, UI text |

### Font Family Options

| Value | Display Name | Notes |
|-------|-------------|-------|
| `"default"` | System Default | Uses `Consolas, 'Courier New', monospace` (current) |
| `"jetbrains-mono"` | JetBrains Mono | Load from Google Fonts CDN. High x-height, clear 1/l/I distinction |
| `"fira-code"` | Fira Code | Load from Google Fonts CDN. Excellent ligature support |
| `"comic-mono"` | Comic Mono | Monospaced Comic Sans variant — some dyslexic users prefer rounded letterforms |

### Font Loading
- Load selected Google Font via a `<link>` tag injected into `<head>` on settings change
- Only load the font when selected (don't preload all four)
- Cache: once loaded, the font persists for the session; on reload, load eagerly based on saved setting

## Implementation

### Monaco Editor Updates
When any typography setting changes, update the Monaco editor:
```javascript
editor.updateOptions({
    fontSize: settings.get('editorFontSize'),
    lineHeight: settings.get('editorLineHeight') * settings.get('editorFontSize'),
    fontFamily: getFontFamily(settings.get('editorFontFamily')),
    fontLigatures: settings.get('editorLigatures'),
});
```

### UI Text Updates
For problem description and chat text, set CSS variables:
```css
:root {
    --ui-font-size: 14px;  /* driven by uiFontSize setting */
}
.problem-description, .chat-message {
    font-size: var(--ui-font-size);
}
```

### Quick Adjust (Optional Enhancement)
- `Ctrl+Plus` / `Ctrl+Minus` to adjust editor font size without opening settings
- Show a brief toast: "Font size: 16px"
- Update the setting in SettingsManager so it persists

## Implementation Steps

1. **Add font settings to SettingsManager** defaults
2. **Build typography section** in settings panel — sliders for sizes, dropdown for family, toggle for ligatures
3. **Wire Monaco updates** — subscribe to setting changes, call `editor.updateOptions`
4. **Wire UI text updates** — CSS variable for `--ui-font-size`
5. **Implement font loading** — inject Google Fonts `<link>` on family change
6. **Add Ctrl+Plus/Minus** keyboard shortcut for quick font size adjustment
7. **Test** all combinations across themes

## Acceptance Criteria

- [ ] Font size slider adjusts editor text from 12px to 24px in real time
- [ ] Line height slider adjusts from 1.2 to 2.0 in real time
- [ ] Four font family options available; selected font loads from CDN
- [ ] Ligatures toggle works (visible when using Fira Code with operators like `!=`, `=>`)
- [ ] UI font size slider adjusts problem description and chat text
- [ ] All typography settings persist across page refresh
- [ ] `Ctrl+Plus` / `Ctrl+Minus` adjust editor font size
- [ ] Font loading does not cause layout shift or flash of unstyled text
- [ ] Characters `1`, `l`, `I` and `0`, `O` are clearly distinguishable in all font options
