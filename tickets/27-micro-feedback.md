# Ticket 27: Micro-Feedback on Code Submission

**Priority:** Medium-High
**Component:** `frontend/app.js`, `frontend/style.css`
**Estimated Scope:** Small-Medium
**Depends on:** Ticket 25 (Reduced Motion Support — for `shouldReduceMotion()`)

## Overview

Replace the static pass/fail banners with animated, granular feedback that visualizes partial progress. Currently, code submission shows a binary result banner (green "Accepted" / red "Wrong Answer"). The cognitive ergonomics research identifies granular, immediate feedback as critical for sustaining the dopamine-driven motivation loop that ADHD learners depend on.

## Research Context

Section 3.1.1 of the report details how the ADHD brain is "chemically under-stimulated regarding dopamine" and requires immediate, granular feedback to sustain engagement. The key insight: showing **partial progress** ("3/5 tests passing") triggers "completion bias" — the psychological urge to finish a set once progress is visible. Binary pass/fail provides no dopamine until the very end, causing premature disengagement.

Section 3.1.1 also notes that error feedback should be "less aggressive than a bright red alert, reducing the emotional sting of failure."

## Features

### 1. Test Case Progress Bar
When running or submitting code, show an animated progress bar that fills per test case:

```
Running tests...  [████████░░░░░░░░] 3/5 passed
```

- Each test case result fills one segment
- Green segments for passed, red for failed
- Animate the fill as results come in (or simulate sequential reveal if results arrive all-at-once)
- Show the count: "3/5 passed" or "5/5 — All tests passed!"

### 2. Per-Test Feedback
Below the progress bar, show individual test case results as expandable rows:
```
✓ Test 1: twoSum([2,7,11,15], 9) → [0,1]
✓ Test 2: twoSum([3,2,4], 6) → [1,2]
✗ Test 3: twoSum([3,3], 6) → Expected [0,1], got [0,0]
```

- Passed tests show ✓ icon (green) and collapse by default
- Failed tests show ✗ icon (red), expanded by default with expected vs actual
- This replaces the current output display for test results

### 3. Success Celebration
When all tests pass (5/5):
- Progress bar turns fully green with a brief "glow" pulse animation
- A small CSS confetti burst (no library — pure CSS/JS particles)
- A satisfying message: "All tests passed! Great work." with a ✓ icon
- If `shouldReduceMotion()` is true: skip confetti, just show the green bar + message

### 4. Failure Softening
When tests fail:
- The progress bar shows partial green + partial red (not all-red)
- Failed test rows use a muted red (#cd8c8c in dark mode), not harsh bright red
- Encouraging prefix: "Almost there — 3/5 tests passing" rather than "Wrong Answer"
- The progress bar gently "shakes" once (2-3px horizontal oscillation, 200ms) if `shouldReduceMotion()` is false

### 5. Improvement Detection
Track the test pass count across consecutive runs within a session:
- If the user improves (went from 2/5 to 3/5), show: "Progress! You went from 2 to 3 passing tests."
- This provides positive reinforcement even when not fully solving the problem

## Implementation

### Data Flow
The existing `/api/run` and `/api/submit` endpoints already return per-test results. The frontend currently aggregates these into a single pass/fail banner. Change the rendering to:

1. Parse individual test results from the response
2. Render the progress bar + per-test rows
3. Apply celebration or softened failure styling
4. Track pass count in session state for improvement detection

### CSS Confetti (Lightweight)
No library needed. Use 15-20 small `<div>` elements with random CSS `animation`:
```css
.confetti-particle {
    position: fixed;
    width: 8px;
    height: 8px;
    animation: confetti-fall 1.5s ease-out forwards;
}
@keyframes confetti-fall {
    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
    100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
}
```
Particles are created, animated, then removed from DOM. Triggered only on all-pass.

## Implementation Steps

1. **Redesign test result display** — progress bar + expandable per-test rows
2. **Add progress bar component** — segmented bar with green/red fills
3. **Add success celebration** — confetti animation (CSS-only, respects reduced motion)
4. **Soften failure feedback** — encouraging language, muted colors, gentle shake
5. **Add improvement detection** — track pass counts across runs, show delta
6. **Wire to reduced motion** — skip animations when `shouldReduceMotion()` is true

## Acceptance Criteria

- [ ] Progress bar shows per-test results (e.g., "3/5 passed")
- [ ] Individual test cases are shown with pass/fail icons and expandable details
- [ ] All-pass triggers a brief celebration animation (confetti + glow)
- [ ] Failure messaging is encouraging ("Almost there — 3/5") not punitive ("Wrong Answer")
- [ ] Improvement between runs is detected and acknowledged
- [ ] All animations respect `shouldReduceMotion()` — celebration degrades to static message
- [ ] Failed tests use muted red, not harsh bright red
- [ ] Progress bar animates sequentially (segments fill one by one) for dopamine effect
- [ ] Confetti particles are cleaned up from DOM after animation completes
