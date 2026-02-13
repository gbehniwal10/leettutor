# Ticket 67: Engagement Telemetry

**Priority:** Medium
**Component:** `frontend/modules/`, `backend/`, `backend/ws_handler.py`
**Estimated Scope:** Medium–Large (4 new frontend modules + 1 backend module + integration)
**Depends on:** None (but enhances tickets 64, 66)
**Port of:** focus-engine ticket 042 (all 3 sub-parts)
**Reference:** `focus-engine/frontend/modules/keystroke-telemetry.js` (259 lines), `mouse-telemetry.js` (297 lines), `attention-telemetry.js` (214 lines), `telemetry-aggregator.js` (129 lines), `backend/engagement_scorer.py` (270 lines)

## Overview

Add rich behavioral telemetry to detect engagement, confusion, and flow states. The current system has binary detection (idle vs active, flailing vs not). This replaces it with continuous 0–1 scores computed from keystroke dynamics, mouse movement patterns, and attention signals. These scores enable: smarter nudge suppression during flow, earlier detection of confusion, and data for the adaptive hint policy (ticket 66).

## Research Evidence

- Keystroke dynamics (pause-burst patterns) indicate cognitive processing stages — highest-ROI sensor per research synthesis
- Mouse erraticism correlates with frustration/confusion (HCI literature)
- Interrupting flow/hyperfocus is disproportionately damaging for ADHD learners (Ashinoff & Abu-Akel 2021)
- Eye-tracking adds ML AUC from 0.76 → 0.88, but keystroke/mouse telemetry is hardware-free and nearly as informative

## Frontend Modules

All processing happens locally in the browser; only aggregate 30-second summaries are sent to the backend. Privacy-first: no raw keystroke data transmitted.

### `frontend/modules/keystroke-telemetry.js`

Hook Monaco editor's `onDidChangeModelContent` and `onDidType`. Track:
- Inter-key interval (IKI) distribution (rolling 30s window)
- Edit-undo frequency
- Large deletions (>20 chars)
- Typing cadence (chars/sec)

Export: `configureKeystrokeTelemetryDeps(deps)`, `getKeystrokeSummary()`

### `frontend/modules/mouse-telemetry.js`

Track `mousemove` events (throttled ~10Hz). Compute:
- Velocity
- Trajectory smoothness (path length / displacement ratio)
- Dwell regions (which UI panel gets most time)
- Erratic movement score (sudden direction changes)

Export: `configureMouseTelemetryDeps(deps)`, `getMouseSummary()`

### `frontend/modules/attention-telemetry.js`

Track `document.visibilitychange`, `window.blur/focus`. Compute:
- Tab-switch count
- Time-away ratio
- Return-context patterns

Export: `configureAttentionTelemetryDeps(deps)`, `getAttentionSummary()`

### `frontend/modules/telemetry-aggregator.js`

Every 30 seconds, collect summaries from all three modules and send via WebSocket:

```javascript
{
    "type": "telemetry_update",
    "keystroke": { /* cadence, iki_variance, undo_count, large_deletions */ },
    "mouse": { /* smoothness, erratic_score, velocity */ },
    "attention": { /* tab_switches, time_away_ratio */ },
    "window_start": 1707000000,
    "window_end": 1707000030
}
```

Export: `configureTelemetryAggregatorDeps(deps)`, `startTelemetry()`, `stopTelemetry()`

### Wiring in `app.js`

Wire all four modules with dependency injection. Start telemetry on session start, stop on session end.

## Backend Module: `backend/engagement_scorer.py`

Port from `focus-engine/backend/engagement_scorer.py` (270 lines).

### Score Weights

```python
ENGAGEMENT_WEIGHTS = {
    "typing_cadence": 0.30,
    "mouse_smoothness": 0.15,
    "low_tab_switches": 0.25,
    "low_time_away": 0.20,
    "low_erratic": 0.10,
}

CONFUSION_WEIGHTS = {
    "iki_variance": 0.30,
    "undo_frequency": 0.25,
    "erratic_mouse": 0.20,
    "large_deletions": 0.15,
    "high_tab_switches": 0.10,
}

FLOW_WEIGHTS = {
    "sustained_engagement": 0.50,
    "low_confusion": 0.30,
    "session_continuity": 0.20,
}
```

### Flow Detection

```python
FLOW_THRESHOLD = 0.70
FLOW_EXIT_THRESHOLD = 0.40
FLOW_MIN_DURATION_SECS = 120
```

### Class: `EngagementScorer`

```python
class EngagementScorer:
    def reset(self) -> None
    def record_telemetry(self, summary: dict) -> None
    def get_scores(self) -> dict         # {engagement, confusion, flow}
    def get_trend(self) -> str           # "improving" | "stable" | "declining"
    def is_in_flow(self) -> bool
    def check_flow_milestone(self) -> int | None  # 30, 60, or 90 minutes
```

One instance per `WebSocketSession`.

### Integration in `ws_handler.py`

1. Handle `telemetry_update` message type → `scorer.record_telemetry(summary)`
2. In nudge handler: if `scorer.is_in_flow()`, suppress nudges (except explicit user requests)
3. Pass `scorer.get_scores()` to hint policy for confusion-aware escalation (ticket 66)
4. On flow milestone, optionally emit ambient notification (not a chat interruption)

### `frontend/modules/constants.js`

Add `MSG_TELEMETRY_UPDATE = "telemetry_update"`.

## Acceptance Criteria

- [ ] Four new frontend modules: keystroke, mouse, attention, aggregator
- [ ] All follow dependency injection pattern (`configure*Deps`)
- [ ] Telemetry summaries sent every 30 seconds via WebSocket
- [ ] No raw keystroke data transmitted (privacy-first)
- [ ] `EngagementScorer` in new `backend/engagement_scorer.py`
- [ ] Three scores (engagement, confusion, flow) computed as 0.0–1.0
- [ ] Flow detection: enter at 0.70 for 120s, exit at 0.40
- [ ] Nudges suppressed during flow state
- [ ] All weights and thresholds are named constants
- [ ] Tests for scorer in new `tests/test_engagement_scorer.py`
- [ ] Existing tests pass
