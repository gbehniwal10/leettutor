# Ticket 73: ADHD Accessibility Design Tokens

**Priority:** Medium
**Component:** `frontend/style.css` (or CSS token files if split)
**Estimated Scope:** Small–Medium
**Depends on:** None
**Port of:** focus-engine `tokens.css` + `components.css` accessibility tokens

## Overview

Add research-backed accessibility design tokens for touch targets, reading comfort, and animation constraints. These tokens provide a foundation for accessible UI without changing visual design — components opt in by referencing the tokens.

## Tokens to Add

```css
:root {
    /* Touch targets (WCAG 2.5.8 — 44px minimum) */
    --touch-target-min: 44px;

    /* Reading comfort (ADHD research: reduced density aids focus) */
    --reading-line-height: 1.7;
    --reading-max-width: 65ch;
    --reading-paragraph-gap: 1em;

    /* Interactive spacing */
    --interactive-gap: 8px;

    /* Animation safety */
    --animation-max-iterations: 3;

    /* Toast timing */
    --toast-duration: 4s;

    /* Shadows (if not already defined) */
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.2);
    --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.3);
    --shadow-toast: 0 4px 12px rgba(0, 0, 0, 0.3);
}
```

## Component Updates

### Touch targets
Apply `min-height: var(--touch-target-min)` to:
- `.btn` (all buttons)
- Toggle sliders (increase knob size: 12px → 16px, track: 32×18 → 40×22)
- Icon buttons (close, settings, etc.) — add `min-width` + `min-height`

### Reading layout
Apply to chat messages and problem descriptions:
```css
.chat-bubble {
    max-width: min(var(--reading-max-width), 90%);
    line-height: var(--reading-line-height);
}
.problem-description {
    max-width: min(var(--reading-max-width), 100%);
    line-height: var(--reading-line-height);
}
```

### Animation caps
For any infinite animation (typing dots, loading spinners), add a low-distraction override:
```css
[data-theme="low-distraction"] .typing-dot {
    animation-iteration-count: var(--animation-max-iterations);
}
```

## Acceptance Criteria

- [ ] All tokens defined in CSS custom properties
- [ ] Buttons meet 44px minimum touch target
- [ ] Toggle sliders enlarged
- [ ] Chat messages and problem description use reading tokens
- [ ] No hardcoded values — everything references tokens
- [ ] Visual diff is minimal (tokens mostly enforce minimums)
