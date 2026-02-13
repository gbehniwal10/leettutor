# Ticket 66: Adaptive Hint Policy

**Priority:** High
**Component:** `backend/tutor.py`, `backend/ws_handler.py`
**Estimated Scope:** Medium (new module + refactor existing hint tracking)
**Depends on:** None
**Port of:** focus-engine ticket 043 (all 3 sub-parts)
**Reference:** `focus-engine/backend/hint_policy.py` (348 lines)

## Overview

Replace the current informal hint system (a `hint_count` integer and system prompt guidance) with a formalized adaptive hint policy. The current system relies entirely on the LLM to decide hint specificity — this is inconsistent. The new system tracks hint level server-side (0–4), enforces escalation rules based on observable signals, detects unproductive help-seeking patterns, and gates bottom-out hints behind self-explanation.

## Research Evidence

- 72% of help-seeking in ITSs is unproductive (Aleven et al. 2004) — two distinct failure modes: hint abuse and help avoidance
- Self-explanation effect: articulating understanding strengthens schema construction (Bisra et al. 2018)
- Naive self-explanation can backfire; prompts must be targeted (Barbieri et al. 2023)
- Hierarchical hints improve problem-solving transfer (Koedinger et al. 2008)

## New Module: `backend/hint_policy.py`

Port from `focus-engine/backend/hint_policy.py` (348 lines).

### Constants

```python
MAX_HINT_LEVEL = 4

HINT_LEVELS = {0: "none", 1: "vague", 2: "specific", 3: "guided", 4: "bottom-out"}

# Help-seeking abuse detection
ABUSE_MIN_INTERVAL_SECS = 15
ABUSE_MIN_REQUESTS = 2

# Help avoidance detection
AVOIDANCE_ERROR_THRESHOLD = 5

# Self-explanation gate
SELF_EXPLANATION_GATE_LEVEL = 4
```

### Level Descriptions

| Level | Name | Tutor Behavior |
|-------|------|----------------|
| 0 | none | Pure Socratic — "What approach are you considering?" |
| 1 | vague | Conceptual direction — "Think about data structures for O(1) lookup" |
| 2 | specific | Points to exact area — "Line 7 exit condition is off-by-one" |
| 3 | guided | Heavy scaffolding — structured walkthrough, offer choices |
| 4 | bottom-out | Direct explanation (gated by self-explanation) |

### HelpPattern Enum

```python
class HelpPattern(str, Enum):
    NORMAL = "normal"
    ABUSE = "abuse"        # rapid-fire hints without edits between
    AVOIDANCE = "avoidance" # many errors, never asks for help
```

### Level-Specific Prompt Templates

Each level has a system prompt fragment constraining how specific the tutor can be. These are appended to the base system prompt when a hint is requested.

### Help-Seeking Coaching Prompts

- `ABUSE_COACHING_PROMPT`: Prepended when rapid-fire detected — "Take a moment to try applying the last hint before asking for more"
- `AVOIDANCE_OFFER_PROMPT`: Proactive offer with `{error_count}` — "You've hit {error_count} errors without asking for help. Getting hints is part of learning — would a nudge in the right direction help?"
- `SELF_EXPLANATION_GATE_PROMPT`: Before level 4 — "Before I explain further, tell me: what do you think is happening at [specific area]?"
- `SELF_EXPLANATION_EVAL_PREFIX`: After student responds to gate — acknowledgment + level 4 explanation

### Class: `HintPolicy`

```python
class HintPolicy:
    hint_level: int                    # 0–4
    total_hints_given: int
    self_explanation_pending: bool
    _hint_request_times: list[float]   # for abuse detection
    _edits_since_last_hint: int
    _errors_since_last_hint: int
    _total_errors_without_hint: int    # for avoidance detection
    _has_ever_requested_hint: bool

    def reset(self) -> None
    def record_edit(self) -> None
    def record_error(self) -> None

    def request_hint(self) -> tuple[int, str, dict]
        # Returns (level, prompt_to_inject, extra_fields)
        # Handles: abuse detection, escalation, self-explanation gate

    def process_self_explanation(self) -> tuple[int, str]
        # After student responds to gate question

    def escalate_for_flailing() -> tuple[int, str]
        # Auto-escalation from flailing nudge

    def classify_help_seeking(self) -> HelpPattern
    def check_help_avoidance(self) -> str | None
```

One instance per `LeetCodeTutor`. Travels through park/resume.

## Refactoring Existing Code

### `tutor.py`
- Remove `hint_count` from session state (replaced by `HintPolicy.hint_level` and `total_hints_given`)
- Create `HintPolicy` instance on tutor init, reset on new problem
- `request_hint()` calls `self.hint_policy.request_hint()` for the prompt fragment
- Update session state context string to include `hint_level` and `hint_level_name`

### `ws_handler.py`
- On `request_hint` message: delegate to tutor's hint policy
- On code submission error: call `hint_policy.record_error()`
- On editor activity (if available via existing nudge context): call `hint_policy.record_edit()`
- Check `hint_policy.check_help_avoidance()` periodically (e.g., in nudge handler) and inject offer if returned
- Handle self-explanation flow: if `self_explanation_pending`, route next user message through `process_self_explanation()`

### `frontend/modules/constants.js`
- Add `hint_level` to expected fields in `assistant_message` metadata (informational)

## Acceptance Criteria

- [ ] `HintPolicy` class in new `backend/hint_policy.py`
- [ ] `HelpPattern` enum with NORMAL, ABUSE, AVOIDANCE
- [ ] 5-level hint ladder with level-specific prompt templates
- [ ] Escalation on: explicit request, repeated failures (threshold: 2 attempts at level), flailing (3+ identical errors)
- [ ] Hint abuse detection: 2+ requests within 15s without edits → coaching prompt
- [ ] Help avoidance detection: 5+ errors without hint request → proactive offer
- [ ] Self-explanation gate before level 4 (bypass: >600s on problem, explicit "just tell me")
- [ ] `hint_count` removed from old system, replaced by policy
- [ ] Policy travels through park/resume
- [ ] Tests in new `tests/test_hint_policy.py`
- [ ] Existing tests updated for new hint interface
