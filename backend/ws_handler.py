"""WebSocket chat handler: manages per-connection tutor sessions.

Extracted from server.py to reduce the god-file problem. The main entry
point is ``websocket_chat()``, which is mounted as ``/ws/chat`` by
server.py.
"""

import asyncio
import json
import logging
import shutil
import time
from pathlib import Path

from fastapi import WebSocket, WebSocketDisconnect

from .auth import AUTH_ENABLED, verify_token
from .problems import get_problem
from .session_logger import SessionLogger, _is_valid_session_id
from .tutor import LeetCodeTutor, build_nudge_message
from .tutor_registry import TutorRegistry, ParkedTutor
from .problem_history import ProblemHistory

logger = logging.getLogger(__name__)

_NUDGE_ABANDON_SECS = 30 * 60  # stop nudging after 30 min of no real user activity


class WebSocketSession:
    """Holds all mutable state for a single WebSocket connection.

    Each message type is handled by a ``handle_<type>`` method, keeping the
    main loop thin and each handler focused on one concern.
    """

    def __init__(
        self,
        websocket: WebSocket,
        *,
        sessions_dir: str,
        workspace_dir: Path,
        tutor_registry: TutorRegistry,
        problem_history: ProblemHistory,
        api_session_logger: SessionLogger,
    ):
        self.ws = websocket
        self.sessions_dir = sessions_dir
        self.workspace_dir = workspace_dir
        self.tutor_registry = tutor_registry
        self.problem_history = problem_history
        self.api_session_logger = api_session_logger

        # Per-connection mutable state
        self.tutor: LeetCodeTutor | None = None
        self.session_logger = SessionLogger(sessions_dir=sessions_dir)
        self.connection_workspace: Path | None = None
        self.current_session_id: str | None = None
        self.last_editor_code: str | None = None
        self._ws_alive = True
        self._chat_lock = asyncio.Lock()
        self._last_real_activity: float = time.time()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def safe_send(self, data: dict) -> bool:
        """Send JSON to client, return False if disconnected."""
        if not self._ws_alive:
            return False
        try:
            await self.ws.send_json(data)
            return True
        except (WebSocketDisconnect, RuntimeError):
            self._ws_alive = False
            return False

    async def _stream_tutor_response(self, tutor_iter, *, log_as: str = "assistant") -> str:
        """Consume an async generator from the tutor, streaming chunks to the client.

        Returns the full concatenated response text.
        """
        full_response = ""
        async for chunk in tutor_iter:
            full_response += chunk
            if not await self.safe_send({"type": "assistant_chunk", "content": chunk}):
                break
        await self.safe_send({"type": "assistant_message", "content": full_response})
        await self.session_logger.log_message(log_as, full_response)
        if self.tutor and self.tutor.claude_session_id:
            await self.session_logger.update_claude_session_id(self.tutor.claude_session_id)
        return full_response

    # ------------------------------------------------------------------
    # Message handlers
    # ------------------------------------------------------------------

    async def handle_start_session(self, msg: dict) -> None:
        problem_id = msg.get("problem_id")
        mode = msg.get("mode")
        if not problem_id or not mode:
            await self.ws.send_json({"type": "error", "content": "Missing required fields for start_session."})
            return

        # Clean up previous tutor session
        if self.tutor:
            await self.tutor.end_session()
            await self.session_logger.end_session()

        problem = get_problem(problem_id)
        if not problem:
            await self.ws.send_json({"type": "error", "content": "Problem not found"})
            return

        sid = await self.session_logger.start_session(problem_id, mode)
        self.current_session_id = sid
        self.last_editor_code = None
        if mode != "pattern-quiz":
            await self.problem_history.record_attempt(problem_id)
        await self.ws.send_json({"type": "session_started", "session_id": sid})

        # Clean up previous workspace if switching sessions
        if self.connection_workspace and self.connection_workspace.exists():
            shutil.rmtree(self.connection_workspace, ignore_errors=True)

        self.connection_workspace = self.workspace_dir / sid
        self.connection_workspace.mkdir(parents=True, exist_ok=True)

        self.tutor = LeetCodeTutor(
            mode=mode,
            problem=problem,
            workspace_path=str(self.connection_workspace),
        )

        try:
            await self.tutor.start_session()
            async with self._chat_lock:
                await self._stream_tutor_response(
                    self.tutor.chat(
                        f'The user just started a {mode} mode session for the problem "{problem["title"]}". '
                        "Give a brief, friendly greeting and ask how they'd like to approach the problem. "
                        "Keep it to 2-3 sentences."
                    )
                )
        except Exception:
            logger.exception("Failed to start tutor session")
            await self.safe_send({
                "type": "assistant_message",
                "content": "Failed to connect to the tutor. Using fallback mode.",
            })
            self.tutor = None

    async def handle_message(self, msg: dict) -> None:
        content = msg.get("content", "")
        code = msg.get("code")
        test_results = msg.get("test_results")
        if code:
            self.last_editor_code = code
            await self.session_logger.update_editor_code(code)
        await self.session_logger.log_message("user", content)

        if self.tutor:
            try:
                async with self._chat_lock:
                    await self._stream_tutor_response(
                        self.tutor.chat(content, code=code, test_results=test_results)
                    )
            except Exception:
                logger.exception("Error during tutor chat")
                await self.safe_send({"type": "error", "content": "An error occurred while processing your message."})
        else:
            await self.safe_send({
                "type": "assistant_message",
                "content": "Claude is not connected. Try selecting a new problem to start a session.",
            })

    async def handle_time_update(self, msg: dict) -> None:
        try:
            if self.tutor and self.tutor.mode == "interview":
                remaining = msg.get("time_remaining", 0)
                self.tutor.update_time(remaining)
                await self.session_logger.update_time_remaining(remaining)
        except Exception:
            logger.exception("Error handling time_update")
            await self.safe_send({"type": "error", "content": "An error occurred while updating time."})

    async def handle_time_up(self, msg: dict) -> None:
        code = msg.get("code")
        if self.tutor and self.tutor.mode == "interview" and self.tutor.interview_phase != "review":
            await self.session_logger.log_phase_transition("review")
            self.tutor.update_time(0)
            try:
                async with self._chat_lock:
                    await self._stream_tutor_response(self.tutor.enter_review_phase(code=code))
                    await self.safe_send({"type": "review_phase_started"})
            except Exception:
                logger.exception("Error during review phase")
                await self.safe_send({"type": "error", "content": "An error occurred while entering review phase."})

    async def handle_request_hint(self, msg: dict) -> None:
        code = msg.get("code")
        if code:
            self.last_editor_code = code
            await self.session_logger.update_editor_code(code)

        if self.tutor:
            try:
                async with self._chat_lock:
                    await self._stream_tutor_response(self.tutor.request_hint(code=code))
                    await self.session_logger.log_hint_requested()
            except Exception:
                logger.exception("Error during hint request")
                await self.safe_send({"type": "error", "content": "An error occurred while generating a hint."})
        else:
            # Fallback to static hints
            problem = get_problem(self.session_logger.current_session["problem_id"]) if self.session_logger.current_session else None
            if problem:
                hint_idx = min(self.session_logger.current_session["hints_requested"], len(problem["hints"]) - 1)
                await self.safe_send({
                    "type": "assistant_message",
                    "content": f"**Hint:** {problem['hints'][hint_idx]}",
                })
                await self.session_logger.log_hint_requested()

    async def handle_nudge_request(self, msg: dict) -> None:
        # Server-side guard: don't nudge if user has been gone 30+ min
        if (time.time() - self._last_real_activity) >= _NUDGE_ABANDON_SECS:
            logger.debug("Ignoring nudge_request: user inactive for 30+ min")
            return

        trigger = msg.get("trigger", "inactivity")
        context = msg.get("context", {})

        if self.tutor:
            try:
                nudge_prompt = build_nudge_message(trigger, context)
                code = context.get("current_code")
                async with self._chat_lock:
                    full_response = ""
                    async for chunk in self.tutor.chat(nudge_prompt, code=code):
                        full_response += chunk
                        if not await self.safe_send({"type": "assistant_chunk", "content": chunk}):
                            break
                    await self.safe_send({"type": "assistant_message", "content": full_response, "nudge": True})
                    await self.session_logger.log_message("assistant", full_response)
                    if self.tutor.claude_session_id:
                        await self.session_logger.update_claude_session_id(self.tutor.claude_session_id)
            except Exception:
                logger.exception("Error during nudge")
                await self.safe_send({"type": "error", "content": "An error occurred while generating a nudge."})

    async def handle_resume_session(self, msg: dict) -> None:
        resume_sid = msg.get("session_id")
        if not resume_sid or not _is_valid_session_id(resume_sid):
            await self.safe_send({"type": "error", "content": "Invalid session ID for resume."})
            return

        # Clean up any active session first
        if self.tutor:
            await self.tutor.end_session()
            self.tutor = None
        if self.session_logger.current_session:
            await self.session_logger.end_session()

        # Try seamless resume from parked tutor
        parked = await self.tutor_registry.reclaim(resume_sid)
        if parked:
            await self._resume_from_parked(resume_sid, parked)
        else:
            await self._resume_cold(resume_sid)

    async def _resume_from_parked(self, resume_sid: str, parked: ParkedTutor) -> None:
        """Resume a session from a parked (in-memory) tutor."""
        self.tutor = parked.tutor
        self.session_logger = parked.session_logger
        self.connection_workspace = Path(parked.workspace_path)
        self.current_session_id = resume_sid
        self.last_editor_code = parked.last_editor_code

        await self.session_logger.resume_session(resume_sid)

        # Load chat history from session file for UI display
        parked_session_data = await self.api_session_logger.get_session(resume_sid)
        parked_chat_history = parked_session_data.get("chat_history", []) if parked_session_data else []

        await self.safe_send({
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

    async def _resume_cold(self, resume_sid: str) -> None:
        """Resume a session from disk (no parked tutor available)."""
        session_data = await self.api_session_logger.get_session(resume_sid)
        if not session_data:
            await self.safe_send({"type": "error", "content": "Session not found."})
            return

        problem_id = session_data.get("problem_id")
        mode = session_data.get("mode")
        if mode == "pattern-quiz":
            await self.safe_send({"type": "error", "content": "Pattern quiz sessions cannot be resumed."})
            return

        problem = get_problem(problem_id)
        if not problem:
            await self.safe_send({"type": "error", "content": "Problem not found for this session."})
            return

        resumed = await self.session_logger.resume_session(resume_sid)
        if not resumed:
            await self.safe_send({"type": "error", "content": "Failed to reopen session."})
            return

        self.current_session_id = resume_sid
        self.last_editor_code = session_data.get("last_editor_code")
        chat_history = session_data.get("chat_history", [])

        # Set up workspace
        if self.connection_workspace and self.connection_workspace.exists():
            shutil.rmtree(self.connection_workspace, ignore_errors=True)
        self.connection_workspace = self.workspace_dir / resume_sid
        self.connection_workspace.mkdir(parents=True, exist_ok=True)

        if self.last_editor_code:
            (self.connection_workspace / "solution.py").write_text(self.last_editor_code)

        self.tutor = LeetCodeTutor(
            mode=mode,
            problem=problem,
            workspace_path=str(self.connection_workspace),
        )
        self.tutor.hint_count = session_data.get("hints_requested", 0)
        if mode == "interview":
            phases = session_data.get("phase_transitions", [])
            if any(p.get("phase") == "review" for p in phases):
                self.tutor.interview_phase = "review"

        # Try resuming Claude's conversation
        saved_claude_sid = session_data.get("claude_session_id")
        resume_type = "replayed"
        try:
            if saved_claude_sid:
                await self.tutor.start_session_with_resume(saved_claude_sid)
                resume_type = "seamless"
                async with self._chat_lock:
                    await self._stream_tutor_response(
                        self.tutor.chat(
                            "[The user has reconnected to this session. "
                            "Welcome them back in 1 sentence and ask where they'd like to pick up.]"
                        )
                    )
            else:
                raise ValueError("No claude_session_id available")
        except Exception:
            logger.info("Claude resume failed for %s, replaying history", resume_sid)
            try:
                if self.tutor.client:
                    await self.tutor.end_session()
                self.tutor = LeetCodeTutor(
                    mode=mode,
                    problem=problem,
                    workspace_path=str(self.connection_workspace),
                )
                self.tutor.hint_count = session_data.get("hints_requested", 0)
                if mode == "interview":
                    phases = session_data.get("phase_transitions", [])
                    if any(p.get("phase") == "review" for p in phases):
                        self.tutor.interview_phase = "review"
                await self.tutor.start_session()
                async with self._chat_lock:
                    await self._stream_tutor_response(
                        self.tutor.replay_history(chat_history)
                    )
            except Exception:
                logger.exception("Failed to replay history for session %s", resume_sid)
                await self.safe_send({"type": "error", "content": "Failed to restore session context."})
                self.tutor = None

        await self.safe_send({
            "type": "session_resumed",
            "session_id": resume_sid,
            "resume_type": resume_type,
            "problem_id": problem_id,
            "mode": mode,
            "last_editor_code": self.last_editor_code,
            "hint_count": session_data.get("hints_requested", 0),
            "interview_phase": self.tutor.interview_phase if self.tutor else None,
            "time_remaining": session_data.get("time_remaining"),
            "chat_history": chat_history,
            "whiteboard_state": session_data.get("whiteboard_state"),
        })
        logger.info("Cold resume (%s) for session %s", resume_type, resume_sid)

    async def handle_test_results_update(self, msg: dict) -> None:
        """Store test results where the tutor agent can read them on demand."""
        test_results = msg.get("test_results")
        code = msg.get("code")
        is_submit = msg.get("is_submit", False)

        if not test_results or not self.connection_workspace:
            return

        # Sync solution.py with the current code
        if code:
            self.last_editor_code = code
            (self.connection_workspace / "solution.py").write_text(code)

        # Write full results to test_results.json (agent can Read it)
        results_path = self.connection_workspace / "test_results.json"
        results_path.write_text(json.dumps(test_results, indent=2))

        # Set compact summary on tutor (included in state context)
        if self.tutor:
            passed = test_results.get("passed", 0)
            failed = test_results.get("failed", 0)
            total = passed + failed
            run_type = "submit" if is_submit else "run"
            self.tutor.last_test_summary = f"{passed}/{total} passed ({run_type})"

    async def handle_end_session(self, msg: dict) -> None:
        try:
            if self.tutor:
                await self.tutor.end_session()
                self.tutor = None
            self.current_session_id = None
            self.last_editor_code = None
            await self.session_logger.end_session()
        except Exception:
            logger.exception("Error handling end_session")
            self.tutor = None
            self.current_session_id = None
            self.last_editor_code = None
            await self.safe_send({"type": "error", "content": "An error occurred while ending the session."})

    # ------------------------------------------------------------------
    # Main loop & cleanup
    # ------------------------------------------------------------------

    # Dispatch table: message type -> handler method name
    _HANDLERS = {
        "start_session": "handle_start_session",
        "message": "handle_message",
        "time_update": "handle_time_update",
        "time_up": "handle_time_up",
        "request_hint": "handle_request_hint",
        "nudge_request": "handle_nudge_request",
        "resume_session": "handle_resume_session",
        "end_session": "handle_end_session",
        "test_results_update": "handle_test_results_update",
    }

    async def run(self) -> None:
        """Main message loop — dispatches to handler methods."""
        try:
            while True:
                data = await self.ws.receive_text()

                try:
                    msg = json.loads(data)
                except (json.JSONDecodeError, ValueError) as e:
                    logger.warning("Malformed JSON from client: %s", e)
                    await self.ws.send_json({"type": "error", "content": "Invalid message format."})
                    continue

                msg_type = msg.get("type")
                if not msg_type:
                    await self.ws.send_json({"type": "error", "content": "Missing message type."})
                    continue

                # Track real user activity (exclude automated/passive messages)
                if msg_type not in ("nudge_request", "test_results_update"):
                    self._last_real_activity = time.time()

                handler_name = self._HANDLERS.get(msg_type)
                if not handler_name:
                    await self.ws.send_json({"type": "error", "content": f"Unknown message type: {msg_type}"})
                    continue

                try:
                    await getattr(self, handler_name)(msg)
                except Exception:
                    logger.exception("Unexpected error handling message type=%s", msg_type)
                    try:
                        await self.ws.send_json({"type": "error", "content": "An internal error occurred."})
                    except Exception:
                        pass
        except (WebSocketDisconnect, RuntimeError):
            pass

    async def cleanup(self) -> None:
        """Park or tear down the tutor and workspace on disconnect."""
        if self.tutor and self.current_session_id:
            try:
                problem_id = self.session_logger.current_session.get("problem_id") if self.session_logger.current_session else None
                mode = self.session_logger.current_session.get("mode") if self.session_logger.current_session else None
                if problem_id and mode and mode != "pattern-quiz":
                    parked = ParkedTutor(
                        tutor=self.tutor,
                        session_logger=self.session_logger,
                        workspace_path=str(self.connection_workspace) if self.connection_workspace else "",
                        problem_id=problem_id,
                        mode=mode,
                        claude_session_id=self.tutor.claude_session_id,
                        last_editor_code=self.last_editor_code,
                        hint_count=self.tutor.hint_count,
                        interview_phase=self.tutor.interview_phase,
                        time_remaining=self.tutor.time_remaining,
                    )
                    await self.tutor_registry.park(self.current_session_id, parked)
                    logger.info("Parked tutor for session %s", self.current_session_id)
                    return  # Don't clean up — registry owns it now
            except Exception:
                logger.exception("Failed to park tutor, falling back to cleanup")

        # Tear down tutor if it exists (either parking failed or no session ID)
        if self.tutor:
            try:
                await self.tutor.end_session()
            except Exception:
                logger.exception("tutor end_session failed during cleanup")

        try:
            await self.session_logger.end_session()
        except Exception:
            logger.exception("session_logger end_session failed during cleanup")

        try:
            if self.connection_workspace and self.connection_workspace.exists():
                shutil.rmtree(self.connection_workspace, ignore_errors=True)
        except Exception:
            logger.exception("workspace cleanup failed")


# ------------------------------------------------------------------
# FastAPI endpoint — this is what server.py mounts at /ws/chat
# ------------------------------------------------------------------

async def websocket_chat(
    websocket: WebSocket,
    *,
    sessions_dir: str,
    workspace_dir: Path,
    tutor_registry: TutorRegistry,
    problem_history: ProblemHistory,
    api_session_logger: SessionLogger,
) -> None:
    """WebSocket endpoint handler for /ws/chat."""
    await websocket.accept()

    # Auth: first message must be an auth message
    try:
        first_raw = await websocket.receive_text()
        first_msg = json.loads(first_raw)
    except (json.JSONDecodeError, ValueError, WebSocketDisconnect):
        await websocket.close(code=4001, reason="Unauthorized")
        return

    if AUTH_ENABLED:
        if first_msg.get("type") != "auth" or not verify_token(first_msg.get("token")):
            await websocket.close(code=4001, reason="Unauthorized")
            return

    session = WebSocketSession(
        websocket,
        sessions_dir=sessions_dir,
        workspace_dir=workspace_dir,
        tutor_registry=tutor_registry,
        problem_history=problem_history,
        api_session_logger=api_session_logger,
    )
    try:
        await session.run()
    finally:
        await session.cleanup()
