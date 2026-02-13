# Ticket 69: Spaced Review & Problem Recommendation

**Priority:** Medium
**Component:** `backend/`, `frontend/modules/problems.js`
**Estimated Scope:** Medium (2 new backend modules + frontend UI)
**Depends on:** Ticket 68 (competence tracker provides topic data)
**Port of:** focus-engine ticket 045 (adapted for static problem pool)
**Reference:** `focus-engine/backend/learning_history.py` (168 lines), `focus-engine/backend/review_scheduler.py` (302 lines)

## Overview

Track per-topic learning history and schedule spaced reviews using a Leitner-box system. Since leettutor has a static pool of 138 problems (not generated), "interleaving" becomes **problem recommendation** — the system surfaces "due for review" problems in the problem picker rather than generating new ones.

## Research Evidence

- Spacing effect: distributing practice over time produces superior retention (Cepeda et al. 2006)
- Leitner system: simple, effective model for spaced review (Leitner 1972)
- Interleaving: mixing related topics improves transfer and pattern discrimination (Kornell & Bjork 2008) — directly relevant for distinguishing similar leetcode patterns (sliding window vs two-pointer)

## New Module: `backend/learning_history.py`

Port from `focus-engine/backend/learning_history.py` (168 lines).

### Per-Attempt Record

```python
{
    "topic": "sliding-window",       # from problem tags
    "problem_id": "minimum-window-substring",
    "difficulty": "hard",
    "timestamp": 1707000000,
    "solved": True,
    "time_to_solve_s": 1200,
    "hint_level_used": 2,            # max level reached
    "attempts": 4                    # code submissions
}
```

### Class: `LearningHistory`

```python
class LearningHistory:
    def __init__(self, data_dir: str)
    async def load(self) -> None
    async def record_attempt(self, topic, problem_id, difficulty,
                              solved, time_to_solve_s, hint_level_used,
                              attempts) -> None
    def get_topic_summary(self, topic: str) -> dict
        # total_attempts, total_solves, last_practiced, avg_hint_dependency, etc.
    def get_all_topic_summaries(self) -> dict[str, dict]
    def get_problem_history(self, problem_id: str) -> list[dict]
```

Persistence: `sessions/learning_history.json`, atomic writes.

Migration: on first load, if file absent, optionally scan existing session logs to backfill.

## New Module: `backend/review_scheduler.py`

Port from `focus-engine/backend/review_scheduler.py` (302 lines).

### Leitner Box Model

```python
SPACING_INTERVALS = [1, 2, 5, 14, 30, 90]  # days per box (0–5)
OVERDUE_PENALTY_FACTOR = 2.0                 # demote if overdue by >2x interval
REVIEW_RATIO_DEFAULT = 0.4                   # 40% review in mixed mode
MAX_CONSECUTIVE_REVIEW = 2
```

| Box | Interval | Meaning |
|-----|----------|---------|
| 0 | 1 day | Just learned |
| 1 | 2 days | One successful review |
| 2 | 5 days | Strengthening |
| 3 | 14 days | Consolidating |
| 4 | 30 days | Long-term |
| 5 | 90 days | Mastered |

### Class: `ReviewScheduler`

```python
class ReviewScheduler:
    def __init__(self, learning_history: LearningHistory)

    def get_due_topics(self) -> list[dict]
        # Returns [{topic, box, days_overdue, priority}] sorted by priority

    def get_due_problems(self, available_problems: list[dict]) -> list[dict]
        # Maps due topics to specific problems from the static pool
        # Prefers problems the student hasn't solved yet on that topic
        # Falls back to previously-solved problems for true review

    def record_review_result(self, topic: str, solved: bool) -> None
        # Advance box on success, demote on failure

    def get_session_plan(self, requested_problem_id: str | None) -> dict
        # Returns {primary, is_review, review_queue, suggested_mix}
```

### Adaptation for Static Problems

Focus-engine generates problems for review topics. LeetTutor selects from its 138-problem pool:

1. Map due topics to problems by matching the topic against problem `tags`
2. Prefer unsolved problems on the topic (fresh practice)
3. If all problems on topic are solved, pick the one solved longest ago (true spaced retrieval)
4. If no problems match the topic, skip it in the review queue

## Frontend Integration

### Problem Picker Enhancement (`frontend/modules/problems.js`)

Add visual indicators to the problem list:
- "Due for review" badge on problems whose topic is overdue
- Sort option: "Review priority" (due topics first)
- Optional: "Suggested next" highlight for the highest-priority review problem

### New REST Endpoint

```
GET /api/review-queue
```

Returns the review queue with due topics and recommended problems. The frontend fetches this on load and on session end.

### Post-Solve Review Prompt

After solving a review problem, the tutor prompts retrieval:
"You last practiced [topic] X days ago. What's the key difference between [topic] and [related topic]?"

This combines spacing (reactivation) with elaborative interrogation (distinction).

Add `REVIEW_RETRIEVAL_PROMPT` constant to `tutor.py`.

## Acceptance Criteria

- [ ] `LearningHistory` class in new `backend/learning_history.py`
- [ ] `ReviewScheduler` class in new `backend/review_scheduler.py`
- [ ] Leitner 6-box system with expanding intervals
- [ ] Box advancement on successful review, demotion on failure or overdue
- [ ] Priority scoring: overdue-ness, box level (fragile = urgent), competence
- [ ] Due topics mapped to static problem pool by tag matching
- [ ] `GET /api/review-queue` endpoint
- [ ] Problem picker shows "due for review" indicators
- [ ] Post-solve retrieval prompt for review problems
- [ ] All intervals and thresholds are named constants
- [ ] Persistence in `sessions/learning_history.json` and scheduler state
- [ ] Tests in `tests/test_learning_history.py` and `tests/test_review_scheduler.py`
- [ ] Existing tests pass
