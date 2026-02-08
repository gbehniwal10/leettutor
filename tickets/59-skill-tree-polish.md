# Ticket 59: Skill Tree Interaction Polish

**Priority:** Low
**Component:** `frontend/src/skill-tree-island.jsx`, `frontend/modules/skill-tree.js`, `frontend/style.css`
**Estimated Scope:** Small-Medium
**Depends on:** Ticket 58 (visual skill tree React island)
**Supersedes:** Ticket 31 (Phase 3 — polish)

## Overview

Add interaction polish to the visual skill tree: hover to highlight prerequisite chains, completion animations, minimap for orientation, keyboard navigation, and a responsive fallback for smaller screens.

## Features

### 1. Prerequisite Chain Highlighting

When hovering over a category node:
- Highlight all ancestor nodes (direct and transitive prerequisites) and the edges connecting them
- Dim all other nodes and edges to ~30% opacity
- This helps users see "what do I need to learn to get here?"

When hovering over an edge:
- Highlight both connected nodes

Clear highlighting on mouse leave.

### 2. Completion Animations

When a problem is solved and it causes a category status change:

**Category completed (all problems solved):**
- Brief pulse animation on the node (scale up 1.05x, accent glow, settle back)
- Checkmark icon fades in
- Progress bar fills to 100% with a smooth transition

**Category unlocked (prerequisite just completed):**
- Node transitions from greyed/dashed to solid/colored over 300ms
- Lock icon fades out
- Edges leading to the newly unlocked node become solid (from dashed)

All animations respect `prefers-reduced-motion` — if reduced motion is preferred, apply state changes instantly without transitions.

### 3. Minimap

Enable React Flow's built-in `<MiniMap />` component:
- Positioned in the bottom-right corner
- Color-coded: locked nodes grey, unlocked blue, completed green
- Helps orientation when the tree is zoomed in

### 4. Keyboard Navigation

React Flow provides basic keyboard support. Ensure:
- Tab navigates between nodes
- Enter/Space expands a node (shows problem list)
- Arrow keys pan the viewport
- `+`/`-` or scroll zoom
- Escape closes an expanded node's problem list

Add `aria-label` to each node: e.g. "Two Pointers, 1 of 5 solved, unlocked"

### 5. Responsive Fallback

On screens narrower than 1024px:
- Hide the visual tree entirely
- Default to the grouped list view (ticket 57)
- The "List | Tree" toggle is hidden (only list is available)
- Detect via `matchMedia('(min-width: 1024px)')` and listen for changes

On screens 1024px–1280px:
- Show the tree but disable the minimap (saves space)
- Reduce node padding slightly

## Implementation Steps

1. **Prerequisite highlighting** — on node hover, walk the DAG upward to find ancestors, set highlighted state on nodes/edges
2. **Completion animations** — listen for status transitions from `progress.js`, trigger CSS transitions/keyframes on affected nodes
3. **Reduced motion** — gate all animations behind `prefers-reduced-motion` media query
4. **Enable minimap** — add `<MiniMap />` from React Flow with status-based color function
5. **Keyboard navigation** — verify React Flow defaults work, add aria-labels to custom nodes
6. **Responsive breakpoint** — media query listener that forces list view on small screens

## Acceptance Criteria

- [ ] Hovering a node highlights its full prerequisite chain and dims unrelated nodes
- [ ] Completing a category plays a brief pulse/glow animation on the node
- [ ] Unlocking a category smoothly transitions it from locked to unlocked styling
- [ ] Animations are disabled when `prefers-reduced-motion` is set
- [ ] Minimap is visible in the bottom-right showing a color-coded overview
- [ ] Nodes are keyboard-navigable with Tab and expandable with Enter
- [ ] Each node has a descriptive `aria-label`
- [ ] Screens under 1024px show only the list view (tree toggle hidden)
- [ ] Screens 1024–1280px show the tree without minimap
