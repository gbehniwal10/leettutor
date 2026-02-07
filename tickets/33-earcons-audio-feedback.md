# Ticket 33: Earcons (Subtle Audio Feedback)

**Priority:** Medium
**Component:** `frontend/app.js`
**Estimated Scope:** Small-Medium
**Depends on:** Ticket 21 (Settings Panel — for earcons toggle), Ticket 25 (Reduced Motion — shares "reduce sensory" concept)

## Overview

Add optional subtle sound effects ("earcons") for key events: test pass, test fail, all-pass success, and brace matching. These provide a non-visual feedback channel that allows users to "hear" the health of their code without breaking focus to visually scan results. All sounds are synthesized via Web Audio API — no audio file dependencies.

## Research Context

Section 5.2 of the cognitive ergonomics report describes sonification as "critical for blind users but also a powerful tool for sighted users with attention issues." Earcons provide "immediate, non-visual feedback" that "allows the user to hear the health of their code while typing, reducing the need to constantly break focus to look at the error list."

The report recommends:
- **Syntax error**: discordant sound (dull thud or low buzz)
- **Successful compile/run**: harmonious sound (major chord or chime)
- **Scope checking**: subtle click/clack for brace open/close

## Sound Design

### Earcon Palette
All sounds generated via Web Audio API `OscillatorNode` + `GainNode`:

| Event | Sound | Duration | Implementation |
|-------|-------|----------|---------------|
| Test Passed | Short rising chime (C5→E5) | 150ms | Two sine oscillators, ascending |
| Test Failed | Low thud | 200ms | Low-frequency sine (100Hz) with fast decay |
| All Tests Passed | Major chord (C4-E4-G4) | 400ms | Three sine oscillators, simultaneous |
| Brace Open `{` | Soft click | 50ms | White noise burst, high-pass filtered |
| Brace Close `}` | Slightly lower click | 50ms | White noise burst, band-pass filtered |
| Error on Run | Descending tone (E4→C4) | 200ms | Two sine oscillators, descending |

### Volume
- Earcons play at a fixed low volume (0.15 gain) — they should be ambient, not startling
- Affected by a master earcon volume in settings (default 30%)
- Brown noise (Ticket 30) volume is independent

## Implementation

### Sound Generator
```javascript
class EarconPlayer {
    constructor() {
        this.audioCtx = null;  // lazy init
    }

    _ensureContext() {
        if (!this.audioCtx) this.audioCtx = new AudioContext();
        return this.audioCtx;
    }

    playChime(startFreq, endFreq, duration) {
        const ctx = this._ensureContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + duration/1000);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration/1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration/1000);
    }

    playChord(frequencies, duration) {
        frequencies.forEach(f => this.playChime(f, f, duration));
    }

    testPassed()    { this.playChime(523, 659, 150); }   // C5→E5
    testFailed()    { this.playChime(100, 80, 200); }     // low thud
    allPassed()     { this.playChord([262, 330, 392], 400); } // C4-E4-G4
    errorOnRun()    { this.playChime(330, 262, 200); }    // E4→C4 descending
}
```

### Integration Points

**Test results (from `/api/run` and `/api/submit`):**
- Parse individual test results
- Play `testPassed()` for each passing test (with 100ms delay between)
- Play `testFailed()` for first failing test
- After all tests, if all passed: play `allPassed()` (replaces individual chimes)

**Brace matching (Monaco editor):**
- Listen to `editor.onDidChangeModelContent` for `{` and `}` characters typed
- Play the corresponding click sound
- Only trigger on direct typing, not on paste or undo (check the change source)

**Runtime errors:**
- When code execution returns an error (exception, timeout), play `errorOnRun()`

### Settings
| Setting | Control | Default |
|---------|---------|---------|
| `earcons` | Toggle | Off |
| `earconVolume` | Slider (0–100%) | 30% |

Earcons default to **off** — they must be explicitly opted into. This protects sensory-sensitive users from unexpected sounds.

### Sharing AudioContext with Ambient Sound
If both earcons and ambient sound (Ticket 30) are active, they should share the same `AudioContext` to avoid resource issues. Extract a shared `AudioContextManager`:
```javascript
class AudioContextManager {
    static get() {
        if (!this._ctx) this._ctx = new AudioContext();
        return this._ctx;
    }
}
```

## Implementation Steps

1. **Create `EarconPlayer` class** with Web Audio API sound generation
2. **Design each earcon sound** — tune frequencies and durations to be pleasant and unobtrusive
3. **Wire to test results** — play per-test and all-pass sounds
4. **Wire to brace typing** — Monaco content change listener
5. **Wire to runtime errors** — error response handler
6. **Add settings toggle and volume** — earcons off by default
7. **Share AudioContext** with ambient sound generator (Ticket 30)
8. **Test** — ensure sounds are subtle, properly timed, and don't overlap badly

## Acceptance Criteria

- [ ] Earcons are OFF by default — must be enabled in settings
- [ ] Test pass plays a brief rising chime
- [ ] Test fail plays a brief low thud
- [ ] All tests passing plays a pleasant chord
- [ ] Runtime error plays a descending tone
- [ ] Brace open/close play subtle click sounds while typing
- [ ] Sounds are subtle (low volume) and not startling
- [ ] Volume is adjustable via settings slider
- [ ] Sounds do not play when earcons setting is off
- [ ] AudioContext is shared with ambient sound generator (no double contexts)
- [ ] No audio glitches when multiple earcons fire in quick succession
