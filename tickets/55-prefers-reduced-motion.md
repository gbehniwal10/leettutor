# Ticket 55: Animations Ignore prefers-reduced-motion

## Priority: LOW

## Problem

Several CSS animations — `.mf-shake`, `.confetti-particle`, and `.tts-btn.playing` — always run regardless of the user's OS-level `prefers-reduced-motion` setting. Users who have enabled reduced motion (common for vestibular disorders, motion sensitivity, or epilepsy) still see shake effects, confetti, and pulsing buttons.

**Audit ref:** Issue #24

## Files
- `frontend/style.css` (animation definitions)

## Requirements

1. Add a `@media (prefers-reduced-motion: reduce)` block that disables or simplifies all animations:
   ```css
   @media (prefers-reduced-motion: reduce) {
       .mf-shake { animation: none; }
       .confetti-particle { animation: none; display: none; }
       .tts-btn.playing { animation: none; }
       /* any other animated elements */
   }
   ```
2. For animations that convey information (e.g., a shake indicating an error), replace with a non-motion alternative (e.g., a color flash or border change)
3. Audit `style.css` for any other `animation` or `transition` properties that should be included
4. Ensure the reduced-motion setting in the app's own settings panel (if present from Ticket 25) also applies these overrides

## Scope
- `frontend/style.css`: Add `prefers-reduced-motion` media query covering all animated elements
