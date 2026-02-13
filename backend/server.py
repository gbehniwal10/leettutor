import sys
if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, HTTPException, WebSocket, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request
from pydantic import BaseModel, Field
import json
import os
from pathlib import Path
import logging

from .auth import (
    AUTH_ENABLED, LEETTUTOR_PASSWORD,
    generate_token, check_login_rate_limit,
    require_auth, LoginRequest,
)
from .problems import list_problems, get_problem, get_random_problem, get_skill_tree, load_skill_tree
from .executor import CodeExecutor
from .session_logger import SessionLogger, _is_valid_session_id
from .tutor_registry import TutorRegistry
from .problem_history import ProblemHistory
from .learning_history import LearningHistory
from .review_scheduler import ReviewScheduler
from .solution_store import SolutionStore
from .ws_handler import websocket_chat as _ws_chat

logger = logging.getLogger(__name__)

app = FastAPI()


# --- Health Check ---

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


# --- Auth Endpoints ---

@app.get("/api/auth/status")
async def auth_status():
    return {"auth_required": AUTH_ENABLED}


@app.post("/api/login")
async def api_login(req: LoginRequest, request: Request):
    if not AUTH_ENABLED:
        return {"token": "no-auth", "message": "Authentication is disabled."}
    client_ip = request.client.host if request.client else "unknown"
    check_login_rate_limit(client_ip)
    if req.password != LEETTUTOR_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    token = generate_token()
    return {"token": token}

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
_learning_history = LearningHistory(str(SESSIONS_DIR))
_review_scheduler = ReviewScheduler(str(SESSIONS_DIR))
_solution_store = SolutionStore(BASE_DIR / "solutions")

# Read-only SessionLogger for API endpoints (list/get sessions).
# Per-connection loggers are created inside the WebSocket handler.
_api_session_logger = SessionLogger(sessions_dir=SESSIONS_DIR)

# Static files
DIST_DIR = FRONTEND_DIR / "dist"
_has_dist = DIST_DIR.is_dir() and (DIST_DIR / "index.html").is_file()

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

if _has_dist:
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")


@app.get("/")
async def index():
    from starlette.responses import HTMLResponse
    if _has_dist:
        html = (DIST_DIR / "index.html").read_text()
    else:
        html = (FRONTEND_DIR / "index.html").read_text()
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


@app.get("/api/review-queue", dependencies=[Depends(require_auth)])
async def api_review_queue():
    problems = list_problems()
    history = await _problem_history.get_all()
    for p in problems:
        entry = history.get(p["id"])
        if entry:
            p["status"] = entry.get("status", "unsolved")
            p["last_solved_at"] = entry.get("last_solved_at")
        else:
            p["status"] = "unsolved"
    due_problems = _review_scheduler.get_due_problems(problems)
    due_topics = _review_scheduler.get_due_topics()
    return {
        "due_problems": due_problems,
        "due_topics": due_topics,
        "topic_summaries": _learning_history.get_all_topic_summaries(),
    }


@app.get("/api/problems/random")
async def api_random_problem(difficulty: str = None, tag: str = None):
    tags = [tag] if tag else None
    problem = get_random_problem(difficulty=difficulty, tags=tags)
    if not problem:
        raise HTTPException(status_code=404, detail="No matching problem found")
    return {"id": problem["id"]}


@app.get("/api/problems/{problem_id}")
async def api_get_problem(problem_id: str):
    problem = get_problem(problem_id)
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found")
    return {k: v for k, v in problem.items() if k != "hidden_test_cases"}


@app.get("/api/skill-tree", dependencies=[Depends(require_auth)])
async def api_skill_tree():
    return get_skill_tree()


class RunRequest(BaseModel):
    code: str = Field(..., max_length=51200)
    problem_id: str = Field(..., max_length=100)
    mode: str = Field("", max_length=30)
    session_id: str = Field("", max_length=100)


from .pattern_explain import PatternExplainRequest, pattern_explain_pool


@app.on_event("startup")
async def startup_event():
    tutor_registry.start()
    load_skill_tree()
    await _learning_history.load()
    await _review_scheduler.load()


@app.on_event("shutdown")
async def shutdown_event():
    await tutor_registry.stop()
    await pattern_explain_pool.shutdown()


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
        # Auto-save solution
        try:
            runtimes = [r.get("runtime_ms", 0) for r in results.get("results", [])]
            avg_runtime = sum(runtimes) / len(runtimes) if runtimes else 0
            saved = await _solution_store.save_solution(
                problem_id=req.problem_id,
                code=req.code,
                passed=results.get("passed", 0),
                total=results.get("passed", 0) + results.get("failed", 0),
                avg_runtime_ms=avg_runtime,
                mode=req.mode,
                session_id=req.session_id,
            )
            results["saved_solution_id"] = saved.get("id")
        except Exception:
            logger.warning("Failed to auto-save solution for %s", req.problem_id)
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
        explanation = await pattern_explain_pool.query(prompt)
        return {"explanation": explanation}
    except Exception as e:
        logger.exception("Pattern explain failed")
        raise HTTPException(status_code=500, detail="Failed to generate explanation")


# --- Solution Endpoints ---


class LabelUpdate(BaseModel):
    label: str = Field(..., max_length=120)


@app.get("/api/solution-counts", dependencies=[Depends(require_auth)])
async def api_solution_counts():
    return await _solution_store.get_solution_counts()


@app.get("/api/solutions/{problem_id}", dependencies=[Depends(require_auth)])
async def api_list_solutions(problem_id: str):
    return await _solution_store.list_solutions(problem_id)


@app.get("/api/solutions/{problem_id}/{solution_id}", dependencies=[Depends(require_auth)])
async def api_get_solution(problem_id: str, solution_id: str):
    sol = await _solution_store.get_solution(problem_id, solution_id)
    if not sol:
        raise HTTPException(status_code=404, detail="Solution not found")
    return sol


@app.delete("/api/solutions/{problem_id}/{solution_id}", dependencies=[Depends(require_auth)])
async def api_delete_solution(problem_id: str, solution_id: str):
    deleted = await _solution_store.delete_solution(problem_id, solution_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Solution not found")
    return {"deleted": True}


@app.patch("/api/solutions/{problem_id}/{solution_id}", dependencies=[Depends(require_auth)])
async def api_update_solution_label(problem_id: str, solution_id: str, req: LabelUpdate):
    try:
        sol = await _solution_store.update_label(problem_id, solution_id, req.label)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not sol:
        raise HTTPException(status_code=404, detail="Solution not found")
    return sol


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
async def websocket_endpoint(websocket: WebSocket):
    await _ws_chat(
        websocket,
        sessions_dir=SESSIONS_DIR,
        workspace_dir=WORKSPACE_DIR,
        tutor_registry=tutor_registry,
        problem_history=_problem_history,
        learning_history=_learning_history,
        review_scheduler=_review_scheduler,
        api_session_logger=_api_session_logger,
        solution_store=_solution_store,
    )
