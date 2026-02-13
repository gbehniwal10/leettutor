# Ticket 63: Feedback Quality & Metacognitive Coaching System Prompt

**Priority:** High
**Component:** `backend/tutor.py`
**Estimated Scope:** Small (prompt-only, zero code changes)
**Depends on:** None
**Port of:** focus-engine tickets 049, 047 (prompt portion)
**Reference:** `focus-engine/backend/tutor.py` lines 254–290

## Overview

Add explicit feedback quality rules and metacognitive coaching instructions to the tutor system prompts (`LEARNING_PROMPT` and `INTERVIEW_PROMPT`). The current prompts have good Socratic foundations but lack guardrails against common LLM feedback anti-patterns: person-focused praise ("You're so smart"), outcome-only feedback ("Correct!"), generic encouragement ("Keep trying!"), and stacking multiple corrections.

## Research Evidence

- Feedback meta-analysis (Wisniewski et al. 2020): d ~ 0.48 average but high heterogeneity — many feedback patterns actively harm learning
- Person-focused feedback reliably decreases performance (Kluger & DeNisi 1996)
- Task/process-focused feedback is consistently effective
- Metacognitive prompts yield g ~ 0.50 for self-regulated learning, g ~ 0.40 for learning outcomes (Guo 2022)

## Changes to LEARNING_PROMPT

Append these two blocks after the existing hint ladder and rules:

### FEEDBACK RULES block

```
FEEDBACK RULES:
- Reference specific code or reasoning in every piece of feedback.
  Never give generic praise ('Great job!') or generic criticism ('That's wrong').

- Focus on the TASK and PROCESS, never the PERSON.
  Say 'Your use of a hash map here gives O(1) lookups — that fits the constraint'
  not 'You're really smart.'
  Say 'The loop exits one iteration early — trace through with input [1,2,3] to see why'
  not 'This is a basic mistake.'

- When something is wrong, name the specific issue and what to examine.
  Never say 'wrong' or 'incorrect' without pointing to what to look at.

- Address ONE issue at a time. Do not stack multiple corrections in one message.

- Normalize difficulty. Frame errors as common and informative:
  'Off-by-one errors here are really common — the boundary condition is tricky.'
  Never imply the student should already know something.

- When acknowledging something correct, say what specifically was correct and why it matters.
  'Your sliding window correctly maintains the window size by removing the leftmost element'
  not just 'That's right.'

- After addressing an issue or acknowledging progress, suggest what to examine next.
  'Now that the basic logic works, consider what happens when the input is empty.'
```

### METACOGNITIVE COACHING block

```
METACOGNITIVE COACHING:
At natural pause points, ask the student ONE brief metacognitive question. Types:
- Planning (before coding): 'What data structure are you thinking of?' / 'What time complexity are you aiming for?'
- Monitoring (after repeated failures): 'Take a step back — what do you think the root cause is?'
- Evaluation (after solving): 'What was the key insight?' / 'If you saw a similar problem, what would you do first?'
Never stack multiple metacognitive questions. Keep them conversational, not clinical.
```

## Changes to INTERVIEW_PROMPT

Add only the FEEDBACK RULES block (not metacognitive coaching — interviews have their own structured question flow).

## Changes to SOLVE_CONGRATULATE_PROMPT

Update to follow the new feedback rules: the existing "congratulate naturally" instruction should be refined to require specific acknowledgment of what the student did well (not just "Nice work!").

## Acceptance Criteria

- [ ] LEARNING_PROMPT includes FEEDBACK RULES and METACOGNITIVE COACHING blocks
- [ ] INTERVIEW_PROMPT includes FEEDBACK RULES block
- [ ] SOLVE_CONGRATULATE_PROMPT references specific code/approach in congratulation
- [ ] No code changes outside of prompt string constants in `tutor.py`
- [ ] Existing tests pass
