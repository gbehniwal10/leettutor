# Ticket 68: Expertise-Adaptive Pedagogy

**Priority:** Medium
**Component:** `backend/tutor.py`, `backend/ws_handler.py`
**Estimated Scope:** Medium (2 new modules + integration)
**Depends on:** Ticket 66 (hint policy, for mode-aware defaults)
**Port of:** focus-engine ticket 044 (sub-parts 01 and 02; worked examples deferred)
**Reference:** `focus-engine/backend/competence_tracker.py` (198 lines), `focus-engine/backend/tutor_modes.py` (99 lines)

## Overview

Build a per-topic competence model from session history and use it to switch between three tutoring modes: Guided (novice), Scaffolded (developing), Independent (expert). The key research finding: the same instructional strategy that helps novices **actively harms** experts (expertise reversal effect). LeetTutor currently uses the same prompt regardless of whether the student has solved 0 or 10 problems on a topic.

## Research Evidence

- Expertise reversal effect: detailed explanations help novices, harm experts (Kalyuga et al. 2003)
- Fading: gradually remove scaffolding as competence increases (Vygotsky's ZPD)
- Cognitive Load Theory: novices need worked examples to reduce extraneous load

## New Module: `backend/competence_tracker.py`

Port from `focus-engine/backend/competence_tracker.py` (198 lines).

### Competence Levels

```python
COMPETENCE_NOVICE = 0
COMPETENCE_DEVELOPING = 1
COMPETENCE_COMPETENT = 2
COMPETENCE_EXPERT = 3

COMPETENCE_LABELS = {0: "novice", 1: "developing", 2: "competent", 3: "expert"}
```

### Thresholds

```python
DEVELOPING_MIN_SOLVES = 1
COMPETENT_MIN_SOLVES = 3
EXPERT_MIN_SOLVES = 6

HEAVY_HINT_THRESHOLD = 3   # avg hint level >= 3 caps at DEVELOPING
LOW_HINT_THRESHOLD = 1     # avg hint level <= 1 enables COMPETENT/EXPERT
COMPETENCE_DECAY_DAYS = 14  # unpracticed topics drop one level
EXPERT_REQUIRES_HARD = True
```

### Class: `CompetenceTracker`

```python
class CompetenceTracker:
    def __init__(self, data_dir: str)
    async def load(self) -> None
    def get_competence(self, topic: str) -> int       # 0–3 with decay
    def get_all_competences(self) -> dict[str, int]
    async def record_solve(self, topic: str, difficulty: str,
                           hints_used: int, hint_level: int,
                           duration_seconds: float) -> None
```

Persistence: `sessions/competence.json`, atomic writes (tempfile + `os.replace`).

### Data Sources

LeetTutor already has per-session logs in `sessions/`. The competence tracker aggregates from:
- Problem tags (the `tags` field in problem JSON, e.g. `["array", "hash-map"]`)
- Difficulty level
- Hint usage (from hint policy, ticket 66)
- Time to solve
- Recency (days since last practice on topic)

## New Module: `backend/tutor_modes.py`

Port from `focus-engine/backend/tutor_modes.py` (99 lines).

### Mode Mapping

```python
COMPETENCE_TO_MODE = {
    0: "guided",       # NOVICE
    1: "scaffolded",   # DEVELOPING
    2: "independent",  # COMPETENT
    3: "independent",  # EXPERT
}

DOWNSHIFT_HINT_THRESHOLD = 3  # independent → scaffolded if hint_level >= 3
```

### Mode-Specific Prompt Fragments

**Guided** (novice):
- Lead with explanation before asking questions
- Step-by-step with concrete examples
- Active understanding checks ("Does this make sense?")
- Hint ladder starts at level 2 (specific)

**Scaffolded** (developing):
- Socratic questioning with moderately specific cues
- Prompt self-explanation ("Why did you choose a hash map?")
- Hint ladder starts at level 0 (normal progression)

**Independent** (competent/expert):
- Pure Socratic — only respond when asked
- Focus on higher-order thinking: optimization, alternatives, edge cases
- Keep responses brief, respect flow
- Hint ladder starts at 0 with slower escalation

### Mode Selection

```python
def select_tutor_mode(competence_level: int) -> str
def should_downshift(current_mode: str, hint_level: int) -> str | None
    # Returns "scaffolded" if independent + hint_level >= 3
    # No upshifts mid-problem
```

## Integration

### `ws_handler.py`
- On `start_session`: load competence for the problem's tags, select tutor mode, include mode in `session_started` response
- On problem solve: call `competence_tracker.record_solve()` with topic, difficulty, hints, time
- Pass `tutor_mode` to tutor so it can use the correct prompt fragment

### `tutor.py`
- Accept `tutor_mode` parameter
- Append the mode-specific prompt fragment to the base system prompt
- If hint policy (ticket 66) reports hint_level >= `DOWNSHIFT_HINT_THRESHOLD` and mode is independent → downshift to scaffolded for remainder of problem

### Worked Examples (044-03): DEFERRED

Worked example generation is less applicable to leettutor's static problem pool. If desired later, a simpler approach: add an optional `worked_example` field to problem JSON files with pre-written step-by-step walkthroughs for the most common easy problems. Not in scope for this ticket.

## Acceptance Criteria

- [ ] `CompetenceTracker` class in new `backend/competence_tracker.py`
- [ ] `select_tutor_mode()` and `should_downshift()` in new `backend/tutor_modes.py`
- [ ] Three mode-specific prompt fragments (guided, scaffolded, independent)
- [ ] Competence computed from: solve count, difficulty, hint dependency, recency
- [ ] Decay: drop one level after 14 days without practice
- [ ] Mode selected at session start based on problem tags
- [ ] Mid-problem downshift (independent → scaffolded) on heavy hint usage
- [ ] No mid-problem upshift
- [ ] Competence persisted in `sessions/competence.json` (atomic writes)
- [ ] `tutor_mode` included in `session_started` WebSocket message
- [ ] Tests in new `tests/test_competence_tracker.py`
- [ ] Existing tests pass
