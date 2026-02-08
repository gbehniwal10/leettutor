# Ticket 45: Fix Z-Index Collisions

## Priority: LOW

## Problem

Multiple UI elements share the same `z-index` value, causing unpredictable stacking. Specifically, the streak popover and resume dialog both use `z-index: 1100`, so whichever appears later in the DOM wins — this can cause a popover to render on top of an important dialog or vice versa.

**Audit ref:** Issue #23

## Files
- `frontend/style.css`

## Requirements

1. Audit all `z-index` values in `style.css` and `index.html` inline styles
2. Define a clear z-index scale with no collisions. Suggested layering:
   - Base content: `z-index: 1`
   - Floating panels / popovers: `z-index: 100`
   - Dropdowns / tooltips: `z-index: 200`
   - Modal backdrop: `z-index: 900`
   - Modal dialogs: `z-index: 1000`
   - Toasts / notifications: `z-index: 1100`
   - Critical overlays (e.g., resume dialog): `z-index: 1200`
3. Document the z-index scale as a CSS comment at the top of `style.css`
4. Ensure the streak popover and resume dialog no longer collide

## Scope
- `frontend/style.css`: Reassign z-index values to follow a consistent scale
