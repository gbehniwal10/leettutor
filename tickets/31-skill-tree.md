# Ticket 31: Skill Tree / Problem Dependency Graph

**Priority:** Medium
**Component:** `frontend/app.js`, `frontend/style.css`, `backend/problems/` (new metadata)
**Estimated Scope:** Large
**Depends on:** None (standalone feature)

## Overview

Replace the flat problem list with an interactive visual Skill Tree that shows dependencies between problems and algorithmic concepts. Currently, problems are presented as a filterable list — users have no visual sense of progression or how concepts build on each other. The research identifies this as a critical gap for ADHD learners who struggle with "time blindness" and long-term planning.

## Research Context

Section 3.2.1 of the cognitive ergonomics report describes how linear problem lists are "demotivating because the end is invisible and the progression feels arbitrary." A Skill Tree or Dependency Graph, similar to a video game tech tree, "visualizes the Long-Term Goal in a spatial way." ADHD learners who struggle with future planning can see where they are relative to the whole subject and why the current problem matters. Completing a node visually "unlocks" the path to the next topic, creating immediate short-term goals that feed into long-term goals.

## Data Model

### Problem Dependency Metadata
Add a `prerequisites` field to problem JSON files (or a separate `skill-tree.json` manifest):

**Option A: Separate manifest (recommended — avoids modifying 138 problem files)**
```json
// backend/problems/skill-tree.json
{
    "categories": [
        {
            "id": "arrays-basics",
            "label": "Array Fundamentals",
            "problems": ["contains-duplicate", "valid-anagram", "two-sum"],
            "prerequisites": []
        },
        {
            "id": "two-pointers",
            "label": "Two Pointers",
            "problems": ["valid-palindrome", "two-sum-ii-input-array-is-sorted", "3sum", "container-with-most-water", "trapping-rain-water"],
            "prerequisites": ["arrays-basics"]
        },
        {
            "id": "sliding-window",
            "label": "Sliding Window",
            "problems": ["longest-substring-without-repeating-characters", "longest-repeating-character-replacement", "permutation-in-string", "minimum-window-substring", "sliding-window-maximum"],
            "prerequisites": ["arrays-basics"]
        },
        {
            "id": "binary-search",
            "label": "Binary Search",
            "problems": ["binary-search", "search-a-2d-matrix", "koko-eating-bananas", "find-minimum-in-rotated-sorted-array", "search-in-rotated-sorted-array", "median-of-two-sorted-arrays"],
            "prerequisites": ["arrays-basics"]
        },
        {
            "id": "stacks",
            "label": "Stacks",
            "problems": ["valid-parentheses", "evaluate-reverse-polish-notation", "generate-parentheses", "daily-temperatures", "car-fleet", "largest-rectangle-in-histogram"],
            "prerequisites": ["arrays-basics"]
        },
        {
            "id": "linked-lists",
            "label": "Linked Lists",
            "problems": ["reverse-linked-list", "merge-two-sorted-lists", "linked-list-cycle", "reorder-list", "remove-nth-node-from-end-of-list", "add-two-numbers", "merge-k-sorted-lists", "reverse-nodes-in-k-group"],
            "prerequisites": []
        },
        {
            "id": "trees-basics",
            "label": "Tree Basics",
            "problems": ["invert-binary-tree", "maximum-depth-of-binary-tree", "diameter-of-binary-tree", "balanced-binary-tree", "same-tree", "subtree-of-another-tree"],
            "prerequisites": ["linked-lists"]
        },
        {
            "id": "trees-advanced",
            "label": "Advanced Trees",
            "problems": ["binary-tree-level-order-traversal", "binary-tree-right-side-view", "count-good-nodes-in-binary-tree", "validate-binary-search-tree", "kth-smallest-element-in-a-bst", "construct-binary-tree-from-preorder-and-inorder-traversal", "binary-tree-maximum-path-sum"],
            "prerequisites": ["trees-basics"]
        },
        {
            "id": "heaps",
            "label": "Heaps / Priority Queue",
            "problems": ["last-stone-weight", "k-closest-points-to-origin", "kth-largest-element-in-an-array", "task-scheduler"],
            "prerequisites": ["arrays-basics"]
        },
        {
            "id": "graphs-basics",
            "label": "Graph Basics",
            "problems": ["number-of-islands", "max-area-of-island", "pacific-atlantic-water-flow", "surrounded-regions", "rotting-oranges", "walls-and-gates", "course-schedule", "course-schedule-ii"],
            "prerequisites": ["trees-basics"]
        },
        {
            "id": "graphs-advanced",
            "label": "Advanced Graphs",
            "problems": ["redundant-connection", "number-of-connected-components-in-an-undirected-graph", "graph-valid-tree", "word-ladder", "reconstruct-itinerary", "min-cost-to-connect-all-points", "network-delay-time", "cheapest-flights-within-k-stops", "swim-in-rising-water", "alien-dictionary"],
            "prerequisites": ["graphs-basics"]
        },
        {
            "id": "dp-1d",
            "label": "1D Dynamic Programming",
            "problems": ["climbing-stairs", "min-cost-climbing-stairs", "house-robber", "house-robber-ii", "longest-palindromic-substring", "palindromic-substrings", "decode-ways", "coin-change", "maximum-product-subarray", "word-break", "longest-increasing-subsequence", "partition-equal-subset-sum"],
            "prerequisites": ["arrays-basics"]
        },
        {
            "id": "dp-2d",
            "label": "2D Dynamic Programming",
            "problems": ["unique-paths", "longest-common-subsequence", "best-time-to-buy-and-sell-stock-with-cooldown", "coin-change-ii", "target-sum", "interleaving-string", "longest-increasing-path-in-a-matrix", "distinct-subsequences", "edit-distance", "burst-balloons", "regular-expression-matching"],
            "prerequisites": ["dp-1d"]
        },
        {
            "id": "backtracking",
            "label": "Backtracking",
            "problems": ["subsets", "combination-sum", "permutations", "subsets-ii", "combination-sum-ii", "word-search", "palindrome-partitioning", "letter-combinations-of-a-phone-number", "n-queens"],
            "prerequisites": ["arrays-basics"]
        },
        {
            "id": "greedy",
            "label": "Greedy",
            "problems": ["maximum-subarray", "jump-game", "jump-game-ii", "gas-station", "hand-of-straights", "merge-triplets-to-form-target-triplet", "partition-labels", "valid-parenthesis-string"],
            "prerequisites": ["arrays-basics"]
        },
        {
            "id": "intervals",
            "label": "Intervals",
            "problems": ["insert-interval", "merge-intervals", "non-overlapping-intervals", "meeting-rooms", "meeting-rooms-ii", "minimum-interval-to-include-each-query"],
            "prerequisites": ["arrays-basics"]
        },
        {
            "id": "bit-manipulation",
            "label": "Bit Manipulation",
            "problems": ["single-number", "number-of-1-bits", "counting-bits", "reverse-bits", "missing-number", "sum-of-two-integers"],
            "prerequisites": []
        }
    ]
}
```

### Progress Tracking
Track per-problem completion status in localStorage:
```javascript
{
    "problemProgress": {
        "two-sum": { "solved": true, "bestResult": "accepted", "attempts": 3 },
        "3sum": { "solved": false, "bestResult": "3/5 passed", "attempts": 1 }
    }
}
```

A category is "unlocked" when all its prerequisites have at least one solved problem each. A category is "completed" when all its problems are solved.

## UI Design

### Skill Tree View
- Accessible via a toggle in the problem selector area (switch between "List View" and "Tree View")
- Each category is a **node** — a rounded rectangle showing:
  - Category name
  - Progress: "3/5 solved" with a small progress bar
  - Difficulty spread (e.g., colored dots: 🟢🟡🔴)
- Nodes are connected by **edges** (arrows) showing prerequisites
- Layout: top-to-bottom or left-to-right directed graph

### Node States
| State | Visual |
|-------|--------|
| Locked | Greyed out, dashed border, lock icon |
| Unlocked | Normal colors, solid border |
| In Progress | Normal colors, partial progress bar filled |
| Completed | Green border or checkmark badge, fully filled bar |

### Interaction
- Click a node to expand it into the problem list for that category
- Problems within a category shown as a vertical list with solve status
- Click a problem to start/resume it
- Hover a node to highlight its prerequisite chain

### Responsive Layout
- The graph should be pannable and zoomable (CSS transform-based)
- On small screens, fall back to an indented list view that shows the same dependency information

## Implementation Approach

### Canvas vs DOM
Use **DOM-based rendering** (not Canvas):
- Each node is an absolutely positioned `<div>`
- Edges are drawn with SVG `<line>` or `<path>` elements in an overlay
- This keeps the UI accessible (nodes are focusable, screen-reader friendly)
- Layout positions can be hardcoded or computed with a simple topological sort + layered layout

### No External Libraries
Keep it dependency-free to match the project's vanilla JS approach:
- Simple DAG layout algorithm (assign layers via topological sort, position nodes within layers)
- SVG lines for edges
- CSS transitions for state changes

## Implementation Steps

1. **Create `skill-tree.json`** manifest with categories, problems, and prerequisites
2. **Add progress tracking** to localStorage (update on problem completion via `/api/submit`)
3. **Build node component** — category card with name, progress bar, status
4. **Build edge rendering** — SVG lines connecting prerequisite nodes
5. **Implement DAG layout** — topological sort + layered positioning
6. **Add interaction** — click to expand, hover to highlight chain
7. **Add list/tree view toggle** — switch between current list and new tree
8. **Wire completion tracking** — update progress on successful submit

## Acceptance Criteria

- [ ] Skill Tree view shows all problem categories as connected nodes
- [ ] Prerequisite edges are clearly visible (arrows)
- [ ] Node state (locked/unlocked/in-progress/completed) is visually distinct
- [ ] Clicking a node shows the problems in that category
- [ ] Progress bar on each node reflects actual solve status
- [ ] Categories with unmet prerequisites appear locked
- [ ] Tree is pannable/zoomable for navigation
- [ ] Completing a problem updates the tree in real time
- [ ] List view (current) remains available as an alternative
- [ ] Tree layout works on screens 1024px+ wide
