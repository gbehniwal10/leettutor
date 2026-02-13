# LeetCode Tutor — Architecture Overview

## Stack
- **Backend**: Python/FastAPI + uvicorn (hot reload)
- **Frontend**: Vanilla HTML/CSS/JS, Monaco Editor (CDN), no build step
- **AI**: Claude Code SDK subprocess per session
- **Data**: JSON files (problems, sessions, solutions — no database)

## Request Flow
```
Browser ──HTTP──► FastAPI (REST)
   │                 ├─ POST /api/run      → executor.py (sandbox subprocess)
   │                 ├─ POST /api/submit   → executor.py + solution_store.py
   │                 ├─ GET  /api/problems → problems.py (loaded at startup)
   │                 └─ GET  /api/solutions/* → solution_store.py
   │
   └──WebSocket──► ws_handler.py (WebSocketSession per connection)
                      │
                      ├─ start_session → tutor.py (LeetCodeTutor)
                      │                    └─ spawns Claude SDK subprocess
                      ├─ message/hint  → tutor.chat() async generator
                      │                    └─ streams assistant_chunk → assistant_message
                      ├─ test_results_update → auto_congratulate on solve
                      │                       └─ classify_approach (async)
                      └─ disconnect → TutorRegistry parks session (5min TTL)
```

## Three Modes
1. **Learning** — relaxed practice, 5-level hint ladder, nudge system for inactivity
2. **Interview** — 45min timer, phases: clarification → coding → review
3. **Pattern Quiz** — identify algorithmic patterns, no editor/chat, separate explain pool

## Frontend Module System
23 ES modules in `frontend/modules/`, wired via dependency injection (`configure*Deps()`) in `app.js`. Cross-module communication uses an event bus — no direct inter-module imports for runtime behavior.

## Code Execution (executor.py)
Sandboxed subprocess: 512MB RAM, 10s CPU, process group isolation (`start_new_session`), restricted env vars, result extracted via 256-bit marker in stderr.

## Data Persistence
- **Problems**: 138 JSON files in `backend/problems/` (imported from HuggingFace dataset)
- **Sessions**: JSON in `sessions/` (atomic writes via tempfile + `os.replace`)
- **Solutions**: JSON in `solutions/` per problem, deduped by code hash, approach-tagged
- **Progress**: localStorage on the frontend (solved/attempted per problem)
- **Workspaces**: per-session dirs in `workspace/` with `solution.py` + `test_results.json` (tutor reads these)

## Session Resume
1. **Seamless**: TutorRegistry has parked tutor (5min window) → instant reclaim
2. **Cold**: Load session from disk → `start_session_with_resume(claude_session_id)` → fallback `replay_history()`

## Auth
Optional — enabled by setting `LEETTUTOR_PASSWORD` env var. Token-based via `POST /api/login`, rate-limited, `hmac.compare_digest` for comparisons.
