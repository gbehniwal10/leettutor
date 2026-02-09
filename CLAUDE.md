# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the app (localhost:8000, hot-reload)
python run.py

# Run all tests (98 tests)
pytest

# Run a single test file
pytest tests/test_executor.py -v

# Run a single test
pytest tests/test_executor.py::test_basic_execution -xvs

# Install dependencies
pip install -r requirements.txt
```

## Tickets

Work items are tracked as Markdown files in `tickets/` (not GitHub Issues). To see the latest ticket, check the highest-numbered file in that directory. Completed tickets are moved to `tickets/completed/`.

## Architecture

LeetCode Tutor is an interactive browser-based practice app with an AI tutor powered by Claude Code SDK. It uses the Socratic method — progressive hints, never direct solutions.

### Three Modes
- **Learning**: Relaxed practice with 5-level hint ladder
- **Interview**: Timed 45min mock interview with phases (clarification → coding → review)
- **Pattern Quiz**: Identify algorithmic patterns (no code editor, no Claude chat)

### Backend (Python/FastAPI)

**Request flow**: Browser → WebSocket `/ws/chat` → `ws_handler.py:WebSocketSession` → `tutor.py:LeetCodeTutor` → Claude Code SDK subprocess

- `server.py` — FastAPI app, REST endpoints, CORS, static file mount
- `ws_handler.py` — `WebSocketSession` class: per-connection state, message routing, nudge system
- `tutor.py` — `LeetCodeTutor`: wraps Claude SDK client, system prompts per mode, streaming `chat()` async generator
- `executor.py` — Sandboxed Python code execution (subprocess with 512MB RAM, 10s CPU limit, process group isolation)
- `auth.py` — Token management (`secrets.token_hex`), rate limiting, `hmac.compare_digest`
- `problems.py` — Loads problem JSON files from `backend/problems/` at startup
- `session_logger.py` — Atomic JSON writes (tempfile + `os.replace`) for session persistence
- `tutor_registry.py` — Parks/reclaims tutor sessions on disconnect (5min TTL, max 5 parked)
- `pattern_explain.py` — Reusable Claude SDK client pool for pattern quiz explanations

**WebSocket protocol**: All messages are `{"type": "...", ...}`. Client types: `start_session`, `message`, `request_hint`, `resume_session`, `end_session`, `time_update`, `time_up`. Server types: `session_started`, `assistant_chunk`, `assistant_message`, `error`.

**Code execution security**: `executor.py` validates `function_call` expressions (rejects `__`, `import`, `eval`), uses `start_new_session=True` for process group isolation, strips sensitive env vars, and applies platform-specific memory limits (macOS: `RLIMIT_RSS`, Linux: `RLIMIT_AS`).

### Frontend (Vanilla JS, no build step)

- `app.js` — Thin orchestrator that imports and wires all 23 ES modules
- `modules/` — All use **dependency injection** via `configure*Deps(deps)` functions to avoid circular imports
- State: mutable `state` object in `modules/state.js`; cross-module events via `modules/event-bus.js`
- Editor: Monaco Editor loaded from CDN
- Streaming: `assistant_chunk` messages accumulate, final `assistant_message` completes the response

### Data

- Problems: 138 JSON files in `backend/problems/` (schema: id, title, difficulty, tags, description, starter_code, function_name, test_cases, hidden_test_cases, hints, optional helpers)
- Sessions: JSON files in `sessions/` (gitignored)
- Workspaces: per-session dirs in `workspace/` with `solution.py` and `test_results.json` (tutor reads these via Claude SDK's Read tool)

### Problem Import Pipeline

Problems are sourced from the HuggingFace `newfacade/LeetCodeDataset` dataset, filtered to the NeetCode 150 list, and converted to our JSON schema via two scripts in `scripts/`:

```bash
# Step 1: Import from dataset (requires `pip install datasets`)
python scripts/import_problems.py

# Step 2: Clean up descriptions for markdown rendering
python scripts/clean_descriptions.py
```

**`import_problems.py`** handles: extracting functions from `class Solution` format, removing `self` parameter, dedenting from class scope, detecting data structure types (tree/linked-list) to set the `helpers` field, building `function_call` expressions with appropriate conversions (e.g. `tree_node()`, `list_node_to_list()`), splitting test cases into visible (first 3) and hidden (rest, capped at 20), and modernizing type hints to Python 3.10+ builtins.

**`clean_descriptions.py`** handles: normalizing whitespace, formatting example blocks as markdown code fences, bolding headers, and formatting constraints as bullet lists.

**Key conventions enforced by the import script:**
- `starter_code` uses standalone functions (not `class Solution` methods)
- Type hints use lowercase builtins: `list[int]` not `List[int]`, `TreeNode | None` not `Optional[TreeNode]`
- Tree/linked-list problems include the commented class definition above the function and set `"helpers": ["data_structures"]`
- The script skips problems that already exist on disk — delete a JSON file to force re-import

**After import, these fields are filled in manually:** `hints`, `optimal_complexity`

## Testing

- pytest with `asyncio_mode = auto` — all tests are async-first
- `claude_code_sdk` is stubbed in `conftest.py` so tests run without the SDK installed
- Test client: `httpx.AsyncClient` with `ASGITransport` for REST endpoints
- Fixtures: `sample_problem` (minimal problem dict), `temp_dir` (with sessions/ and workspace/ subdirs), `auth_token` (generates and cleans up), `app` (patched FastAPI app with mocked TutorRegistry/problems)

## Key Conventions

- Backend async-first: all I/O operations use `async`/`await`
- Frontend modules export `configure*Deps()` — always wire dependencies in `app.js` before use
- Session resume: TutorRegistry (seamless, 5min) → disk session with `start_session_with_resume(claude_session_id)` → fallback `replay_history()`
- Environment: `LEETTUTOR_PASSWORD` enables auth, `LEETTUTOR_HOST`/`LEETTUTOR_PORT` for bind address, `LEETTUTOR_CORS_ORIGINS` for CORS

## Rules (from past audit lessons)

### File size discipline
- Backend files: max ~300 lines. If a file grows beyond that, extract a module.
- Frontend modules: max ~250 lines. `app.js` is an orchestrator only (~200 lines) — logic belongs in `modules/`.
- CSS: use CSS custom properties for all colors/spacing; never hardcode hex values or magic numbers.
- When adding a new feature, create a new module file rather than appending to an existing one.

### Sandbox security (executor.py)
- Defense in depth: every resource limit matters. Always set `RLIMIT_NPROC` (fork bomb protection), memory limits, and CPU time limits together.
- Use 256-bit (`token_hex(32)`) markers for subprocess result delimiters — shorter markers risk accidental collision with user output.
- Validate subprocess is still running (`proc.returncode is None`) before sending signals to avoid PID reuse races.
- Input validation must block all indirect access patterns (e.g. `globals()["__builtins__"]`), not just direct `__` in the top-level expression.

### Security defaults
- Always use `hmac.compare_digest()` for any secret/token comparison — never `==`.
- File uploads: validate internal structure (e.g. PNG chunk parsing), not just magic bytes. Always sanitize filenames and prevent path traversal.
- CORS: explicitly list allowed methods and headers; never use `["*"]` in production.

### No monkey-patching
- Never override or wrap functions by reassigning them at runtime. Use the event bus (`modules/event-bus.js`) to extend behavior — emit events that other modules subscribe to.

### State and constants
- Frontend global state lives in `modules/state.js` only. Modules receive what they need via dependency injection, not by declaring file-level `let` variables for shared state.
- WebSocket message types, mode names, and other protocol strings must be defined in `modules/constants.js` (frontend) and as module-level constants in the backend — never as inline string literals.
- Thresholds (debounce timings, TTLs, rate limits) should be named constants at the top of the file that uses them, not buried in function bodies.

### SDK usage (claude-code-sdk)
- Never access private/underscore attributes on the SDK objects (e.g. `client._query`, `transport._process`). These break silently on version bumps. Only use the SDK's documented public methods and properties.
- Pin the SDK version in `requirements.txt` to a specific minor range.

### Error handling
- REST endpoints: raise `HTTPException` with appropriate status codes.
- WebSocket: send `{"type": "error", "code": "<ERROR_CODE>", "content": "..."}` — always include a machine-readable `code` field.
- Frontend: catch errors at the boundary (WebSocket `onmessage`, fetch calls) and display via `addChatMessage('system', ...)`. Never silently swallow errors.

### Testing
- Any change to `executor.py` (sandbox) must include or update tests in `test_executor.py`.
- Any new REST endpoint needs a corresponding test in `test_rest_api.py`.
- Any new WebSocket message type needs a test in `test_ws_protocol.py`.
