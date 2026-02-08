# Ticket 57: Category-Grouped Problem List with Unlock State

**Priority:** Medium
**Component:** `frontend/modules/problems.js`, `frontend/style.css`
**Estimated Scope:** Small-Medium
**Depends on:** Ticket 56 (skill tree data model & progress tracking)
**Supersedes:** Ticket 31 (Phase 1 continued — enhanced list view)

## Overview

Enhance the existing problem list to group problems by skill tree category, showing lock/unlock state and per-category progress. This delivers the core motivational value of the skill tree (visible progression, clear next steps) without requiring the visual graph — and serves as the fallback view when the full tree is available (ticket 58).

## UI Changes

### Problem List Enhancements

Replace the current flat filterable list with a grouped, collapsible list:

```
Array Fundamentals                    3/3 solved  [===]
  ✓ Contains Duplicate        easy
  ✓ Valid Anagram              easy
  ✓ Two Sum                    easy

Two Pointers                          1/5 solved  [=   ]
  ✓ Valid Palindrome           easy
    Two Sum II                 medium
    3Sum                       medium
    Container With Most Water  medium
  🔒 Trapping Rain Water       hard

🔒 Sliding Window                      0/4 solved
  🔒 Longest Substring...      medium
  🔒 ...
```

### Category Header

Each category section has a clickable header showing:
- Category name
- Progress: "N/M solved" with a small inline progress bar
- Collapse/expand chevron
- Lock icon if category is locked (prerequisites not met)

### Problem Row States

| State | Visual |
|-------|--------|
| Solved | Checkmark, slightly muted text |
| Attempted (not solved) | Orange dot, normal text |
| Not attempted, unlocked | No icon, normal text |
| Locked (category locked) | Lock icon, greyed out, not clickable |

### Locked Category Behavior

- Locked categories are collapsed by default and show greyed-out styling
- Expanding a locked category shows the problem list but all items are greyed and not clickable
- Below the category header, show a line: "Solve a problem in [prerequisite names] to unlock"
- Clicking a locked problem does nothing (no session start)

### View Toggle

Add a small toggle at the top of the problem selector:
- "List" (this view, default) | "Tree" (ticket 58, disabled until implemented)
- Use a segmented control or tab-style toggle

### Preserving Existing Filters

The current difficulty and tag filters should still work:
- Difficulty filter: hide categories where no problems match the filter
- Tag filter: same behavior
- Search: filter problems within categories, hide empty categories

## Frontend Changes

### Modify `modules/problems.js`

- Fetch `/api/skill-tree` on startup (alongside `/api/problems`)
- Group problems by category when rendering the list
- Use `getCategoryStatus()` from `modules/progress.js` to determine lock state
- Listen for `problem-solved` event to re-render affected categories
- Collapse/expand state stored in component-level variable (not localStorage — it's ephemeral)

### CSS

- Category header styling: bold label, progress bar, collapse chevron
- Locked state: `opacity: 0.5`, `pointer-events: none` on locked problem rows
- Progress bar: thin inline bar using CSS custom properties for fill color
- Keep the existing problem item styling for individual rows

## Implementation Steps

1. **Fetch skill tree manifest** on startup in `problems.js`
2. **Render grouped list** — category headers with progress, collapsible sections
3. **Implement lock/unlock logic** — integrate with `progress.js` category status
4. **Add prerequisite hint text** on locked categories
5. **Add view toggle stub** — "List | Tree" with Tree disabled
6. **Update filters** to work within grouped view
7. **Listen for `problem-solved`** event to live-update progress bars and lock states

## Acceptance Criteria

- [ ] Problems are grouped by skill tree category with collapsible headers
- [ ] Each category header shows "N/M solved" count and a progress bar
- [ ] Locked categories appear greyed out with lock icon
- [ ] Locked categories show which prerequisites need to be completed
- [ ] Clicking a locked problem does not start a session
- [ ] Solving a problem live-updates the progress bar and may unlock new categories
- [ ] Difficulty and tag filters work within the grouped view
- [ ] "List | Tree" toggle is visible (Tree is disabled/placeholder)
- [ ] Existing problem selection flow (click → start session) still works for unlocked problems
