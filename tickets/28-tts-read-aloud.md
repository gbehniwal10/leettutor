# Ticket 28: Problem Description Text-to-Speech (Read Aloud)

**Priority:** Medium-High
**Component:** `frontend/app.js`, `frontend/index.html`, `frontend/style.css`
**Estimated Scope:** Small
**Depends on:** None (standalone; optionally integrates with Ticket 21 for voice preference)

## Overview

Add a "Read Aloud" button on the problem description that uses the Web Speech API (`SpeechSynthesis`) to read the problem text. Optionally highlight the current sentence as it's spoken. This directly addresses the "Wall of Text" barrier that the research identifies as the primary friction point for dyslexic learners.

## Research Context

Section 5.3 of the cognitive ergonomics report identifies the "Wall of Text" as the primary barrier for dyslexic learners. Text-to-Speech with synchronized highlighting ("Dual Coding") significantly aids comprehension by reinforcing the link between written and spoken word. The Web Speech API is zero-dependency, works offline on most OSes, and provides high-quality neural voices on modern browsers.

## UI Design

### Read Aloud Button
- Place a speaker icon (🔊) button in the problem description panel header, next to the existing collapse toggle
- States:
  - **Idle**: Speaker icon, tooltip "Read aloud"
  - **Playing**: Animated speaker icon (or pulsing), tooltip "Pause"
  - **Paused**: Paused speaker icon, tooltip "Resume"
- Click toggles between play/pause
- Long-press or right-click shows voice selection (if multiple voices available)

### Sentence Highlighting (Dual Coding)
As TTS reads, highlight the current sentence in the problem description:
- Add a `.tts-active` CSS class to the current sentence element
- Styling: subtle background highlight (yellow-ish in sepia theme, soft blue in dark theme) — uses theme-aware CSS variable
- Smooth scroll to keep the current sentence in view

### Controls
- **Speed**: Adjustable rate (0.75x, 1.0x, 1.25x, 1.5x) — small control next to the play button
- **Stop**: Click the button while playing to pause; double-click or dedicated stop button to fully stop and reset position

## Implementation

### Text Extraction
The problem description is rendered as HTML (markdown-rendered). To read it aloud:

1. Get the text content from the problem description element
2. Split into sentences using a basic heuristic: split on `. `, `.\n`, `? `, `! ` (handling edge cases like "e.g." and numbered lists)
3. Queue sentences for sequential utterance

### Web Speech API Usage
```javascript
function readAloud(text, onSentenceStart) {
    const sentences = splitSentences(text);
    let current = 0;

    function speakNext() {
        if (current >= sentences.length) return;
        const utterance = new SpeechSynthesisUtterance(sentences[current]);
        utterance.rate = settingsManager.get('ttsRate') || 1.0;
        utterance.voice = getPreferredVoice();
        utterance.onstart = () => onSentenceStart(current);
        utterance.onend = () => { current++; speakNext(); };
        speechSynthesis.speak(utterance);
    }
    speakNext();
}
```

### Sentence Highlighting
1. Wrap each sentence in the problem description in a `<span data-sentence-idx="N">` during rendering
2. On `onSentenceStart(idx)`, add `.tts-active` to that span, remove from previous
3. Scroll the span into view with `scrollIntoView({ behavior: 'smooth', block: 'center' })`

### Handling Code Blocks
- Skip `<pre>` and `<code>` blocks in the problem description (don't read code examples aloud — they sound terrible via TTS)
- Or read them with a different voice/speed to distinguish from prose

### Voice Selection
- On first use, select the best available voice: prefer neural/enhanced voices, then locale-matched voices
- Store voice preference in SettingsManager if Ticket 21 is implemented; otherwise localStorage directly
- Expose a voice picker in settings (or inline next to the play button)

## Implementation Steps

1. **Add Read Aloud button** to problem description header
2. **Implement text extraction** — get text from description, split into sentences
3. **Wire Web Speech API** — sequential utterance with play/pause/stop
4. **Add sentence highlighting** — wrap sentences in spans, toggle `.tts-active` class
5. **Add speed control** — rate selector (0.75x–1.5x)
6. **Handle code blocks** — skip or differentiate
7. **Store voice/rate preference** — via SettingsManager or localStorage

## Acceptance Criteria

- [ ] Read Aloud button visible in problem description header
- [ ] Clicking starts TTS reading of the problem description
- [ ] Clicking again pauses; clicking once more resumes
- [ ] Current sentence is highlighted as it's being read
- [ ] Problem description auto-scrolls to keep current sentence visible
- [ ] Speed is adjustable (0.75x–1.5x)
- [ ] Code blocks in the description are skipped (not read aloud)
- [ ] TTS stops when navigating to a different problem
- [ ] Works offline (Web Speech API is browser-native)
- [ ] Graceful fallback if browser doesn't support SpeechSynthesis (hide the button)
