# Cherry-Pick Plan: ADHD Visual Changes from Focus-Engine to LeetTutor

## Context

ADHD-informed visual design changes are being implemented in focus-engine first (the canonical project going forward). LeetTutor will receive cherry-picked CSS token values and any simple applicable JS changes. No shared infrastructure between the two projects — focus-engine is upstream, leettutor gets quick ports.

## Research Basis

Two research reports in `focus-engine/docs/ADHD Vision Reports/`:
- "ADHD Visual Attention and Eye Movement Differences and Implications for UI Design"
- "ADHD and UI Design Research"

Key findings driving the changes:
- **Clutter threshold effect**: ADHD perceptual performance diverges sharply under visual density (F ≈ 9.89, p ≈ .002)
- **Disengagement > capture**: Users take longer to escape distractors (237ms vs 206ms), not more likely to look at them
- **Intrinsic gaze instability**: Present even on clean screens (η² ≈ 0.22); typography acts as a "rail"
- **Smooth pursuit deficits**: Lower gain (0.74 vs 0.82) makes motion tracking choppy and costly
- **Weak inhibition of return**: Users may re-scan already-visited UI regions; interface must externalize "visited" state

## What to Cherry-Pick

### CSS Token Values (copy into `style.css` `:root`)

These are the ADHD-informed design token changes from focus-engine's `styles/tokens.css`:

- **Typography**: line-height 1.5-2.0x, column width 60-70ch, generous paragraph spacing
- **Spacing**: increased padding/margins between interactive elements to reduce crowding
- **Colors**: off-white backgrounds (cream/soft gray) instead of pure white for reduced luminance stress
- **Animation**: reduced motion durations, `prefers-reduced-motion` respected everywhere
- **Touch targets**: minimum 44x44px for all interactive elements
- **Z-index / layering**: non-persistent toast/alert durations

### JS Behavior (port as standalone copies if needed)

- Motion preference detection (respect `prefers-reduced-motion` beyond just CSS)
- Toast/notification auto-dismiss timing adjustments
- Any typography.js enhancements (if focus-engine extends it)

### What NOT to Port

- Focus-engine's multi-file CSS architecture (`styles/tokens.css`, `styles/themes/`, etc.) — leettutor's monolithic `style.css` is fine for its remaining lifespan
- Telemetry modules (042) — these wire into focus-engine's backend engagement scorer
- Adaptive interface features (eye-tracking-based dimming, etc.) — research prototypes, not production-ready

## Process

1. Implement in focus-engine first (canonical)
2. Once stable, copy the relevant CSS custom property values into leettutor's `style.css` `:root` block
3. Test in leettutor's UI (problem panel, editor, chat, test results)
4. No ongoing sync mechanism — one-time port, plus ad-hoc updates if focus-engine values change significantly before leettutor is retired
