# Ticket 20: Pattern Quiz Mode

**Priority:** Feature
**Component:** `frontend/app.js`, `frontend/index.html`, `backend/server.py`
**Estimated Scope:** Medium-Large

## Overview

Add a new "Pattern Quiz" mode for rapid pattern recognition practice. Users see a problem and identify the algorithmic pattern needed to solve it (Two Pointers, DP, etc.) without writing code. This builds familiarity with problem types at higher volume than full solve sessions.

## Two Sub-Modes

### Basic Mode (no Claude)
- Show problem description
- User selects a pattern from buttons
- Immediate correct/wrong feedback
- If correct: show "Correct! This is a [Pattern] problem" with brief static explanation
- If wrong: show "Not quite. This is a [Pattern] problem" — no further explanation
- Move to next problem

### Enhanced Mode (with Claude)
- Same flow, but on feedback:
- If correct: Claude explains *why* the pattern applies to this specific problem
- If wrong: Claude explains *why* the guessed pattern doesn't fit, then explains the correct pattern
- Single one-shot prompts, not conversational

User toggles between Basic/Enhanced via a switch in the UI.

## UI Changes

### Header
- Mode selector becomes: Learning | Interview | **Pattern Quiz**
- When Pattern Quiz selected, show sub-toggle: Basic | Enhanced

### Main Panel (Pattern Quiz mode)
- Hide the Monaco code editor entirely
- Hide Run/Submit buttons
- Expand problem description to fill the left panel
- Below description: grid of pattern buttons (3-4 columns)
- Below buttons: feedback area (result + explanation)
- "Next Problem" button appears after answering

### Right Panel (Pattern Quiz mode)
- Basic mode: hide chat panel entirely, or show stats
- Enhanced mode: show Claude's explanation in a simplified chat-like display (read-only, no input box)

### Pattern Buttons
Display these categories:
- Two Pointers
- Sliding Window
- Binary Search
- Stack
- Heap / Priority Queue
- Linked List
- Trees
- Graphs (BFS/DFS)
- Dynamic Programming
- Backtracking
- Greedy
- Intervals
- Trie
- Union Find
- Math / Bit Manipulation

## Data Model

### Pattern Mapping
Create a mapping from problem tags to pattern categories:

```javascript
const TAG_TO_PATTERN = {
    "two-pointers": "Two Pointers",
    "sliding-window": "Sliding Window",
    "binary-search": "Binary Search",
    "stack": "Stack",
    "monotonic-stack": "Stack",
    "heap-priority-queue": "Heap / Priority Queue",
    "linked-list": "Linked List",
    "tree": "Trees",
    "binary-tree": "Trees",
    "binary-search-tree": "Trees",
    "graph": "Graphs (BFS/DFS)",
    "depth-first-search": "Graphs (BFS/DFS)",
    "breadth-first-search": "Graphs (BFS/DFS)",
    "dynamic-programming": "Dynamic Programming",
    "backtracking": "Backtracking",
    "greedy": "Greedy",
    "interval": "Intervals",
    "trie": "Trie",
    "union-find": "Union Find",
    "math": "Math / Bit Manipulation",
    "bit-manipulation": "Math / Bit Manipulation",
};
```

### Correct Answer Logic
A guess is correct if the selected pattern matches ANY of the problem's tags (after mapping). Many problems have multiple valid patterns.

### Stats Tracking (localStorage)
```javascript
{
    "patternQuizStats": {
        "totalAttempts": 150,
        "correct": 120,
        "byPattern": {
            "Two Pointers": { "attempts": 20, "correct": 18 },
            "Dynamic Programming": { "attempts": 25, "correct": 12 },
            // ...
        },
        "problemsSeen": ["two-sum", "3sum", ...] // for "unseen only" mode later
    }
}
```

## Backend Changes

### New Endpoint or WebSocket Message

For enhanced mode, add a simple one-shot Claude query:

**Option A: REST endpoint**
```
POST /api/pattern-explain
{
    "problem_id": "two-sum",
    "guessed_pattern": "Sliding Window",
    "correct_pattern": "Two Pointers",
    "was_correct": false
}
```

Returns Claude's explanation as a string.

**Option B: WebSocket message type**
```javascript
{
    "type": "pattern_explain",
    "problem_id": "two-sum",
    "guessed_pattern": "Sliding Window",
    "correct_pattern": "Two Pointers",
    "was_correct": false
}
```

Server responds with `{ "type": "pattern_explanation", "content": "..." }`.

### Claude Prompts

**Wrong guess prompt:**
```
The user is practicing LeetCode pattern recognition. They were shown the problem "{title}" and guessed it requires the "{guessed_pattern}" pattern, but the correct pattern is "{correct_pattern}".

Problem description:
{description}

In 2-3 sentences, explain why {guessed_pattern} doesn't apply here and why {correct_pattern} is the right approach. Be encouraging but educational.
```

**Correct guess prompt:**
```
The user is practicing LeetCode pattern recognition. They correctly identified that "{title}" is a {correct_pattern} problem.

Problem description:
{description}

In 2-3 sentences, explain why {correct_pattern} is the right pattern for this problem and give a brief hint about how to approach it. Be encouraging.
```

## Implementation Steps

1. **Frontend: Add mode selector** — extend the existing mode toggle to include "Pattern Quiz"
2. **Frontend: Create pattern quiz UI** — new panel layout, pattern buttons, feedback area
3. **Frontend: Tag-to-pattern mapping** — implement matching logic
4. **Frontend: Basic mode feedback** — immediate correct/wrong with static text
5. **Frontend: Stats tracking** — localStorage persistence
6. **Backend: Pattern explain endpoint** — one-shot Claude query (no session, no streaming needed)
7. **Frontend: Enhanced mode** — call explain endpoint, display response

## Acceptance Criteria

- [ ] Pattern Quiz mode is selectable from the header
- [ ] Problem description displays without code editor
- [ ] 15 pattern buttons are displayed in a grid
- [ ] Clicking a pattern shows immediate correct/wrong feedback
- [ ] Basic mode works entirely client-side (no Claude calls)
- [ ] Enhanced mode toggle is visible and functional
- [ ] Enhanced mode shows Claude's explanation for both correct and wrong guesses
- [ ] Stats are tracked in localStorage and survive page refresh
- [ ] "Next Problem" loads a random problem (weighted toward unseen/weak patterns later)

## Future Enhancements (not in scope)

- Speed round mode (timed, 10s per problem)
- Spaced repetition weighting
- "Unseen problems only" toggle
- Per-pattern accuracy display
- Expand beyond NeetCode 150 to full dataset
- Streak/XP gamification
