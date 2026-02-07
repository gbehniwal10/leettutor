# Codebase Audit Report

*Date: 2026-02-06*

## Audit Results: Consolidated Findings

### CRITICAL / HIGH — Fix Now

| # | Issue | Where | Details |
|---|-------|-------|---------|
| 1 | **TutorRegistry dict mutation without lock** | `tutor_registry.py` | `_parked` dict is read/written from WebSocket handlers AND the background cleanup loop concurrently. Dict mutation during iteration can cause KeyError or skipped entries. |
| 2 | **ProblemHistory has no concurrency protection** | `problem_history.py` | `record_attempt()` and `record_solve()` use read-modify-write on shared dict + file with no lock. Concurrent calls lose updates. |
| 3 | **Cleanup loop can die silently** | `tutor_registry.py:78-90` | `_cleanup_loop()` has no try/except around `await self._kill()`. One exception kills the entire loop — parked tutors never expire again. |
| 4 | **`asyncio.ensure_future` fire-and-forget** | `tutor_registry.py:43,55` | Eviction and expired-reclaim kills are fire-and-forget. If they fail, subprocess + file handle leaks with no logging. |
| 5 | **Missing `.ok` checks on fetch responses** | `app.js:630,772,783,951,1318,1373` | 6 fetch calls parse `.json()` without checking `response.ok`. A 500 response with JSON body is treated as success. |
| 6 | **Blocking sync I/O in async handlers** | `session_logger.py`, `problem_history.py` | Every `_save()`, `log_message()`, `list_sessions()`, `get_session()` does synchronous `json.load`/`json.dump` + file I/O, blocking the event loop for all connections. |
| 7 | **Interleaved chat responses** | `server.py:478-505` | Two rapid user messages both enter `tutor.chat()` concurrently — streamed chunks arrive interleaved, producing garbled output. |

### MEDIUM — Should Fix

| # | Issue | Where | Details |
|---|-------|-------|---------|
| 8 | **Incomplete stderr sanitization** | `executor.py:419` | Only strips `/tmp/` and `/var/` paths. `/Users/` (macOS) and `/home/` (Linux) paths leak in error output. |
| 9 | **WebSocket reconnect timeout accumulation** | `app.js:515-533` | On close, a `setTimeout` schedules reconnect. Rapid close/open cycles can stack up multiple pending reconnects. |
| 10 | **`end_session` and `time_update` WS handlers unprotected** | `server.py:507-511,741-747` | These message types have no try/except. An exception in `tutor.end_session()` crashes the entire WebSocket connection. |
| 11 | **Finally block in WS handler not robust** | `server.py:759-792` | If `tutor.end_session()` throws in the finally block, `session_logger.end_session()` and workspace cleanup are skipped. |
| 12 | **DOMPurify not verified before use** | `app.js:439-445` | `renderMarkdown()` calls `DOMPurify.sanitize()` without checking it loaded. CDN failure -> crash or XSS fallback. |
| 13 | **`state.resuming` can get stuck** | `app.js:929-934` | If WebSocket message is lost during resume, `state.resuming` stays true forever — user can't start any session. |
| 14 | **Hardcoded `#e74c3c` in HTML** | `index.html:152` | Login error text uses hardcoded red instead of `var(--error)` — breaks theming. |
| 15 | **6 inline styles in HTML** | `index.html:140,148-153` | Login modal styling is all inline instead of in CSS classes. |
| 16 | **No mobile/responsive breakpoints** | `style.css` | Modals have `min-width: 400-500px`, no `@media` queries. Broken on small screens. |
| 17 | **RLIMIT_AS ineffective on macOS** | `executor.py:170` | macOS often ignores `RLIMIT_AS`. User code could exhaust memory. |

### LOW — Nice to Have

| # | Issue | Where | Details |
|---|-------|-------|---------|
| 18 | Tokens never expire, no rate limiting on `/api/login` | `server.py:40-68` | Local-only app, but tokens accumulate in memory forever. |
| 19 | `force_kill()` relies on private SDK attributes | `tutor.py:341-375` | `_query._closed`, `_transport._process` — fragile if SDK updates. |
| 20 | Hint count logged before hint is generated | `server.py:536` | If hint generation fails, count is already incremented. |
| 21 | 10+ icon-only buttons missing `aria-label` | `index.html` | Settings gear, TTS, toggle, expand buttons etc. |
| 22 | No focus trap in modals | `index.html` | Tab key can escape modal dialogs. |
| 23 | Z-index collisions | `style.css` | streak-popover and resume-dialog both at 1100. |
| 24 | Animations don't respect `prefers-reduced-motion` | `style.css` | `.mf-shake`, `.confetti-particle`, `.tts-btn.playing` always animate. |
| 25 | `PYTHONPATH` preserved in sandbox env | `executor.py:471` | Could point to directories with malicious modules. |
| 26 | MutationObservers never disconnected | `app.js:2561,3102` | TTS and earcons observers run indefinitely. |

### Already Good (No Action Needed)

- Session ID path traversal: properly guarded by regex + `is_relative_to()`
- All 138 problem JSON files valid with required fields
- Frontend-backend WebSocket contract matches perfectly
- `escapeHtml()` used consistently for DOM insertions
- Code size limits enforced, temp files cleaned in finally blocks
- Parked tutor reclaim is atomic (dict.pop)
