# Ticket 58: Visual Skill Tree (React Island with React Flow)

**Priority:** Medium
**Component:** `frontend/src/`, `frontend/modules/skill-tree.js`, `frontend/package.json`
**Estimated Scope:** Medium
**Depends on:** Ticket 56 (data model), Ticket 57 (grouped list as fallback view)
**Supersedes:** Ticket 31 (Phase 2 — visual tree rendering)

## Overview

Build an interactive visual skill tree using React Flow, mounted as a React island following the same pattern as the Excalidraw whiteboard. Each category is a custom node showing its name, progress bar, and lock state. Prerequisite relationships are rendered as directed edges. The tree supports pan and zoom.

## Architecture

### React Island Pattern (following Excalidraw precedent)

The skill tree follows the exact same integration pattern as `src/excalidraw-island.jsx`:

1. **React component**: `src/skill-tree-island.jsx` — renders the React Flow graph
2. **Bridge API**: `window.skillTreeBridge` — exposes methods for vanilla JS to call
3. **Vanilla wrapper**: `modules/skill-tree.js` — handles toggle, dependency injection, event bus integration

### Bridge API

```javascript
window.skillTreeBridge = {
    // Called by vanilla JS when progress changes
    updateProgress: (progressData) => { ... },

    // Called by vanilla JS when theme changes
    setTheme: (theme) => { ... },

    // Returns the currently selected problem ID (set when user clicks a problem in a node)
    getSelectedProblem: () => string | null,

    // Register callback for when user selects a problem in the tree
    setOnProblemSelect: (callback) => { ... },
};
```

### Data Flow

1. `modules/skill-tree.js` fetches `/api/skill-tree` and progress from `modules/progress.js`
2. Passes data to React via `skillTreeBridge.updateProgress()`
3. User clicks a problem node → bridge calls `onProblemSelect` callback → vanilla JS starts session
4. On `problem-solved` event, vanilla JS calls `skillTreeBridge.updateProgress()` to refresh the tree

## Dependencies

```bash
cd frontend && npm install @xyflow/react
```

React Flow (formerly React Flow) provides:
- Directed graph rendering with custom nodes and edges
- Built-in pan, zoom, and minimap
- Keyboard navigation and ARIA attributes
- Handles layout positioning when paired with a layout algorithm

For auto-layout, use a simple topological sort + layered positioning computed in JS (not a separate library). The category DAG is small (17 nodes) and static — no need for a force simulation.

## React Component Design

### `src/skill-tree-island.jsx`

**Custom Node: `CategoryNode`**

Each node renders:
- Category label (bold)
- Progress text: "3/5 solved"
- Thin progress bar (filled portion reflects solve percentage)
- Visual state based on category status:

| State | Node Style |
|-------|-----------|
| Locked | Greyed out, dashed border, lock icon, no interaction |
| Unlocked | Normal border, normal colors |
| In Progress | Normal border, partially filled progress bar |
| Completed | Accent/green border, checkmark icon, fully filled bar |

**Expanding a Node**

Clicking an unlocked node expands it to show the problem list for that category (as a panel or popover, not inline in the graph — that would disrupt layout). Problems listed with their solve status. Clicking a problem triggers `onProblemSelect`.

**Edges**

- Standard smoothstep edges from prerequisite to dependent
- Edges leading to locked nodes are dashed/faded
- Edges between completed nodes could be highlighted (accent color)

### Layout Algorithm

Compute node positions before passing to React Flow:

1. Topological sort the category DAG
2. Assign layers (depth from roots)
3. Position nodes within each layer with equal spacing
4. Orientation: top-to-bottom (roots at top, advanced topics at bottom)

This is a one-time computation (~30 lines) since the graph structure is static.

### Theme Integration

Read theme from `skillTreeBridge.setTheme()` calls. Map to React Flow's color scheme and node styling. Support dark, light, sepia, and low-distraction themes to match the existing theme system.

## HTML Changes

Add a mount point in `index.html` (inside the problem modal or as a sibling panel):

```html
<div id="skill-tree-root" class="skill-tree-container"></div>
```

### Vite Entry Point

Add `src/skill-tree-island.jsx` as an additional entry in `vite.config.js` input, alongside `src/excalidraw-island.jsx`.

Update the manifest-reading logic in `backend/server.py` to inject the skill tree script tag (same pattern as the excalidraw script injection).

## Frontend Module: `modules/skill-tree.js`

Vanilla JS wrapper (~100-120 lines):
- Waits for `window.skillTreeBridge` to become available (polling, same as whiteboard.js)
- Handles the "List | Tree" view toggle (enables the Tree button from ticket 57)
- On toggle to Tree: shows `#skill-tree-root`, hides grouped list
- On toggle to List: hides `#skill-tree-root`, shows grouped list
- Passes progress updates and theme changes through the bridge
- Listens for `problem-solved` and `theme-changed` events on the event bus

## Implementation Steps

1. **Install `@xyflow/react`** and add to package.json
2. **Create `src/skill-tree-island.jsx`** with React Flow, custom `CategoryNode`, and bridge API
3. **Implement layout algorithm** — topological sort + layered positioning
4. **Create `modules/skill-tree.js`** vanilla wrapper with bridge polling and event wiring
5. **Add `#skill-tree-root`** mount point to `index.html`
6. **Update `vite.config.js`** to include new entry point
7. **Update `server.py`** manifest injection to handle the skill tree bundle
8. **Enable the Tree toggle** in the view switcher from ticket 57
9. **Wire theme** — pass theme changes through bridge

## Acceptance Criteria

- [ ] Skill tree renders as an interactive node graph with pan and zoom
- [ ] Each category is a custom node showing label, progress bar, and lock/unlock state
- [ ] Prerequisite edges are visible as directed arrows between nodes
- [ ] Locked nodes appear greyed with dashed borders
- [ ] Completed nodes have accent border and checkmark
- [ ] Clicking an unlocked node shows its problem list
- [ ] Clicking a problem from the expanded node starts a session
- [ ] Solving a problem updates the tree in real time (progress bar, potential unlock)
- [ ] Tree respects the current theme (dark/light/sepia/low-distraction)
- [ ] "List | Tree" toggle switches between grouped list and visual tree
- [ ] Production build includes the skill tree bundle via Vite manifest
