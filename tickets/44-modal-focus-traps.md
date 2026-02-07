# Ticket 44: Add Focus Traps to Modals

## Priority: LOW

## Problem

When a modal dialog is open (settings, login, session history, etc.), pressing Tab allows focus to escape behind the modal into the main page content. This is a WCAG 2.1 failure (Success Criterion 2.4.3 — Focus Order) and makes the app difficult to use with keyboard navigation.

**Audit ref:** Issue #22

## Files
- `frontend/app.js` (modal open/close logic)
- `frontend/index.html` (modal structure)

## Requirements

1. When any modal opens:
   - Trap Tab / Shift+Tab focus within the modal's focusable elements
   - Move initial focus to the first focusable element (or the close button)
   - Add `aria-modal="true"` and `role="dialog"` to modal containers
2. When the modal closes:
   - Return focus to the element that triggered the modal
3. Pressing Escape should close the modal (if not already implemented)
4. Apply to all modals: login, settings, session history, confirmation dialogs
5. Use a lightweight approach — a reusable `trapFocus(modalElement)` / `releaseFocus()` utility function, no library needed

## Scope
- `frontend/app.js`: Add focus trap utility, wire into modal open/close handlers
- `frontend/index.html`: Add `role="dialog"` and `aria-modal="true"` to modal containers
