# ADHD-Informed Visual Design Strategy

This document summarizes findings from two commissioned research reports on ADHD visual attention and eye movement, and how they inform UI design across our projects. The primary implementation happens in focus-engine (tickets 050–059); relevant CSS token values are cherry-picked to leettutor per `docs/cherry-pick-plan-adhd-visual-changes.md`.

## Research Sources

Full reports are in `focus-engine/docs/ADHD Vision Reports/`:
- **"ADHD Visual Attention and Eye Movement Differences and Implications for UI Design"** — Conservative, evidence-grounded. Structures findings around specific oculomotor deficits. Flags confidence levels and gaps.
- **"ADHD and UI Design Research"** — Bolder design prescriptions. Introduces named principles (Externalized Working Memory, Visual Anchoring, No-Linger Policy). Deeper on frameworks.

## Key Findings

The research identifies six oculomotor deficits with strong evidence that directly impact UI usability. These are *physiological* — they are not about motivation or willpower.

### 1. Clutter Threshold Effect (Highest Impact)

**Finding**: ADHD perceptual performance is comparable to controls on clean displays but diverges *sharply* under visual density. There is a tipping point where clutter overwhelms limited executive resources for filtering.

**Evidence**: Group × trial-type interaction F ≈ 9.89, p ≈ .002. With no distractors, luminance thresholds similar; with distractors, ADHD thresholds nearly double (M ≈ 95 vs 50).

**Design implication**: Information density per viewport is the single most important variable. Reduce crowding between interactive elements. Use whitespace as attentional boundary, not decoration. Prefer progressive disclosure over all-at-once layouts.

### 2. Intrinsic Gaze Instability

**Finding**: Even on clean screens with no distractors, ADHD users show significantly larger gaze dispersion. The eye wanders more, making precision interaction (small checkboxes, tight click targets, fine print) physically harder.

**Evidence**: BCEA (bivariate contour ellipse area) η² ≈ 0.22 (large). Intrusive saccades Hedges' g = 1.11 (very large). Both persist without distractors.

**Design implication**: Minimum 44x44px touch targets. Generous spacing between clickable elements. Avoid small static tooltips. Provide undo for misclicks. Use borders/shading to anchor gaze on active areas.

### 3. Distractor Disengagement Deficit ("Linger Effect")

**Finding**: ADHD users are *not* significantly more likely to look at a distractor in the first place. But once gaze lands on one, they take significantly longer to look away.

**Evidence**: Initial capture similar (39% vs 40%); escape time 237ms vs 206ms (31ms Δ, statistically significant); additional fixations before disengaging.

**Design implication**: The problem is not capture, it's recovery. Design for rapid re-orientation: eliminate "sticky" elements (persistent notifications, floating chat bubbles, auto-playing content). Make toast notifications auto-fade. Provide clear "return to task" affordances after interruptions. Cap animation iterations so looping motion doesn't repeatedly re-capture attention.

### 4. Smooth Pursuit Deficit

**Finding**: ADHD users track moving targets with lower gain (eye velocity / target velocity) and compensate with choppy catch-up saccades.

**Evidence**: Pursuit gain 0.74 vs 0.82; catch-up saccades ~50 vs ~22.

**Design implication**: Continuous motion (carousels, marquees, parallax scrolling, drag-and-drop without snap-to-grid) is disproportionately costly. If animation is used, it must be brief, predictable, and discrete (fades, not slides). Offer motion reduction controls.

### 5. Weak Inhibition of Return (IOR)

**Finding**: The normal mechanism that suppresses re-attending to already-visited locations is weaker in ADHD. Users may unintentionally re-read the same row, re-scan the same list item, or lose track of "what I already looked at."

**Evidence**: IOR magnitude smaller; the internal "visited" tag fades faster. Combined with gaze dispersion, creates less efficient visual organization.

**Design implication**: The interface must externalize state the brain normally holds. Visibly mark visited/attempted items (color change, border). Use breadcrumbs. Make the current position sticky/persistent. Provide "recent items" lists. The user shouldn't have to remember where they were.

### 6. Antisaccade / Peripheral Capture

**Finding**: ADHD users make significantly more errors when asked to look *away* from a peripheral stimulus — they reflexively look at it first.

**Evidence**: Antisaccade direction errors d ≈ 0.70 (moderate-to-large). Meta-analysis: ~15 percentage points higher error rate.

**Design implication**: Peripheral UI elements (inactive panels, sidebar content, floating buttons) involuntarily pull gaze. Options: dim inactive regions to reduce salience, use zen mode to hide them entirely, or provide a gradient between the two. The low-distraction theme should do more than change colors — it should reduce peripheral salience.

## Design Principles

Derived from the findings above:

| Principle | Source Finding | Rule of Thumb |
|-----------|--------------|---------------|
| **Reduce crowding** | Clutter threshold | Fewer elements per viewport; whitespace as cognitive aid |
| **Make next action obvious** | Gaze instability, weak IOR | Strong visual hierarchy; primary actions visually dominant |
| **Motion is a budget** | Smooth pursuit deficit | Cap animation iterations; prefer fades over movement; motion must be optional |
| **Design for recovery, not prevention** | Linger effect | Auto-fade transient elements; clear "return to task" affordances |
| **Externalize memory** | Weak IOR | Mark visited states; sticky headers; breadcrumbs; scroll position persistence |
| **Enlarge and space targets** | Gaze instability | 44px minimum; generous gaps between clickable elements |
| **Dim the periphery** | Antisaccade errors | Reduce opacity on inactive panels; graduated focus modes |
| **Typography as rails** | Intrusive saccades | Line-height 1.7–1.8; column width 60–70ch; paragraph gaps |
| **Lighter modals** | Set-switching cost | Reduce overlay opacity; prefer drawers over full overlays |

## Key Insight for Implementers

The most important architectural decision: **overriding spacing tokens per-theme**. Because every component uses `var(--space-*)`, a single block of token overrides in `[data-theme="low-distraction"]` automatically expands spacing in every button, panel, gap, padding, and margin across the entire UI. This is the highest-leverage change — one selector, universal effect.

The second key insight: **the problem is disengagement, not capture**. Most "reduce distraction" advice focuses on preventing attention capture. The research shows ADHD users aren't much more capturable — they just take longer to *escape*. Design for rapid recovery (auto-fading elements, clear return-to-task affordances, lighter modals) rather than trying to eliminate all possible distractors.

## LeetTutor Applicability

LeetTutor shares the same three-panel layout and component patterns. When cherry-picking from focus-engine:

- **CSS token values** (touch targets, reading typography, animation ceiling, toast timing) copy directly into `style.css` `:root`
- **Low-distraction theme spacing overrides** — leettutor has a monolithic `style.css` with no multi-theme system; apply the expanded spacing values to a `[data-theme="low-distraction"]` block if the theme exists, or to the base `:root` if simplicity is preferred
- **Component changes** (touch targets, reading max-width, toast auto-fade) map to the same class names
- **JS modules** (click debouncing, scroll bookmarking) can be copied as standalone files

See `docs/cherry-pick-plan-adhd-visual-changes.md` for the full porting plan.
