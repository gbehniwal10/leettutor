import sys
if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import json
from pathlib import Path

from .problems import list_problems, get_problem
from .executor import CodeExecutor
from .session_logger import SessionLogger
from .tutor import LeetCodeTutor
import traceback

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
WORKSPACE_DIR = BASE_DIR / "workspace"

executor = CodeExecutor()
session_logger = SessionLogger(sessions_dir=str(BASE_DIR / "sessions"))

# Static files
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


# --- API Routes ---

@app.get("/api/problems")
async def api_list_problems():
    return list_problems()


@app.get("/api/problems/{problem_id}")
async def api_get_problem(problem_id: str):
    problem = get_problem(problem_id)
    if not problem:
        return {"error": "Problem not found"}
    return {k: v for k, v in problem.items() if k != "hidden_test_cases"}


class RunRequest(BaseModel):
    code: str
    problem_id: str


@app.post("/api/run")
async def api_run(req: RunRequest):
    problem = get_problem(req.problem_id)
    if not problem:
        return {"error": "Problem not found"}
    helpers = problem.get("helpers")
    results = executor.run_tests(req.code, problem["test_cases"], helpers=helpers)
    return results


@app.post("/api/submit")
async def api_submit(req: RunRequest):
    problem = get_problem(req.problem_id)
    if not problem:
        return {"error": "Problem not found"}
    all_tests = problem["test_cases"] + problem.get("hidden_test_cases", [])
    helpers = problem.get("helpers")
    results = executor.run_tests(req.code, all_tests, helpers=helpers)
    return results


@app.get("/api/sessions")
async def api_list_sessions():
    return session_logger.list_sessions()


@app.get("/api/sessions/{session_id}")
async def api_get_session(session_id: str):
    session = session_logger.get_session(session_id)
    if not session:
        return {"error": "Session not found"}
    return session


# --- WebSocket with Claude Tutor ---

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    tutor: LeetCodeTutor | None = None

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg["type"] == "start_session":
                # Clean up previous tutor session
                if tutor:
                    await tutor.end_session()

                problem = get_problem(msg["problem_id"])
                if not problem:
                    await websocket.send_json({"type": "error", "content": "Problem not found"})
                    continue

                sid = session_logger.start_session(msg["problem_id"], msg["mode"])
                await websocket.send_json({"type": "session_started", "session_id": sid})

                tutor = LeetCodeTutor(
                    mode=msg["mode"],
                    problem=problem,
                    workspace_path=str(WORKSPACE_DIR),
                )

                try:
                    await tutor.start_session()
                    # Send initial greeting from Claude
                    greeting = ""
                    async for chunk in tutor.chat(
                        f"The user just started a {msg['mode']} mode session for the problem \"{problem['title']}\". "
                        "Give a brief, friendly greeting and ask how they'd like to approach the problem. "
                        "Keep it to 2-3 sentences."
                    ):
                        greeting += chunk
                        await websocket.send_json({"type": "assistant_chunk", "content": chunk})
                    # Send final complete message to mark end of stream
                    await websocket.send_json({"type": "assistant_message", "content": greeting})
                    session_logger.log_message("assistant", greeting)
                except Exception as e:
                    traceback.print_exc()
                    await websocket.send_json({
                        "type": "assistant_message",
                        "content": f"Failed to connect to Claude: {e}. Using fallback mode.",
                    })
                    tutor = None

            elif msg["type"] == "message":
                content = msg.get("content", "")
                code = msg.get("code")
                test_results = msg.get("test_results")
                session_logger.log_message("user", content)

                if tutor:
                    try:
                        full_response = ""
                        async for chunk in tutor.chat(content, code=code, test_results=test_results):
                            full_response += chunk
                            await websocket.send_json({"type": "assistant_chunk", "content": chunk})
                        await websocket.send_json({"type": "assistant_message", "content": full_response})
                        session_logger.log_message("assistant", full_response)
                    except Exception as e:
                        await websocket.send_json({"type": "error", "content": str(e)})
                else:
                    await websocket.send_json({
                        "type": "assistant_message",
                        "content": "Claude is not connected. Try selecting a new problem to start a session.",
                    })

            elif msg["type"] == "time_update":
                if tutor and tutor.mode == "interview":
                    tutor.update_time(msg.get("time_remaining", 0))

            elif msg["type"] == "time_up":
                code = msg.get("code")
                if tutor and tutor.mode == "interview" and tutor.interview_phase != "review":
                    session_logger.log_phase_transition("review")
                    tutor.update_time(0)
                    try:
                        full_response = ""
                        async for chunk in tutor.enter_review_phase(code=code):
                            full_response += chunk
                            await websocket.send_json({"type": "assistant_chunk", "content": chunk})
                        await websocket.send_json({"type": "assistant_message", "content": full_response})
                        await websocket.send_json({"type": "review_phase_started"})
                        session_logger.log_message("assistant", full_response)
                    except Exception as e:
                        await websocket.send_json({"type": "error", "content": str(e)})

            elif msg["type"] == "request_hint":
                code = msg.get("code")
                session_logger.log_hint_requested()

                if tutor:
                    try:
                        full_response = ""
                        async for chunk in tutor.request_hint(code=code):
                            full_response += chunk
                            await websocket.send_json({"type": "assistant_chunk", "content": chunk})
                        await websocket.send_json({"type": "assistant_message", "content": full_response})
                        session_logger.log_message("assistant", full_response)
                    except Exception as e:
                        await websocket.send_json({"type": "error", "content": str(e)})
                else:
                    # Fallback to static hints
                    problem = get_problem(session_logger.current_session["problem_id"]) if session_logger.current_session else None
                    if problem:
                        hint_idx = min(session_logger.current_session["hints_requested"] - 1, len(problem["hints"]) - 1)
                        await websocket.send_json({
                            "type": "assistant_message",
                            "content": f"**Hint:** {problem['hints'][hint_idx]}",
                        })

            elif msg["type"] == "end_session":
                if tutor:
                    await tutor.end_session()
                    tutor = None
                session_logger.end_session()

    except WebSocketDisconnect:
        if tutor:
            await tutor.end_session()
