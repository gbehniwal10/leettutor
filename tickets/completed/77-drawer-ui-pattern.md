# Ticket 77: Convert Problem Selection Modal to Drawer

**Priority:** Low
**Component:** `frontend/app.js`, `frontend/style.css`, `frontend/index.html`
**Estimated Scope:** Medium
**Depends on:** None
**Port of:** focus-engine drawer UI pattern (`components.css` `.drawer` class)

## Overview

Replace the centered problem-selection modal with a slide-out drawer from the right edge. This matches the pattern already used by session history and settings, provides a more consistent UX, and avoids the modal's layout shift when content height changes.

## Current State

The problem selection UI uses a centered modal (`class="modal"`) with a backdrop. It competes for visual attention and obscures the workspace.

## Drawer Pattern

The drawer pattern (already used by history/settings) provides:
- Fixed position, slides from right edge
- Backdrop dims the rest of the UI
- Escape key and backdrop click to close
- Smooth CSS transition (`translateX(100%)` → `translateX(0)`)

### CSS (already exists for history/settings — reuse)

```css
.drawer {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: min(480px, 90vw);
    transform: translateX(100%);
    transition: transform var(--transition-normal) ease;
}
.drawer.open { transform: translateX(0); }
.drawer-backdrop { /* ... */ }
.drawer-backdrop.open { opacity: 1; pointer-events: auto; }
```

### HTML Changes

Replace the modal markup with drawer markup:
```html
<div id="problem-backdrop" class="drawer-backdrop"></div>
<div id="problem-modal" class="drawer" role="dialog" aria-modal="true">
    <!-- header, body, footer -->
</div>
```

### JS Changes

Update open/close to toggle `open` class instead of `hidden`/`visible`. Add backdrop click handler.

## Acceptance Criteria

- [ ] Problem selection uses drawer pattern (slides from right)
- [ ] Backdrop dims workspace and closes drawer on click
- [ ] Escape key closes drawer
- [ ] Smooth slide animation
- [ ] Reuses existing `.drawer` CSS class (no duplication)
- [ ] Mobile: drawer is `min(480px, 90vw)` wide
