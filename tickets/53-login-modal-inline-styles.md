# Ticket 53: Login Modal Hardcoded Colors and Inline Styles

## Priority: MEDIUM

## Problem

Two related styling issues in the login modal:

1. **Hardcoded color** (`index.html:152`): The login error text uses `color: #e74c3c` instead of the CSS variable `var(--error)`. This breaks theming — the error text won't adapt when themes change.

2. **Inline styles** (`index.html:140, 148-153`): The login modal has 6 inline `style` attributes instead of using CSS classes. This makes the styling inconsistent with the rest of the app, harder to maintain, and impossible to override via themes.

**Audit ref:** Issues #14, #15

## Files
- `frontend/index.html` (login modal markup)
- `frontend/style.css` (new CSS classes)

## Requirements

1. Replace `color: #e74c3c` with `color: var(--error)` (or move to a class that uses the variable)
2. Extract all 6 inline styles from the login modal into named CSS classes in `style.css`
3. Ensure the login modal respects the active theme's CSS variables
4. Verify the login modal looks correct in all supported themes

## Scope
- `frontend/index.html`: Remove inline styles, add class names
- `frontend/style.css`: Add login modal CSS classes using theme variables
