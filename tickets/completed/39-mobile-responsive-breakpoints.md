# Ticket 39: Mobile / Responsive Breakpoints

## Priority: MEDIUM

## Problem

The app has no `@media` queries for responsive layout. Several modals use `min-width: 400-500px`, making them unusable on small screens. The three-panel layout (problem / editor / chat) has no breakpoints and overflows on tablets or phones.

**Audit ref:** Issue #16

## Files
- `frontend/style.css` (primary)
- `frontend/index.html` (viewport meta, if missing)

## Requirements

1. Add a `<meta name="viewport" content="width=device-width, initial-scale=1">` tag if not already present
2. Add responsive breakpoints for at least two widths (e.g., `768px` tablet, `480px` phone)
3. At tablet width:
   - Stack the three-panel layout vertically or use a tab switcher
   - Reduce modal `min-width` to fit the screen (e.g., `min-width: min(400px, 90vw)`)
4. At phone width:
   - Single-panel view with navigation between problem / editor / chat
   - Full-width modals with no horizontal overflow
5. Ensure the Monaco Editor resizes correctly when layout changes
6. Test that settings, login, and session modals are usable at 320px width

## Scope
- `frontend/style.css`: Add `@media` breakpoints, adjust modal sizing
- `frontend/app.js`: May need a panel switcher for small screens
- `frontend/index.html`: Viewport meta tag
