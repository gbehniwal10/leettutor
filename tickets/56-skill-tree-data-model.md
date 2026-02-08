# Ticket 56: Skill Tree Data Model & Progress Tracking

**Priority:** Medium
**Component:** `backend/problems/`, `frontend/modules/`, `backend/server.py`
**Estimated Scope:** Small-Medium
**Depends on:** None (standalone, foundation for tickets 57-59)
**Supersedes:** Ticket 31 (Phase 1 of skill tree decomposition)

## Overview

Create the data model that powers the skill tree: a category manifest defining problem groupings and prerequisite relationships, a backend endpoint to serve it, and client-side progress tracking that persists to localStorage and updates on successful submissions.

This ticket delivers no new UI — it provides the data layer that tickets 57 (list view) and 58 (visual tree) build on.

## Data Model

### Category Manifest

Create `backend/problems/skill-tree.json` with the following schema:

```json
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
        }
    ]
}
```

Each category has:
- `id`: unique slug
- `label`: display name
- `problems`: ordered list of problem IDs (easy → hard within category)
- `prerequisites`: list of category IDs that must have at least one solved problem before this category unlocks

Use a separate manifest file rather than adding `prerequisites` fields to all 138 problem JSON files. The dependency info is a cross-cutting concern, not intrinsic to individual problems.

### Full Category List

Use the category structure from ticket 31: arrays-basics, two-pointers, sliding-window, binary-search, stacks, linked-lists, trees-basics, trees-advanced, heaps, graphs-basics, graphs-advanced, dp-1d, dp-2d, backtracking, greedy, intervals, bit-manipulation.

Only reference problem IDs that actually exist in `backend/problems/`. Validate this at load time.

### Progress Tracking (localStorage)

```javascript
// Key: "leettutor_progress"
{
    "problems": {
        "two-sum": { "solved": true, "attempts": 3, "lastAttempt": "2026-02-07" },
        "3sum": { "solved": false, "attempts": 1, "lastAttempt": "2026-02-06" }
    }
}
```

A category is **unlocked** when every category in its `prerequisites` list has at least one solved problem. A category is **completed** when all its problems are solved.

### Progress Update Trigger

Update progress in localStorage when `/api/submit` returns all tests passing. The frontend already handles submit responses in `modules/code-runner.js` — hook into the success path there.

## Backend Changes

### New Endpoint

```
GET /api/skill-tree
```

Returns the parsed `skill-tree.json` manifest. Auth-protected (use `require_auth` dependency). Load the file once at startup alongside the problem files — do not re-read on every request.

Validate at load time that all `problems` entries reference existing problem IDs and all `prerequisites` reference existing category IDs. Log warnings for missing references rather than crashing.

## Frontend Changes

### New Module: `modules/progress.js`

Responsibilities:
- Read/write progress to localStorage
- `markSolved(problemId)` — called on successful submit
- `getProgress()` — returns full progress object
- `getCategoryStatus(category, progress)` — returns `locked | unlocked | in-progress | completed`
- `isCategoryUnlocked(category, progress, categories)` — checks all prerequisites

Keep this module pure data logic — no DOM manipulation. ~80-100 lines.

### Wire into code-runner.js

After a successful submit (all tests pass), call `markSolved(problemId)` and emit a `problem-solved` event on the event bus so other modules (tickets 57-58) can react.

## Implementation Steps

1. **Create `backend/problems/skill-tree.json`** with all 17 categories and their problem lists
2. **Add `GET /api/skill-tree` endpoint** in `server.py` with startup validation
3. **Create `modules/progress.js`** with localStorage read/write and category status logic
4. **Wire submit success** in `code-runner.js` to update progress and emit event
5. **Add tests** for the new endpoint in `test_rest_api.py`

## Acceptance Criteria

- [ ] `skill-tree.json` exists with all 17 categories, correct problem IDs, and prerequisite edges
- [ ] `GET /api/skill-tree` returns the manifest (auth-protected)
- [ ] Startup validation logs warnings for any problem IDs in the manifest that don't exist in `backend/problems/`
- [ ] Successful submit updates localStorage progress
- [ ] `problem-solved` event fires on the event bus after progress update
- [ ] `getCategoryStatus()` correctly computes locked/unlocked/in-progress/completed
- [ ] Progress persists across page refreshes
- [ ] New endpoint has test coverage
