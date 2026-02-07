# Ticket 43: Add aria-labels to Icon-Only Buttons

## Priority: LOW

## Problem

There are 10+ buttons in `index.html` that use only icons (no visible text). Screen readers announce these as unlabeled buttons, making the app inaccessible to visually impaired users.

Known icon-only buttons include: settings gear, TTS toggle, panel expand/collapse, theme toggle, close buttons on modals, copy-code buttons, and navigation arrows.

**Audit ref:** Issue #21

## Files
- `frontend/index.html` (static buttons)
- `frontend/app.js` (dynamically created buttons)

## Requirements

1. Audit all `<button>` elements in `index.html` and dynamically created buttons in `app.js`
2. Add `aria-label="descriptive text"` to every button that has no visible text content
3. Use clear, action-oriented labels (e.g., `aria-label="Open settings"`, `aria-label="Read problem aloud"`, `aria-label="Collapse chat panel"`)
4. For toggle buttons, use `aria-pressed` attribute and update the label to reflect state (e.g., "Mute" / "Unmute")
5. Ensure `title` attributes match `aria-label` for sighted keyboard users who rely on tooltips

## Scope
- `frontend/index.html`: Add aria-labels to static buttons
- `frontend/app.js`: Add aria-labels to dynamically created buttons, update labels on state change
