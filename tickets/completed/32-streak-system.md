# Ticket 32: Streak System with Freeze / Recovery

**Priority:** Medium
**Component:** `frontend/app.js`, `frontend/style.css`
**Estimated Scope:** Small-Medium
**Depends on:** Ticket 21 (Settings Panel — for streak display preferences)

## Overview

Add a daily practice streak tracker with a forgiving "freeze" mechanic. Streaks are powerful motivators but psychologically devastating when broken. The research specifically warns against punitive streak-breaking and recommends a recovery system to prevent the "What the Hell Effect" — where a user quits entirely after losing their streak.

## Research Context

Section 3.2.2 of the cognitive ergonomics report describes how streaks are "powerful motivators but can be psychologically devastating when broken due to executive dysfunction." The key recommendation is a **Streak Freeze** — if a student misses a day, they don't lose the streak immediately. A **recovery mechanic** (e.g., "Complete two problems today to repair your streak") reframes failure as a new challenge, maintaining engagement.

## Data Model

### localStorage Schema
```javascript
// Key: "leettutor_streak"
{
    "currentStreak": 7,         // consecutive active days
    "longestStreak": 14,        // all-time best
    "lastActiveDate": "2026-02-05",  // ISO date string
    "freezesAvailable": 1,      // max 2, earn 1 per 7-day streak
    "freezeUsedToday": false,   // auto-used if missed yesterday
    "streakHistory": [          // last 30 days for calendar visualization
        { "date": "2026-02-05", "type": "active" },    // completed a problem
        { "date": "2026-02-04", "type": "active" },
        { "date": "2026-02-03", "type": "freeze" },    // freeze auto-used
        { "date": "2026-02-02", "type": "active" },
        // ...
    ],
    "repairAvailable": false,   // true if streak just broke, can be repaired today
    "repairTarget": 2           // problems to solve to repair
}
```

### Streak Logic

**On page load / session start:**
1. Check `lastActiveDate` against today
2. If today → already active, no action
3. If yesterday → streak continues, waiting for today's activity
4. If 2 days ago:
   - If `freezesAvailable > 0` → auto-use freeze for the missed day, streak continues
   - Else → streak breaks; set `repairAvailable = true`, `repairTarget = 2`
5. If 3+ days ago → streak breaks, no repair available

**On problem completion (accepted via `/api/submit`):**
- If `lastActiveDate` is not today: increment `currentStreak`, update `lastActiveDate`, add to history
- If `repairAvailable` and user solves `repairTarget` problems today: restore streak, clear repair state
- Every 7 consecutive days: earn 1 freeze (max 2 stored)

### Freeze Mechanics
- Freezes are earned: 1 freeze per 7-day streak milestone (at day 7, 14, 21, etc.)
- Maximum 2 freezes stored at any time
- Freezes are auto-used (user doesn't need to manually activate)
- A freeze covers exactly 1 missed day

### Recovery Mechanics
- When a streak breaks (no freeze available), the user has **that day only** to repair
- Repair requires solving 2 problems (accepted submissions)
- If repaired: streak continues as if never broken
- If not repaired by end of day: streak resets to 0

## UI Design

### Streak Display
Small, non-intrusive display in the header:

```
🔥 7 day streak  ❄️ 1
```

- Fire icon + streak count
- Snowflake icon + freeze count (only shown if > 0)
- Clicking opens a streak detail popover

### Streak Detail Popover
Shows:
- Current streak + longest streak
- 30-day calendar grid (mini heatmap):
  - Green: active day
  - Blue: freeze used
  - Grey: no activity
  - Red outline on today if repair available
- Freeze count with explanation tooltip
- Repair status if applicable: "Solve 1 more problem today to save your streak!"

### Repair Banner
If repair is available, show a non-dismissible but gentle banner at the top:
```
Your streak paused — solve 2 problems today to pick it back up! (1/2 done)
```

### Streak Milestone Toast
When hitting 7, 14, 30, 50, 100 day milestones:
- Brief toast notification: "🔥 14-day streak! You earned a streak freeze."
- Respects reduced motion setting

## Implementation Steps

1. **Create `StreakManager` class** — encapsulates all streak logic, reads/writes localStorage
2. **Implement streak calculation** — on-load check, active day recording, freeze auto-use
3. **Implement recovery mechanic** — track daily solves, repair when threshold met
4. **Build streak display** — header badge with fire icon + count
5. **Build streak detail popover** — calendar grid, stats, freeze/repair info
6. **Add repair banner** — conditional display when repair is available
7. **Add milestone toasts** — at 7, 14, 30, 50, 100 days
8. **Wire to submit endpoint** — update streak on accepted submission

## Acceptance Criteria

- [ ] Streak counter visible in header showing current consecutive day count
- [ ] Streak increments when a problem is solved (accepted) on a new day
- [ ] Missing one day with a freeze available auto-uses the freeze (streak continues)
- [ ] Missing one day with no freeze triggers repair mode
- [ ] Solving 2 problems on the repair day restores the streak
- [ ] Missing 2+ days with no freeze resets streak to 0
- [ ] Freezes are earned at 7-day milestones (max 2 stored)
- [ ] 30-day calendar shows activity history with color coding
- [ ] Streak data persists in localStorage across sessions
- [ ] Milestone toasts fire at 7, 14, 30, 50, 100 days
- [ ] Entire streak UI can be hidden via settings (for users who find it stressful)
