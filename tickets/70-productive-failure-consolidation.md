# Ticket 70: Productive Failure & Consolidation

**Priority:** Low–Medium
**Component:** `backend/tutor.py`, `backend/ws_handler.py`, `backend/problems/`
**Estimated Scope:** Medium (prompt engineering + problem metadata + consolidation flow)
**Depends on:** Ticket 62 (structured approaches), Ticket 68 (competence model for eligibility)
**Port of:** focus-engine ticket 046 (adapted for static problems)
**Reference:** `focus-engine/backend/consolidation.py` (131 lines), `focus-engine/backend/invention_generator.py` (for schema)

## Overview

Add a consolidation phase after solving problems that have multiple valid approaches. Instead of just "Correct! What's the time complexity?", the tutor walks through the student's approach, compares it to alternatives, explains key insights, and prompts reflection. This leverages the "productive failure" research: learning is deeper when the student's own attempt is explicitly compared to better alternatives.

## Research Evidence

- Productive failure: self-generated solutions before instruction improve conceptual understanding and transfer (Kapur 2008, Kapur & Bielaczyc 2012)
- Instruction referencing student attempts is more effective than generic instruction (Sinha et al. 2021)
- Elaborative comparison: contrasting approaches aids schema construction (Schwartz & Martin 2004)

## Adaptation for Static Problems

Focus-engine generates "invention problems" with `alternative_approaches` metadata. LeetTutor has static problems — but many naturally have 2–4 distinct approaches. Ticket 62 is already adding structured approach objects to all 138 problems:

```json
{
    "approaches": [
        {"name": "Hash Map (Two Pass)", "complexity": {"time": "O(n)", "space": "O(n)"}},
        {"name": "Brute Force (Nested Loops)", "complexity": {"time": "O(n^2)", "space": "O(1)"}},
        {"name": "Sort + Two Pointer", "complexity": {"time": "O(n log n)", "space": "O(1)"}}
    ]
}
```

This ticket uses that metadata for consolidation. No problem generation needed.

## Consolidation Flow

### Trigger Conditions

Consolidation fires after a successful solve when ALL of:
1. Problem has 2+ approaches in its metadata
2. Student competence on the topic is Developing+ (not Novice — they need Guided mode, not comparison)
3. The approach classifier (existing) has identified the student's approach

Also fires when:
- Student gives up / requests full solution → consolidation as learning event
- Stuck >900s without progress → offer to move to consolidation
- Hint ladder reaches bottom-out → consolidation replaces generic explanation

### Consolidation Prompt

New constant `CONSOLIDATION_PROMPT` in `tutor.py`:

```
CONSOLIDATION (after solve or give-up):
1. ACKNOWLEDGE: Reference the student's specific approach and what they did.
   "You used [approach name] — [brief description of their strategy]."

2. COMPARE: Walk through 1–2 alternative approaches from the problem metadata.
   "Another approach is [name]: [brief explanation]. This gives [complexity]."

3. KEY INSIGHT: What makes the optimal approach better? What principle?
   "The key insight: [specific conceptual principle]."

4. CONNECT: Where did the student's approach diverge? What would they change?
   "Your [approach] does X. The alternative avoids this by doing Y."

5. REFLECT: One question prompting the student to synthesize.
   "When would you choose one approach over the other?"
```

### Implementation

In `ws_handler.py`, after `auto_congratulate()`:
1. Check consolidation eligibility (conditions above)
2. If eligible, build consolidation context: student's code + classified approach + problem approaches metadata
3. Inject `CONSOLIDATION_PROMPT` + context into tutor chat
4. Tutor generates the 5-part consolidation response (streamed normally)

### Post-Consolidation (if student didn't solve)

If consolidation was triggered by give-up or timeout:
- After consolidation, offer: "Would you like to try implementing [alternative approach] now?"
- If accepted: reset hint ladder, switch to Scaffolded mode for the re-attempt
- Record in learning history: `solved=False, consolidation_received=True`

### Constants

```python
CONSOLIDATION_PROMPT = "..."           # 5-part structure above
CONSOLIDATION_TIMEOUT = 900            # seconds before offering consolidation on stuck
CONSOLIDATION_MIN_APPROACHES = 2       # problem needs >= 2 approaches
```

## Acceptance Criteria

- [ ] `CONSOLIDATION_PROMPT` constant in `tutor.py` with 5-part structure
- [ ] Consolidation triggers after solve (when eligible), give-up, timeout, or bottom-out
- [ ] Consolidation references the student's actual approach (from classifier)
- [ ] Consolidation compares to 1–2 alternatives from problem metadata
- [ ] Post-consolidation "try again" offer for unsolved problems
- [ ] Eligibility: 2+ approaches in problem, competence Developing+
- [ ] `CONSOLIDATION_TIMEOUT` is a named constant
- [ ] All thresholds are named constants
- [ ] Depends on ticket 62 (structured approaches in problem JSON)
- [ ] Existing tests pass
- [ ] New test in `test_ws_protocol.py`: consolidation flow after solve
