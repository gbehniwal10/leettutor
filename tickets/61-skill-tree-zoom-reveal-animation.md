# Ticket 61: Skill Tree Zoom-In Reveal Animation

**Priority:** Low
**Component:** `frontend/src/skill-tree-island.jsx`, `frontend/style.css`
**Estimated Scope:** Small-Medium
**Depends on:** Ticket 60 (groundwork completed)

## Background

Ticket 60 investigated and fixed the root cause preventing the skill tree zoom animation from working. The key findings and fixes from that work:

### Root Cause (fixed in ticket 60)

The skill tree container used `.hidden { display: none !important }` to toggle visibility. `display: none` removes the element from the render tree entirely, giving it **zero dimensions**. This caused a cascade of failures:

1. **React Flow can't measure nodes** while `display: none` — all node dimensions are 0
2. **`fitView()` is a no-op** because it calculates viewport from 0×0 container bounds
3. **React Flow's default viewport** `{x:0, y:0, zoom:1}` shows whatever node is near the origin (the "backtracking" node), causing an off-center flash
4. **React Flow does its own internal viewport adjustment** ~100ms after becoming visible, overriding any `setViewport` or `fitView` calls made during that window
5. **Default `minZoom` of 0.5** clamped zoomed-out viewports, making zoom animations invisible (the tree naturally fits at zoom ~0.5)

### What was fixed (current state)

**CSS override** (`style.css`): The skill tree container now uses `visibility: hidden` + `height: 0` instead of `display: none` when the `.hidden` class is applied:
```css
#skill-tree-root.skill-tree-container.hidden {
    display: block !important;
    visibility: hidden;
    height: 0 !important;
    min-height: 0 !important;
    margin: 0;
    border: none;
    padding: 0;
}
```
This keeps the container in the render tree with real width, so React Flow can measure nodes at all times.

**ReactFlow props**: Added `minZoom={0.1}` to allow zoomed-out animation states below the default 0.5.

**Simplified JS**: The MutationObserver now does a simple `fitView({ padding: 0.02, duration: 0 })` in a `requestAnimationFrame` when the container becomes visible. This works reliably because the container always has real dimensions.

### Current behavior

Tree tab shows the full centered view **immediately** on click. No animation, no flash, no off-center viewport. This is the correct baseline to build the animation on.

## Deliverable: Zoom-In Reveal Animation

### Desired behavior

1. User clicks "Tree" tab
2. Tree appears showing the **full overview** (all nodes visible, zoomed out) — use `fitView({ padding: 0.4 })` or equivalent
3. Brief pause (~200-300ms) so the user registers the full tree
4. **Smooth zoom in** over ~800ms to a closer view (~3 zoom-button clicks worth) — use `fitView({ padding: 0.02, duration: 800 })` or `setViewport` with duration
5. Animation replays every time the tree tab is opened (not just first load)

### Implementation approach

Since `fitView()` now works reliably (thanks to the `visibility: hidden` CSS fix), the animation should be straightforward:

```jsx
// In the MutationObserver callback when container becomes visible:
requestAnimationFrame(() => {
  // 1. Snap to zoomed-out overview
  fitView({ padding: 0.4, duration: 0 });
  // 2. After a brief pause, animate to close-up
  setTimeout(() => {
    fitView({ padding: 0.02, duration: 800 });
  }, 300);
});
```

If `fitView` with `duration` still doesn't animate smoothly, use `setViewport` directly:
```jsx
requestAnimationFrame(() => {
  fitView({ padding: 0.4, duration: 0 });
  const overviewViewport = getViewport(); // capture the zoomed-out state
  setTimeout(() => {
    // Calculate target viewport (tighter fit)
    fitView({ padding: 0.02, duration: 0 });
    const targetViewport = getViewport();
    // Reset to overview and animate
    setViewport(overviewViewport);
    requestAnimationFrame(() => {
      setViewport(targetViewport, { duration: 800 });
    });
  }, 300);
});
```

### Accessibility: `prefers-reduced-motion`

Skip the animation entirely when the user prefers reduced motion:
```jsx
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (prefersReducedMotion) {
  fitView({ padding: 0.02, duration: 0 });
  return;
}
```

Check this once at component init via a `useRef` (no need for a reactive listener — the page would need a refresh anyway for layout changes).

### Things to verify

- [ ] `fitView({ duration: 800 })` actually produces a smooth animation (it uses d3-zoom internally). If it doesn't, fall back to `setViewport` with `duration`.
- [ ] The zoomed-out state (padding 0.4) and zoomed-in state (padding 0.02) are visually different enough to see the animation. If not, try padding 0.6 or use explicit zoom values.
- [ ] Animation doesn't fire when switching from Tree back to List and back to Tree in rapid succession (debounce or cancel previous animation).
- [ ] Theme changes while on the Tree tab don't trigger the animation (the MutationObserver watches `class` attribute changes, but other code also modifies classes on the root).
- [ ] Zoom +/- buttons and fit button still work normally after animation completes.
- [ ] Node clicks and popover still work.

## Key Technical Context

### Why `fitView` failed before (and why it works now)

`fitView` internally calculates a bounding box of all nodes using their `measured` dimensions, then computes a viewport transform to fit that box in the container. With `display: none`:
- Container width/height = 0 → viewport calculation produces `{x:0, y:0, zoom:1}`
- Node `measured` = undefined → bounding box is wrong
- React Flow's internal ResizeObserver fires after `display:none` → visible, triggering its own viewport update that overrides any programmatic `setViewport` calls

With `visibility: hidden` + `height: 0`:
- Container has real width (inherits from parent) → viewport calculation works
- Nodes are rendered and measured → bounding box is correct
- On reveal, only height changes (0 → 70vh), which ResizeObserver detects, but `fitView` in rAF fires at the right time

### React Flow v12.10.0 specifics

- `@xyflow/react` version: `^12.10.0` (see `frontend/package.json`)
- `fitView` uses d3-zoom for animated transitions
- `setViewport(viewport, { duration })` also uses d3-zoom
- Default `minZoom` is 0.5 — we set it to 0.1 to allow zoomed-out states
- `useReactFlow()` provides `fitView`, `setViewport`, `getViewport`, `zoomIn`, `zoomOut`
- `onNodesChange` fires with `type: 'dimensions'` when nodes are measured

### File locations

- **React component**: `frontend/src/skill-tree-island.jsx` — `SkillTreeIsland` component, MutationObserver at ~line 457
- **CSS override**: `frontend/style.css` — `#skill-tree-root.skill-tree-container.hidden` rule after line 1615
- **View toggle**: `frontend/modules/skill-tree.js` — `_showTreeView()` at line 52 removes `.hidden` class, then calls `_pushProgress()` and `_pushCategories()` which trigger React state updates via the bridge
- **Build**: `npm run dev` (Vite on port 5173) for hot-reload, or `npx vite build` + restart Python server for production

### Deep research findings (from external report)

Key takeaways relevant to the animation:

1. **CSS transitions on React Flow containers are prohibited** — `transform: scale()` on the container breaks coordinate math (mouse events misalign). The zoom effect must be internal to the graph via `fitView`/`setViewport`.
2. **CSS `opacity` transition is safe** for fade-in effects and can be combined with the JS zoom animation.
3. **ResizeObserver fires after layout but before paint** — this is the earliest safe moment to read dimensions. React Flow uses this internally.
4. **`prefers-reduced-motion`** should gate JS animation duration (set to 0) — simple opacity fades are generally safe for vestibular disorders.
5. **For large graphs (1000+ nodes)**, `fitView` is O(n) and could drop frames. Pre-calculate bounds if needed. Our tree has only 17 nodes so this isn't a concern.

## Acceptance Criteria

- [ ] Skill tree opens with a smooth zoom-in reveal (overview → close-up, ~800ms)
- [ ] Animation replays on every tab open (not just first load)
- [ ] `prefers-reduced-motion` skips animation, shows final view instantly
- [ ] No flash of wrong viewport before animation starts
- [ ] Zoom +/- buttons and fit button still work
- [ ] Node clicks and popover still work
- [ ] No animation on theme change or other non-tab-switch events
