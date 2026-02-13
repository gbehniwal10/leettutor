# Ticket 65: Metacognitive Prompt Injection

**Priority:** Medium
**Component:** `backend/tutor.py`, `backend/ws_handler.py`
**Estimated Scope:** Small–Medium (new class + integration)
**Depends on:** Ticket 63 (system prompt has coaching instruction)
**Port of:** focus-engine ticket 047
**Reference:** `focus-engine/backend/metacognitive.py` (148 lines)

## Overview

Add structured metacognitive prompts at three natural problem-solving phases: planning (before coding), monitoring (after repeated failures), and evaluation (after solving). Ticket 63 adds the system prompt instruction telling the tutor to ask metacognitive questions; this ticket adds the server-side logic that injects specific prompts at the right moments.

## Research Evidence

- Metacognitive prompts: g ~ 0.50 for self-regulated learning, g ~ 0.40 for learning outcomes (Guo 2022)
- Key moderators: feedback, specificity, and adaptability improve effectiveness
- ADHD executive functioning: externalized planning reduces prefrontal burden

## New Module: `backend/metacognitive.py`

Port from `focus-engine/backend/metacognitive.py` (148 lines).

### Constants

```python
MONITOR_PROMPT_THRESHOLD = 3   # inject monitoring after N consecutive failures
EVAL_PROMPT_FREQUENCY = 2      # inject evaluation every N-th solve

PLANNING_PROMPTS = [
    "Before you start coding, what data structure and approach are you thinking of?",
    "What time complexity are you aiming for with your approach?",
    "Can you identify the key edge cases you'll need to handle?",
]

MONITORING_PROMPTS = [
    "You've hit a few errors in a row. Take a step back — what do you think is the root cause?",
    "How confident are you in your current approach (1-5)? Would it help to reconsider the algorithm?",
    "Are you solving the problem you think you're solving? Re-read the constraints.",
]

EVALUATION_PROMPTS = [
    "What was the key insight that unblocked you?",
    "If you saw a similar problem tomorrow, what would you do first?",
    "Rate your confidence with this pattern (1-5). Would you like another problem on this topic?",
]
```

### Class: `MetacognitiveCoach`

```python
class MetacognitiveCoach:
    _consecutive_failures: int
    _monitoring_prompted: bool   # one-shot per struggle streak
    _solve_count: int

    def reset(self) -> None
    def record_failure(self) -> None
    def record_success(self) -> None
    def should_inject_monitoring(self) -> bool
    def should_inject_evaluation(self) -> bool
    def get_monitoring_prompt(self) -> str | None
    def get_evaluation_prompt(self) -> str | None
```

One instance per `LeetCodeTutor`. Travels through park/resume with the tutor.

## Integration Points

### Planning prompt
In the tutor greeting (after problem is presented in `start_session`), append one randomly-selected planning prompt. This goes in the initial system context, not as a separate message.

### Monitoring prompt
In `ws_handler.py`, after a failed code submission:
1. Call `coach.record_failure()`
2. If `coach.should_inject_monitoring()`, inject the monitoring prompt into the next tutor context
3. One-shot: don't re-trigger until the student either solves or starts a new problem

### Evaluation prompt
In `auto_congratulate()` flow:
1. Call `coach.record_success()`
2. If `coach.should_inject_evaluation()`, append the evaluation prompt to the congratulation context
3. Fires every `EVAL_PROMPT_FREQUENCY` solves

### Key constraint
Never stack multiple metacognitive questions in one tutor turn. Planning OR monitoring OR evaluation, never combinations.

## Acceptance Criteria

- [ ] `MetacognitiveCoach` class in new `backend/metacognitive.py`
- [ ] Planning prompt included in post-problem greeting (1 of 3, random)
- [ ] Monitoring prompt injected after `MONITOR_PROMPT_THRESHOLD` consecutive failures (one-shot)
- [ ] Evaluation prompt injected every `EVAL_PROMPT_FREQUENCY` solves
- [ ] All thresholds are named constants at module level
- [ ] Coach state persists through tutor park/resume
- [ ] Never multiple metacognitive prompts in one turn
- [ ] Tests in new `tests/test_metacognitive.py`
- [ ] Existing tests pass
