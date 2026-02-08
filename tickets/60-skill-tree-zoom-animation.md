# Ticket 60: Skill Tree Zoom Reveal Animation & Reusable Animation Patterns

**Priority:** Low
**Component:** `frontend/src/skill-tree-island.jsx`, `frontend/modules/`
**Estimated Scope:** Medium
**Depends on:** Ticket 58 (visual skill tree)

## Problem

The skill tree's zoom-in reveal animation doesn't work as intended. The desired behavior:
1. Tree view opens showing the full overview (all nodes visible, zoomed out)
2. Pauses briefly (~300ms) so the user sees the full tree
3. Smoothly animates zooming in to a closer view (~3 zoom-button clicks worth)

Current behavior: a split-second flash of a zoomed-in element, then an instant pop to the full overview. The animated `fitView` calls appear to be fighting with React Flow's internal viewport initialization.

### What was tried
- Removing the `fitView` prop from `<ReactFlow>` and controlling it entirely via `useReactFlow().fitView()`
- Using `requestAnimationFrame` (double-nested) to wait for React Flow to render nodes before calling `fitView`
- Snap to wide view (`fitView({ padding: 0.4, duration: 0 })`), then delayed animated zoom (`fitView({ padding: 0.02, duration: 800 })`)
- Tracking previous node count to only trigger on initial load (0 -> N nodes)

None of these produced the desired result. The `duration` parameter on `fitView` does work (the zoom-out animation when switching to tree view is smooth), but the initial reveal sequence doesn't behave correctly.

### Likely root causes to investigate
- React Flow may do its own initial viewport setup that overrides early `fitView` calls
- The container may still be hidden or have zero dimensions when the first `fitView` fires (the tree is inside a modal that's shown via class toggle)
- The `MutationObserver` on the container's `class` attribute may fire before the container has actual layout dimensions
- React Flow's `onInit` callback might be the correct place to start the animation sequence rather than `useEffect`

## Deliverables

### 1. Fix the skill tree zoom reveal

Investigate React Flow's initialization lifecycle and find the correct hook point. Consider:
- Using React Flow's `onInit` callback (fires when the ReactFlow instance is ready)
- Using `onNodesChange` to detect when nodes are first measured
- Using a `ResizeObserver` on the container to detect when it gets real dimensions
- Testing with the Vite dev server (`npm run dev` on port 5173) for faster iteration — no rebuild/restart cycle needed

### 2. Research reusable animation patterns

Investigate and document patterns for smooth animations across the app. Areas to cover:
- **React Flow viewport animations**: What's the reliable way to sequence fitView/zoom calls? When is the viewport actually ready?
- **Show/hide transitions**: The app toggles visibility via `.hidden` class (display: none). This kills CSS transitions and makes measuring impossible. Consider alternatives (opacity + pointer-events, height: 0, off-screen positioning) that allow animations.
- **Shared animation utilities**: Should we have a small utility module (e.g. `modules/animation.js`) with helpers like `waitForLayout(element)` (returns a promise that resolves when the element has non-zero dimensions), `animateReveal(element, options)`, etc.?
- **`prefers-reduced-motion`**: All animations must respect this. Document how to check it and gate animations consistently.

### 3. Document findings

Add a section to CLAUDE.md or create a `frontend/modules/animation.js` pattern file that future work can reference. Key things to document:
- When to use CSS transitions vs JS-driven animations
- How to reliably animate elements that transition from hidden to visible
- React Flow-specific animation patterns
- How to respect `prefers-reduced-motion`

## Acceptance Criteria

- [ ] Skill tree opens with a smooth zoom-in reveal (overview -> close-up)
- [ ] The animation is reliable on every open (not just first load)
- [ ] +/- zoom buttons animate smoothly (already working)
- [ ] `prefers-reduced-motion` skips the reveal animation
- [ ] Animation patterns are documented for reuse
- [ ] No regressions in tree functionality (node clicks, popover, view toggle)
