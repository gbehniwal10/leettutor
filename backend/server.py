import sys
if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import asyncio
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request
from pydantic import BaseModel, Field
import json
import os
import secrets
import time
from pathlib import Path
from collections import defaultdict
import logging
import shutil

from .problems import list_problems, get_problem, PROBLEMS
from .executor import CodeExecutor
from .session_logger import SessionLogger, _is_valid_session_id
from .tutor import LeetCodeTutor, build_nudge_message
from .tutor_registry import TutorRegistry, ParkedTutor
from .problem_history import ProblemHistory

logger = logging.getLogger(__name__)

app = FastAPI()

# --- Authentication ---

LEETTUTOR_PASSWORD = os.environ.get("LEETTUTOR_PASSWORD")
AUTH_ENABLED = LEETTUTOR_PASSWORD is not None and LEETTUTOR_PASSWORD != ""

# Token storage: token -> creation timestamp (seconds since epoch)
_valid_tokens: dict[str, float] = {}
TOKEN_TTL_SECONDS = int(os.environ.get("LEETTUTOR_TOKEN_TTL", str(24 * 60 * 60)))

# Login rate limiting: IP -> list of attempt timestamps
_login_attempts: dict[str, list[float]] = defaultdict(list)
_LOGIN_RATE_LIMIT = 5        # max attempts
_LOGIN_RATE_WINDOW = 60.0    # per this many seconds


def _generate_token() -> str:
    token = secrets.token_hex(32)
    _valid_tokens[token] = time.monotonic()
    return token


def _prune_expired_tokens() -> None:
    """Remove tokens older than TOKEN_TTL_SECONDS. Called lazily on each validation."""
    now = time.monotonic()
    expired = [t for t, created_at in _valid_tokens.items()
               if now - created_at > TOKEN_TTL_SECONDS]
    for t in expired:
        del _valid_tokens[t]


def _verify_token(token: str | None) -> bool:
    if not AUTH_ENABLED:
        return True
    if token is None or token not in _valid_tokens:
        return False
    _prune_expired_tokens()
    # Re-check after pruning (token may have just been pruned)
    return token in _valid_tokens


def _check_login_rate_limit(client_ip: str) -> None:
    """Raise 429 if the IP has exceeded the login rate limit."""
    now = time.monotonic()
    attempts = _login_attempts[client_ip]
    # Remove attempts outside the current window
    cutoff = now - _LOGIN_RATE_WINDOW
    _login_attempts[client_ip] = [t for t in attempts if t > cutoff]
    if len(_login_attempts[client_ip]) >= _LOGIN_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")
    _login_attempts[client_ip].append(now)


class LoginRequest(BaseModel):
    password: str


@app.get("/api/auth/status")
async def auth_status():
    return {"auth_required": AUTH_ENABLED}


@app.post("/api/login")
async def api_login(req: LoginRequest, request: Request):
    if not AUTH_ENABLED:
        return {"token": "no-auth", "message": "Authentication is disabled."}
    client_ip = request.client.host if request.client else "unknown"
    _check_login_rate_limit(client_ip)
    if req.password != LEETTUTOR_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    token = _generate_token()
    return {"token": token}


def _get_token_from_request(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


async def require_auth(request: Request):
    """Dependency that enforces authentication on protected endpoints."""
    if not AUTH_ENABLED:
        return
    token = _get_token_from_request(request)
    if not _verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

# --- CORS Configuration ---

def _get_cors_origins() -> list[str]:
    """Get CORS origins from environment variable or use default."""
    cors_origins_str = os.environ.get("LEETTUTOR_CORS_ORIGINS", "http://localhost:8000")
    # Split by comma and strip whitespace
    origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]
    return origins if origins else ["http://localhost:8000"]


_cors_origins = _get_cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
WORKSPACE_DIR = BASE_DIR / "workspace"
SESSIONS_DIR = str(BASE_DIR / "sessions")

executor = CodeExecutor()
tutor_registry = TutorRegistry()
_problem_history = ProblemHistory(BASE_DIR / "problem_history.json")

# Read-only SessionLogger for API endpoints (list/get sessions).
# Per-connection loggers are created inside the WebSocket handler.
_api_session_logger = SessionLogger(sessions_dir=SESSIONS_DIR)

# Static files
DIST_DIR = FRONTEND_DIR / "dist"
_has_dist = DIST_DIR.is_dir() and (DIST_DIR / ".vite" / "manifest.json").exists()

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

if _has_dist:
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")


def _get_excalidraw_tags() -> tuple[str, str]:
    """Read the Vite manifest to get the built excalidraw entry point and CSS."""
    if not _has_dist:
        return "", ""
    try:
        manifest_path = DIST_DIR / ".vite" / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        entry = manifest.get("src/excalidraw-island.jsx", {})
        js_file = entry.get("file")
        css_files = entry.get("css", [])
        script_tag = ""
        css_tags = ""
        if js_file:
            script_tag = f'<script type="module" src="/assets/{js_file.split("assets/")[-1]}"></script>'
        for css_file in css_files:
            css_tags += f'<link rel="stylesheet" href="/assets/{css_file.split("assets/")[-1]}">'
        return script_tag, css_tags
    except Exception:
        logger.warning("Failed to read Vite manifest for excalidraw tags")
    return "", ""


_excalidraw_script_tag, _excalidraw_css_tags = _get_excalidraw_tags()


@app.get("/")
async def index():
    from starlette.responses import HTMLResponse
    html_path = FRONTEND_DIR / "index.html"
    html = html_path.read_text()
    if _has_dist and _excalidraw_script_tag:
        # Replace the dev-mode script tag with the production one
        html = html.replace(
            '<script type="module" src="/src/excalidraw-island.jsx"></script>',
            _excalidraw_script_tag,
        )
        # Inject CSS before closing </head>
        if _excalidraw_css_tags:
            html = html.replace('</head>', _excalidraw_css_tags + '</head>')
    return HTMLResponse(html)


# --- API Routes ---

@app.get("/api/problems")
async def api_list_problems():
    problems = list_problems()
    history = await _problem_history.get_all()
    for p in problems:
        entry = history.get(p["id"])
        if entry:
            p["status"] = entry.get("status", "unsolved")
            p["last_solved_at"] = entry.get("last_solved_at")
            p["solve_count"] = entry.get("solve_count", 0)
        else:
            p["status"] = "unsolved"
    return problems


@app.get("/api/problem-history")
async def api_problem_history():
    return await _problem_history.get_all()


@app.get("/api/problems/{problem_id}")
async def api_get_problem(problem_id: str):
    problem = get_problem(problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")
    return {k: v for k, v in problem.items() if k != "hidden_test_cases"}


class RunRequest(BaseModel):
    code: str = Field(..., max_length=51200)
    problem_id: str = Field(..., max_length=100)


class _PatternExplainPool:
    """Reuses a single Claude Code SDK client across pattern-explain requests."""

    def __init__(self):
        self._client: "ClaudeSDKClient | None" = None
        self._lock = asyncio.Lock()
        self._request_count = 0
        self._max_requests = 20  # reconnect after N requests to stay fresh

    async def _get_client(self):
        if self._client and self._request_count < self._max_requests:
            return self._client
        # Tear down old client if cycling
        if self._client:
            try:
                await self._client.disconnect()
            except Exception:
                pass
            self._client = None
            self._request_count = 0
        from .tutor import ClaudeSDKClient, ClaudeCodeOptions
        client = ClaudeSDKClient(ClaudeCodeOptions(
            system_prompt=(
                "You explain algorithmic patterns in EXACTLY 2-3 short sentences. "
                "Never exceed 3 sentences. No emojis. No code. No hints about implementation. "
                "Use markdown: **bold** for pattern names, *italics* for emphasis."
            ),
            allowed_tools=[],
            max_turns=1,
        ))
        await asyncio.wait_for(client.connect(), timeout=15)
        self._client = client
        self._request_count = 0
        return client

    async def query(self, prompt: str) -> str:
        from .tutor import AssistantMessage, TextBlock
        async with self._lock:
            try:
                client = await self._get_client()
                await client.query(prompt)
                explanation = ""
                async for msg in client.receive_response():
                    if isinstance(msg, AssistantMessage):
                        for block in msg.content:
                            if isinstance(block, TextBlock):
                                explanation += block.text
                self._request_count += 1
                return explanation
            except Exception:
                # Force reconnect on next call
                if self._client:
                    try:
                        await self._client.disconnect()
                    except Exception:
                        pass
                    self._client = None
                    self._request_count = 0
                raise

    async def shutdown(self):
        if self._client:
            try:
                await self._client.disconnect()
            except Exception:
                pass
            self._client = None


_pattern_explain_pool = _PatternExplainPool()


@app.on_event("startup")
async def startup_event():
    tutor_registry.start()


@app.on_event("shutdown")
async def shutdown_event():
    await tutor_registry.stop()
    await _pattern_explain_pool.shutdown()


class PatternExplainRequest(BaseModel):
    problem_id: str = Field(..., max_length=100)
    guessed_pattern: str = Field(..., max_length=100)
    correct_pattern: str = Field(..., max_length=100)
    was_correct: bool


# NOTE: /api/run and /api/submit are REST endpoints and do not have access to the
# per-connection WebSocket session_logger. To log code submissions, the frontend
# would need to relay results back over the WebSocket, or we would need a shared
# session registry keyed by session ID. For now, code_submissions are not logged here.

@app.post("/api/run", dependencies=[Depends(require_auth)])
async def api_run(req: RunRequest):
    problem = get_problem(req.problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")
    helpers = problem.get("helpers")
    results = await executor.run_tests(req.code, problem["test_cases"], helpers=helpers)
    return results


@app.post("/api/submit", dependencies=[Depends(require_auth)])
async def api_submit(req: RunRequest):
    problem = get_problem(req.problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")
    all_tests = problem["test_cases"] + problem.get("hidden_test_cases", [])
    helpers = problem.get("helpers")
    results = await executor.run_tests(req.code, all_tests, helpers=helpers)
    if results.get("failed") == 0:
        await _problem_history.record_solve(req.problem_id)
    return results


_MAX_WHITEBOARD_SIZE = 5 * 1024 * 1024  # 5 MB
_PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


@app.post("/api/whiteboard-image", dependencies=[Depends(require_auth)])
async def api_whiteboard_image(
    image: UploadFile = File(...),
    session_id: str = Form(...),
):
    if not _is_valid_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id")
    workspace = WORKSPACE_DIR / session_id
    if not workspace.is_dir():
        raise HTTPException(status_code=404, detail="Session workspace not found")
    data = await image.read()
    if len(data) > _MAX_WHITEBOARD_SIZE:
        raise HTTPException(status_code=413, detail="Image too large (max 5MB)")
    if not data[:8].startswith(_PNG_MAGIC):
        raise HTTPException(status_code=400, detail="Invalid image format (PNG required)")
    dest = workspace / "whiteboard.png"
    dest.write_bytes(data)
    return {"ok": True, "path": str(dest)}


_MAX_WHITEBOARD_STATE_SIZE = 2 * 1024 * 1024  # 2 MB


class WhiteboardStateRequest(BaseModel):
    whiteboard_state: dict | None = None


@app.put("/api/sessions/{session_id}/whiteboard-state", dependencies=[Depends(require_auth)])
async def api_save_whiteboard_state(session_id: str, req: WhiteboardStateRequest):
    if not _is_valid_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id")
    serialized = json.dumps(req.whiteboard_state) if req.whiteboard_state else ""
    if len(serialized) > _MAX_WHITEBOARD_STATE_SIZE:
        raise HTTPException(status_code=413, detail="Whiteboard state too large (max 2MB)")
    updated = await _api_session_logger.patch_session(
        session_id, whiteboard_state=req.whiteboard_state
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


@app.post("/api/pattern-explain", dependencies=[Depends(require_auth)])
async def api_pattern_explain(req: PatternExplainRequest):
    problem = get_problem(req.problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")

    if req.was_correct:
        prompt = (
            f'Problem: "{problem["title"]}"\n'
            f'Correct pattern: {req.correct_pattern}\n\n'
            f'Explain in exactly 2-3 sentences why this pattern fits. No code, no implementation hints.'
        )
    else:
        prompt = (
            f'Problem: "{problem["title"]}"\n'
            f'User guessed: {req.guessed_pattern}\n'
            f'Correct pattern: {req.correct_pattern}\n\n'
            f'Explain in exactly 2-3 sentences why their guess is wrong and why the correct pattern fits. '
            f'No code, no implementation hints.'
        )

    try:
        explanation = await _pattern_explain_pool.query(prompt)
        return {"explanation": explanation}
    except Exception as e:
        logger.exception("Pattern explain failed")
        raise HTTPException(status_code=500, detail="Failed to generate explanation")


@app.get("/api/sessions", dependencies=[Depends(require_auth)])
async def api_list_sessions():
    return await _api_session_logger.list_sessions()


@app.get("/api/sessions/latest-resumable", dependencies=[Depends(require_auth)])
async def api_latest_resumable_session(problem_id: str):
    result = await _api_session_logger.find_latest_resumable_session(problem_id)
    if result is None:
        return None
    result["tutor_alive"] = await tutor_registry.is_alive(result["session_id"])
    return result


@app.get("/api/sessions/{session_id}", dependencies=[Depends(require_auth)])
async def api_get_session(session_id: str):
    if not _is_valid_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session ID format")
    session = await _api_session_logger.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/api/sessions/{session_id}", dependencies=[Depends(require_auth)])
async def api_delete_session(session_id: str):
    if not _is_valid_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session ID format")
    deleted = await _api_session_logger.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True}


@app.get("/api/sessions/{session_id}/status", dependencies=[Depends(require_auth)])
async def api_session_status(session_id: str):
    if not _is_valid_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session ID format")
    session = await _api_session_logger.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    alive = await tutor_registry.is_alive(session_id)
    mode = session.get("mode")
    resumable = mode != "pattern-quiz" and (alive or session.get("claude_session_id") is not None or len(session.get("chat_history", [])) > 0)
    return {
        "tutor_alive": alive,
        "resumable": resumable,
        "mode": mode,
        "problem_id": session.get("problem_id"),
    }


# --- WebSocket with Claude Tutor ---

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()

    # Wait for first message: must be auth
    try:
        first_raw = await websocket.receive_text()
        first_msg = json.loads(first_raw)
    except (json.JSONDecodeError, ValueError, WebSocketDisconnect):
        await websocket.close(code=4001, reason="Unauthorized")
        return

    if AUTH_ENABLED:
        if first_msg.get("type") != "auth" or not _verify_token(first_msg.get("token")):
            await websocket.close(code=4001, reason="Unauthorized")
            return

    tutor: LeetCodeTutor | None = None
    session_logger = SessionLogger(sessions_dir=SESSIONS_DIR)
    connection_workspace: Path | None = None
    current_session_id: str | None = None
    _last_editor_code: str | None = None
    _ws_alive = True
    _chat_lock = asyncio.Lock()  # Serializes streaming responses to prevent interleaving
    _last_real_activity: float = time.time()  # tracks real user actions for nudge gating
    _NUDGE_ABANDON_SECS = 30 * 60  # stop nudging after 30 min of no real user activity

    async def safe_send(data: dict) -> bool:
        """Send JSON, return False if client disconnected."""
        nonlocal _ws_alive
        if not _ws_alive:
            return False
        try:
            await websocket.send_json(data)
            return True
        except (WebSocketDisconnect, RuntimeError):
            _ws_alive = False
            return False

    try:
        while True:
            data = await websocket.receive_text()

            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning("Malformed JSON from client: %s", e)
                await websocket.send_json({"type": "error", "content": "Invalid message format."})
                continue

            msg_type = msg.get("type")
            if not msg_type:
                await websocket.send_json({"type": "error", "content": "Missing message type."})
                continue

            # Track real user activity (everything except nudge_request)
            if msg_type != "nudge_request":
                _last_real_activity = time.time()

            try:
                if msg_type == "start_session":
                    problem_id = msg.get("problem_id")
                    mode = msg.get("mode")
                    if not problem_id or not mode:
                        await websocket.send_json({"type": "error", "content": "Missing required fields for start_session."})
                        continue

                    # Clean up previous tutor session
                    if tutor:
                        await tutor.end_session()
                        await session_logger.end_session()

                    problem = get_problem(problem_id)
                    if not problem:
                        await websocket.send_json({"type": "error", "content": "Problem not found"})
                        continue

                    sid = await session_logger.start_session(problem_id, mode)
                    current_session_id = sid
                    _last_editor_code = None
                    if mode != "pattern-quiz":
                        await _problem_history.record_attempt(problem_id)
                    await websocket.send_json({"type": "session_started", "session_id": sid})

                    # Clean up previous workspace if switching sessions
                    if connection_workspace and connection_workspace.exists():
                        shutil.rmtree(connection_workspace, ignore_errors=True)

                    connection_workspace = WORKSPACE_DIR / sid
                    connection_workspace.mkdir(parents=True, exist_ok=True)

                    tutor = LeetCodeTutor(
                        mode=mode,
                        problem=problem,
                        workspace_path=str(connection_workspace),
                    )

                    try:
                        await tutor.start_session()
                        # Send initial greeting from Claude
                        async with _chat_lock:
                            greeting = ""
                            async for chunk in tutor.chat(
                                f"The user just started a {mode} mode session for the problem \"{problem['title']}\". "
                                "Give a brief, friendly greeting and ask how they'd like to approach the problem. "
                                "Keep it to 2-3 sentences."
                            ):
                                greeting += chunk
                                if not await safe_send({"type": "assistant_chunk", "content": chunk}):
                                    break
                            await safe_send({"type": "assistant_message", "content": greeting})
                            await session_logger.log_message("assistant", greeting)
                            if tutor.claude_session_id:
                                await session_logger.update_claude_session_id(tutor.claude_session_id)
                    except Exception as e:
                        logger.exception("Failed to start tutor session")
                        await safe_send({
                            "type": "assistant_message",
                            "content": "Failed to connect to the tutor. Using fallback mode.",
                        })
                        tutor = None

                elif msg_type == "message":
                    content = msg.get("content", "")
                    code = msg.get("code")
                    test_results = msg.get("test_results")
                    if code:
                        _last_editor_code = code
                        await session_logger.update_editor_code(code)
                    await session_logger.log_message("user", content)

                    if tutor:
                        try:
                            async with _chat_lock:
                                full_response = ""
                                async for chunk in tutor.chat(content, code=code, test_results=test_results):
                                    full_response += chunk
                                    if not await safe_send({"type": "assistant_chunk", "content": chunk}):
                                        break
                                await safe_send({"type": "assistant_message", "content": full_response})
                                await session_logger.log_message("assistant", full_response)
                                if tutor.claude_session_id:
                                    await session_logger.update_claude_session_id(tutor.claude_session_id)
                        except Exception as e:
                            logger.exception("Error during tutor chat")
                            await safe_send({"type": "error", "content": "An error occurred while processing your message."})
                    else:
                        await safe_send({
                            "type": "assistant_message",
                            "content": "Claude is not connected. Try selecting a new problem to start a session.",
                        })

                elif msg_type == "time_update":
                    try:
                        if tutor and tutor.mode == "interview":
                            remaining = msg.get("time_remaining", 0)
                            tutor.update_time(remaining)
                            await session_logger.update_time_remaining(remaining)
                    except Exception as e:
                        logger.exception("Error handling time_update")
                        await safe_send({"type": "error", "content": "An error occurred while updating time."})

                elif msg_type == "time_up":
                    code = msg.get("code")
                    if tutor and tutor.mode == "interview" and tutor.interview_phase != "review":
                        await session_logger.log_phase_transition("review")
                        tutor.update_time(0)
                        try:
                            async with _chat_lock:
                                full_response = ""
                                async for chunk in tutor.enter_review_phase(code=code):
                                    full_response += chunk
                                    if not await safe_send({"type": "assistant_chunk", "content": chunk}):
                                        break
                                await safe_send({"type": "assistant_message", "content": full_response})
                                await safe_send({"type": "review_phase_started"})
                                await session_logger.log_message("assistant", full_response)
                        except Exception as e:
                            logger.exception("Error during review phase")
                            await safe_send({"type": "error", "content": "An error occurred while entering review phase."})

                elif msg_type == "request_hint":
                    code = msg.get("code")
                    if code:
                        _last_editor_code = code
                        await session_logger.update_editor_code(code)

                    if tutor:
                        try:
                            async with _chat_lock:
                                full_response = ""
                                async for chunk in tutor.request_hint(code=code):
                                    full_response += chunk
                                    if not await safe_send({"type": "assistant_chunk", "content": chunk}):
                                        break
                                await safe_send({"type": "assistant_message", "content": full_response})
                                await session_logger.log_hint_requested()
                                await session_logger.log_message("assistant", full_response)
                                if tutor.claude_session_id:
                                    await session_logger.update_claude_session_id(tutor.claude_session_id)
                        except Exception as e:
                            logger.exception("Error during hint request")
                            await safe_send({"type": "error", "content": "An error occurred while generating a hint."})
                    else:
                        # Fallback to static hints
                        problem = get_problem(session_logger.current_session["problem_id"]) if session_logger.current_session else None
                        if problem:
                            hint_idx = min(session_logger.current_session["hints_requested"], len(problem["hints"]) - 1)
                            await safe_send({
                                "type": "assistant_message",
                                "content": f"**Hint:** {problem['hints'][hint_idx]}",
                            })
                            await session_logger.log_hint_requested()

                elif msg_type == "nudge_request":
                    # Server-side guard: don't nudge if user has been gone 30+ min
                    if (time.time() - _last_real_activity) >= _NUDGE_ABANDON_SECS:
                        logger.debug("Ignoring nudge_request: user inactive for 30+ min")
                        continue

                    trigger = msg.get("trigger", "inactivity")
                    context = msg.get("context", {})

                    if tutor:
                        try:
                            nudge_prompt = build_nudge_message(trigger, context)
                            code = context.get("current_code")
                            async with _chat_lock:
                                full_response = ""
                                async for chunk in tutor.chat(nudge_prompt, code=code):
                                    full_response += chunk
                                    if not await safe_send({"type": "assistant_chunk", "content": chunk}):
                                        break
                                await safe_send({"type": "assistant_message", "content": full_response, "nudge": True})
                                await session_logger.log_message("assistant", full_response)
                                if tutor.claude_session_id:
                                    await session_logger.update_claude_session_id(tutor.claude_session_id)
                        except Exception as e:
                            logger.exception("Error during nudge")
                            await safe_send({"type": "error", "content": "An error occurred while generating a nudge."})

                elif msg_type == "resume_session":
                    resume_sid = msg.get("session_id")
                    if not resume_sid or not _is_valid_session_id(resume_sid):
                        await safe_send({"type": "error", "content": "Invalid session ID for resume."})
                        continue

                    # Clean up any active session first
                    if tutor:
                        await tutor.end_session()
                        tutor = None
                    if session_logger.current_session:
                        await session_logger.end_session()

                    # Try seamless resume from parked tutor
                    parked = await tutor_registry.reclaim(resume_sid)
                    if parked:
                        tutor = parked.tutor
                        session_logger = parked.session_logger
                        connection_workspace = Path(parked.workspace_path)
                        current_session_id = resume_sid
                        _last_editor_code = parked.last_editor_code

                        # Reopen the session in the logger
                        await session_logger.resume_session(resume_sid)

                        # Load chat history from session file for UI display
                        parked_session_data = await _api_session_logger.get_session(resume_sid)
                        parked_chat_history = parked_session_data.get("chat_history", []) if parked_session_data else []

                        await safe_send({
                            "type": "session_resumed",
                            "session_id": resume_sid,
                            "resume_type": "seamless",
                            "problem_id": parked.problem_id,
                            "mode": parked.mode,
                            "last_editor_code": parked.last_editor_code,
                            "hint_count": parked.hint_count,
                            "interview_phase": parked.interview_phase,
                            "time_remaining": parked.time_remaining,
                            "chat_history": parked_chat_history,
                            "whiteboard_state": parked_session_data.get("whiteboard_state") if parked_session_data else None,
                        })
                        logger.info("Seamless resume for session %s", resume_sid)
                    else:
                        # Cold resume: load session from disk
                        session_data = await _api_session_logger.get_session(resume_sid)
                        if not session_data:
                            await safe_send({"type": "error", "content": "Session not found."})
                            continue

                        problem_id = session_data.get("problem_id")
                        mode = session_data.get("mode")
                        if mode == "pattern-quiz":
                            await safe_send({"type": "error", "content": "Pattern quiz sessions cannot be resumed."})
                            continue

                        problem = get_problem(problem_id)
                        if not problem:
                            await safe_send({"type": "error", "content": "Problem not found for this session."})
                            continue

                        # Reopen session in logger
                        resumed = await session_logger.resume_session(resume_sid)
                        if not resumed:
                            await safe_send({"type": "error", "content": "Failed to reopen session."})
                            continue

                        current_session_id = resume_sid
                        _last_editor_code = session_data.get("last_editor_code")
                        chat_history = session_data.get("chat_history", [])

                        # Set up workspace
                        if connection_workspace and connection_workspace.exists():
                            shutil.rmtree(connection_workspace, ignore_errors=True)
                        connection_workspace = WORKSPACE_DIR / resume_sid
                        connection_workspace.mkdir(parents=True, exist_ok=True)

                        # Restore code to workspace
                        if _last_editor_code:
                            (connection_workspace / "solution.py").write_text(_last_editor_code)

                        tutor = LeetCodeTutor(
                            mode=mode,
                            problem=problem,
                            workspace_path=str(connection_workspace),
                        )
                        # Restore tutor state
                        tutor.hint_count = session_data.get("hints_requested", 0)
                        if mode == "interview":
                            phases = session_data.get("phase_transitions", [])
                            if any(p.get("phase") == "review" for p in phases):
                                tutor.interview_phase = "review"

                        # Try resuming Claude's conversation
                        saved_claude_sid = session_data.get("claude_session_id")
                        resume_type = "replayed"
                        try:
                            if saved_claude_sid:
                                await tutor.start_session_with_resume(saved_claude_sid)
                                resume_type = "seamless"
                                # Send a brief welcome-back via the resumed conversation
                                async with _chat_lock:
                                    welcome = ""
                                    async for chunk in tutor.chat(
                                        "[The user has reconnected to this session. Welcome them back in 1 sentence and ask where they'd like to pick up.]"
                                    ):
                                        welcome += chunk
                                        if not await safe_send({"type": "assistant_chunk", "content": chunk}):
                                            break
                                    await safe_send({"type": "assistant_message", "content": welcome})
                                    await session_logger.log_message("assistant", welcome)
                                    if tutor.claude_session_id:
                                        await session_logger.update_claude_session_id(tutor.claude_session_id)
                            else:
                                raise ValueError("No claude_session_id available")
                        except Exception:
                            logger.info("Claude resume failed for %s, replaying history", resume_sid)
                            # Fallback: start fresh and replay history
                            try:
                                if tutor.client:
                                    await tutor.end_session()
                                tutor = LeetCodeTutor(
                                    mode=mode,
                                    problem=problem,
                                    workspace_path=str(connection_workspace),
                                )
                                tutor.hint_count = session_data.get("hints_requested", 0)
                                if mode == "interview":
                                    phases = session_data.get("phase_transitions", [])
                                    if any(p.get("phase") == "review" for p in phases):
                                        tutor.interview_phase = "review"
                                await tutor.start_session()
                                async with _chat_lock:
                                    welcome = ""
                                    async for chunk in tutor.replay_history(chat_history):
                                        welcome += chunk
                                        if not await safe_send({"type": "assistant_chunk", "content": chunk}):
                                            break
                                    await safe_send({"type": "assistant_message", "content": welcome})
                                    await session_logger.log_message("assistant", welcome)
                                    if tutor.claude_session_id:
                                        await session_logger.update_claude_session_id(tutor.claude_session_id)
                            except Exception:
                                logger.exception("Failed to replay history for session %s", resume_sid)
                                await safe_send({"type": "error", "content": "Failed to restore session context."})
                                tutor = None

                        await safe_send({
                            "type": "session_resumed",
                            "session_id": resume_sid,
                            "resume_type": resume_type,
                            "problem_id": problem_id,
                            "mode": mode,
                            "last_editor_code": _last_editor_code,
                            "hint_count": session_data.get("hints_requested", 0),
                            "interview_phase": tutor.interview_phase if tutor else None,
                            "time_remaining": session_data.get("time_remaining"),
                            "chat_history": chat_history,
                            "whiteboard_state": session_data.get("whiteboard_state"),
                        })
                        logger.info("Cold resume (%s) for session %s", resume_type, resume_sid)

                elif msg_type == "end_session":
                    try:
                        if tutor:
                            await tutor.end_session()
                            tutor = None
                        current_session_id = None
                        _last_editor_code = None
                        await session_logger.end_session()
                    except Exception as e:
                        logger.exception("Error handling end_session")
                        tutor = None
                        current_session_id = None
                        _last_editor_code = None
                        await safe_send({"type": "error", "content": "An error occurred while ending the session."})

            except Exception as e:
                logger.exception("Unexpected error handling message type=%s", msg_type)
                try:
                    await websocket.send_json({"type": "error", "content": "An internal error occurred."})
                except Exception:
                    pass
                continue

    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if tutor and current_session_id:
            # Park the tutor for possible resume instead of killing it
            try:
                problem_id = session_logger.current_session.get("problem_id") if session_logger.current_session else None
                mode = session_logger.current_session.get("mode") if session_logger.current_session else None
                if problem_id and mode and mode != "pattern-quiz":
                    parked = ParkedTutor(
                        tutor=tutor,
                        session_logger=session_logger,
                        workspace_path=str(connection_workspace) if connection_workspace else "",
                        problem_id=problem_id,
                        mode=mode,
                        claude_session_id=tutor.claude_session_id,
                        last_editor_code=_last_editor_code,
                        hint_count=tutor.hint_count,
                        interview_phase=tutor.interview_phase,
                        time_remaining=tutor.time_remaining,
                    )
                    await tutor_registry.park(current_session_id, parked)
                    logger.info("Parked tutor for session %s", current_session_id)
                    return  # Don't clean up — registry owns it now
            except Exception:
                logger.exception("Failed to park tutor, falling back to cleanup")
            # Fallback: kill tutor if parking failed
            try:
                await tutor.end_session()
            except Exception:
                logger.exception("tutor end_session failed during cleanup")
            try:
                await session_logger.end_session()
            except Exception:
                logger.exception("session_logger end_session failed during cleanup")
        elif tutor:
            try:
                await tutor.end_session()
            except Exception:
                logger.exception("tutor end_session failed during cleanup")
            try:
                await session_logger.end_session()
            except Exception:
                logger.exception("session_logger end_session failed during cleanup")
        else:
            try:
                await session_logger.end_session()
            except Exception:
                logger.exception("session_logger end_session failed during cleanup")
        try:
            if connection_workspace and connection_workspace.exists():
                shutil.rmtree(connection_workspace, ignore_errors=True)
        except Exception:
            logger.exception("workspace cleanup failed")
