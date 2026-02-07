# Deprioritized Neuro-Inclusive Features

Features from the "Cognitive Ergonomics and Neuro-Inclusive Design Architecture" research report that were evaluated but deprioritized for now. These are not rejected — they may be revisited in future iterations.

## Binaural Beats (40Hz Gamma)

**Report reference:** Section 5.1

The report suggests 40Hz gamma binaural beats may support focus and attentional binding. However, the evidence is explicitly described as "mixed" even within the report itself. The effect requires headphones (beats rely on frequency differences between left/right ears), and the implementation complexity of stereo oscillator management for an uncertain benefit doesn't justify the effort.

**Revisit if:** Stronger evidence emerges, or users specifically request it.

## Code Sonification for Nesting Depth

**Report reference:** Section 5.2

The idea of changing pitch based on cursor nesting depth (deeper in loops = higher pitch) is novel and theoretically sound. In practice, it's hard to implement well — the pitch mapping needs to be intuitive, not distracting, and the Monaco editor API for tracking nesting depth in real time adds complexity. Risk of the feature being more annoying than helpful is high.

**Revisit if:** Earcons (Ticket 33) prove popular and users ask for richer audio feedback. Could be built as an extension of the earcon system.

## Full "Tether" Activity Sensing Model

**Report reference:** Section 6.3

The Tether system proposes a state machine driven by mouse movement tracking, typing speed analysis, and active window focus detection. This is architecturally heavy for a web app — browsers intentionally limit access to focus/blur events for privacy, and continuous mouse tracking adds overhead. The simpler inactivity nudge system (Ticket 26) captures ~80% of the value with ~20% of the complexity by focusing on the two most detectable states: idle (no input) and flailing (repeated errors).

**Revisit if:** The app moves to an Electron/Tauri desktop wrapper where OS-level activity sensing is available.

## Local LLM via Ollama

**Report reference:** Section 6.1

The report recommends interfacing with local LLMs (Llama 3, Mistral) via Ollama for privacy and offline capability. This project already uses Claude Code SDK, which provides substantially better pedagogical quality than current local models. The latency concern the report raises is mitigated by the existing streaming implementation. Swapping to a local LLM would be a significant quality regression.

**Revisit if:** Local model quality reaches parity with Claude for educational scaffolding tasks, or if offline operation becomes a hard requirement.

## React Flow for Skill Tree

**Report reference:** Section 6.2

The report recommends React Flow for the skill tree visualization. This project uses vanilla JS with no build step — introducing React as a dependency for a single feature would be architecturally inconsistent. The Skill Tree (Ticket 31) will be built with DOM-based rendering and SVG edges instead, matching the existing tech stack.

**Not applicable:** unless the project migrates to a framework.

## "I Do, We Do, You Do" Explicit Workflow

**Report reference:** Section 4.1

The three-phase scaffolding model (AI demonstrates → AI + user collaborate → user works independently) is pedagogically sound, but the existing 5-level hint ladder in `tutor.py` already implements a comparable gradient from gentle nudges to pseudocode outlines. Formalizing the three phases as explicit UI states would add rigidity that conflicts with the current freeform chat-based interaction. The hint ladder is more flexible and already Socratic in approach.

**Revisit if:** User research shows learners need more structured phase transitions, particularly beginners who don't know when to ask for help.

## Whiteboard / Scratchpad Drawing Area

**Report reference:** Section 7.1

The report recommends a drawing area for visual problem-solving, citing math education research on "Self-Constructed Visualization." While valuable, implementing a usable drawing tool (with shapes, arrows, undo, etc.) is a significant effort that goes beyond the core code-editing experience. Users who need this can use external tools alongside the app.

**Revisit if:** The app moves to a desktop wrapper where embedding a lightweight canvas tool is easier, or if a simple line-drawing library can be integrated without bloat.

## Adaptive/Dynamic Interface Based on Cognitive State

**Report reference:** Section 7.2

The report proposes a system that "learns the user's cognitive state and adjusts the environment accordingly — suggesting Zen Mode when distraction is detected, or offering Audio Mode when reading speed slows." This requires sophisticated behavioral modeling and risks being perceived as invasive or patronizing. The inactivity nudge system (Ticket 26) is a limited, opt-in version of this concept. Full adaptive UI is premature before the manual controls (themes, zen mode, audio) are in place and validated.

**Revisit if:** Manual controls are well-adopted and users express interest in automation. Would require careful UX research to avoid the "creepy AI" effect.

---

*Last updated: 2026-02-06*
*Source report: "Cognitive Ergonomics and Neuro-Inclusive Design Architecture for Interactive Algorithmic Learning Platforms"*
