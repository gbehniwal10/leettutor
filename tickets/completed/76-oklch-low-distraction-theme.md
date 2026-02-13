# Ticket 76: OKLCH Color System for Low-Distraction Theme

**Priority:** Low–Medium
**Component:** `frontend/style.css` (theme section)
**Estimated Scope:** Medium (CSS-only, but many color values)
**Depends on:** Ticket 73 (design tokens)
**Port of:** focus-engine `frontend/styles/themes/low-distraction.css`

## Overview

Migrate the low-distraction theme from RGB hex colors to OKLCH color space. OKLCH provides perceptually uniform lightness — changing hue doesn't cause unexpected brightness jumps, reducing visual fatigue. Colors are chosen to be CVD-safe (color vision deficiency).

## Why OKLCH

- RGB hex: `#4ec9b0` (green) and `#569cd6` (blue) have different perceived brightness despite similar intent
- OKLCH: `oklch(0.68 0.07 190)` (teal) and `oklch(0.68 0.07 250)` (blue) share identical perceived brightness
- Hue changes are purely chromatic — no brightness jumps to distract

## Browser Support Impact

OKLCH requires: Chrome 111+, Firefox 113+, Safari 15.4+. This is a modest increase from the current floor. Verify this is acceptable before implementing.

## Color Palette

All semantic accent colors share `L=0.68, C=0.07` (same brightness):

| Role | OKLCH | Hue | Notes |
|------|-------|-----|-------|
| Primary (blue) | `oklch(0.68 0.07 250)` | 250 | Links, focus rings |
| Success (teal) | `oklch(0.68 0.07 190)` | 190 | Not green — avoids CVD confusion |
| Warning (gold) | `oklch(0.68 0.07 90)` | 90 | Hints, caution |
| Error (amber) | `oklch(0.68 0.07 55)` | 55 | Not red — avoids CVD confusion |

Difficulty badges: `L=0.72, C=0.08` (slightly brighter for text on dark backgrounds)

## Additional Low-Distraction Overrides

- Spacing: `--space-xs: 6px`, `--space-sm: 10px`, `--space-md: 16px` (more breathing room)
- Radius: `--radius-sm: 4px`, `--radius-md: 6px` (softer edges)
- Overlays: lighter backdrops (`rgba(0,0,0,0.15)` for drawers vs `0.3` in dark theme)
- Peripheral dimming: inactive panels dim to `opacity: 0.5` when editor focused, brighten on hover

## Acceptance Criteria

- [ ] Low-distraction theme uses OKLCH for all accent/semantic colors
- [ ] All semantic colors share same perceptual lightness
- [ ] CVD-safe hue choices (no red-green axis)
- [ ] Spacing overrides for reduced density
- [ ] Peripheral dimming with hover/focus restore
- [ ] Browser support floor documented in CLAUDE.md
- [ ] Dark theme unchanged (OKLCH is low-distraction only)
