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
from .solution_store import SolutionStore
from .tutor import LeetCodeTutor, build_nudge_message, RESUBMIT_AFTER_SOLVE_PROMPT
from .tutor_registry import TutorRegistry, ParkedTutor
from .problem_history import ProblemHistory
from .learning_history import LearningHistory
from .review_scheduler import ReviewScheduler
from .ws_constants import (
    MSG_AUTH,
    MSG_START_SESSION,
    MSG_MESSAGE,
    MSG_REQUEST_HINT,
    MSG_RESUME_SESSION,
    MSG_END_SESSION,
    MSG_TIME_UPDATE,
    MSG_TIME_UP,
    MSG_NUDGE_REQUEST,
    MSG_TEST_RESULTS_UPDATE,
    MSG_SAVE_STATE,
    MSG_APPROACH_RESOLVE,
    MSG_SESSION_STARTED,
    MSG_SESSION_RESUMED,
    MSG_ASSISTANT_CHUNK,
    MSG_ASSISTANT_MESSAGE,
    MSG_ERROR,
    MSG_REVIEW_PHASE_STARTED,
    MSG_APPROACH_CLASSIFIED,
    MSG_APPROACH_DUPLICATE,
    MSG_SOLUTION_COUNT_UPDATED,
    ERR_NO_ACTIVE_SESSION,
    ERR_INVALID_RESOLVE,
    ERR_RESOLVE_FAILED,
)

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
        learning_history: LearningHistory | None = None,
        review_scheduler: ReviewScheduler | None = None,
        api_session_logger: SessionLogger,
        solution_store: SolutionStore | None = None,
    ):
        self.ws = websocket
        self.sessions_dir = sessions_dir
        self.workspace_dir = workspace_dir
        self.tutor_registry = tutor_registry
        self.problem_history = problem_history
        self.learning_history = learning_history
        self.review_scheduler = review_scheduler
        self.api_session_logger = api_session_logger
        self.solution_store = solution_store

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
            if not await self.safe_send({"type": MSG_ASSISTANT_CHUNK, "content": chunk}):
                break
        await self.safe_send({"type": MSG_ASSISTANT_MESSAGE, "content": full_response})
        await self.session_logger.log_message(log_as, full_response)
        if self.tutor and self.tutor.claude_session_id:
            await self.session_logger.update_claude_session_id(self.tutor.claude_session_id)
        return full_response

    async def _write_solutions_summary(self, problem_id: str) -> None:
        """Write solutions_summary.json to workspace if solutions exist."""
        if not self.solution_store or not self.connection_workspace:
            return
        try:
            summary = await self.solution_store.get_solutions_summary(problem_id)
            if summary:
                path = self.connection_workspace / "solutions_summary.json"
                path.write_text(json.dumps(summary, indent=2))
        except Exception:
            logger.debug("Failed to write solutions summary for %s", problem_id)

    async def _record_learning_history(self, *, solved: bool) -> None:
        """Record the current session's outcome in learning history and review scheduler."""
        if not self.learning_history or not self.session_logger.current_session:
            return
        session = self.session_logger.current_session
        problem_id = session.get("problem_id", "")
        difficulty = session.get("difficulty", "medium")
        problem = get_problem(problem_id)
        if not problem:
            return
        tags = problem.get("tags", [])
        hint_level = session.get("hints_requested", 0)
        submissions = session.get("code_submissions", [])
        attempt_count = len(submissions)

        for tag in tags:
            try:
                await self.learning_history.record_attempt(
                    topic=tag,
                    problem_id=problem_id,
                    difficulty=difficulty,
                    solved=solved,
                    hint_level=hint_level,
                    attempts=attempt_count,
                )
            except Exception:
                logger.exception("Failed to record learning history for topic %s", tag)

            if self.review_scheduler:
                try:
                    await self.review_scheduler.ensure_topic(tag)
                    if solved:
                        await self.review_scheduler.record_review(tag, success=True)
                except Exception:
                    logger.exception("Failed to update review scheduler for topic %s", tag)

    # ------------------------------------------------------------------
    # Message handlers
    # ------------------------------------------------------------------

    async def handle_start_session(self, msg: dict) -> None:
        problem_id = msg.get("problem_id")
        mode = msg.get("mode")
        if not problem_id or not mode:
            await self.ws.send_json({"type": MSG_ERROR, "content": "Missing required fields for start_session."})
            return

        # Clean up previous tutor session
        if self.tutor:
            await self.tutor.end_session()
            await self.session_logger.end_session()

        problem = get_problem(problem_id)
        if not problem:
            await self.ws.send_json({"type": MSG_ERROR, "content": "Problem not found"})
            return

        sid = await self.session_logger.start_session(problem_id, mode)
        self.current_session_id = sid
        self.last_editor_code = None
        if mode != "pattern-quiz":
            await self.problem_history.record_attempt(problem_id)
        await self.ws.send_json({"type": MSG_SESSION_STARTED, "session_id": sid})

        # Clean up previous workspace if switching sessions
        if self.connection_workspace and self.connection_workspace.exists():
            shutil.rmtree(self.connection_workspace, ignore_errors=True)

        self.connection_workspace = self.workspace_dir / sid
        self.connection_workspace.mkdir(parents=True, exist_ok=True)

        # Write solutions summary so the tutor can reference past approaches
        await self._write_solutions_summary(problem_id)

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
                "type": MSG_ASSISTANT_MESSAGE,
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
                await self.safe_send({"type": MSG_ERROR, "content": "An error occurred while processing your message."})
        else:
            await self.safe_send({
                "type": MSG_ASSISTANT_MESSAGE,
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
            await self.safe_send({"type": MSG_ERROR, "content": "An error occurred while updating time."})

    async def handle_time_up(self, msg: dict) -> None:
        code = msg.get("code")
        if self.tutor and self.tutor.mode == "interview" and self.tutor.interview_phase != "review":
            await self.session_logger.log_phase_transition("review")
            self.tutor.update_time(0)
            try:
                async with self._chat_lock:
                    await self._stream_tutor_response(self.tutor.enter_review_phase(code=code))
                    await self.safe_send({"type": MSG_REVIEW_PHASE_STARTED})
            except Exception:
                logger.exception("Error during review phase")
                await self.safe_send({"type": MSG_ERROR, "content": "An error occurred while entering review phase."})

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
                await self.safe_send({"type": MSG_ERROR, "content": "An error occurred while generating a hint."})
        else:
            # Fallback to static hints
            problem = get_problem(self.session_logger.current_session["problem_id"]) if self.session_logger.current_session else None
            if problem:
                hint_idx = min(self.session_logger.current_session["hints_requested"], len(problem["hints"]) - 1)
                await self.safe_send({
                    "type": MSG_ASSISTANT_MESSAGE,
                    "content": f"**Hint:** {problem['hints'][hint_idx]}",
                })
                await self.session_logger.log_hint_requested()

    async def handle_nudge_request(self, msg: dict) -> None:
        # Server-side guards
        if self.tutor and self.tutor.solved:
            logger.debug("Ignoring nudge_request: problem already solved")
            return
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
                        if not await self.safe_send({"type": MSG_ASSISTANT_CHUNK, "content": chunk}):
                            break
                    await self.safe_send({"type": MSG_ASSISTANT_MESSAGE, "content": full_response, "nudge": True})
                    await self.session_logger.log_message("assistant", full_response)
                    if self.tutor.claude_session_id:
                        await self.session_logger.update_claude_session_id(self.tutor.claude_session_id)
            except Exception:
                logger.exception("Error during nudge")
                await self.safe_send({"type": MSG_ERROR, "content": "An error occurred while generating a nudge."})

    async def handle_resume_session(self, msg: dict) -> None:
        resume_sid = msg.get("session_id")
        if not resume_sid or not _is_valid_session_id(resume_sid):
            await self.safe_send({"type": MSG_ERROR, "content": "Invalid session ID for resume."})
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
            "type": MSG_SESSION_RESUMED,
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
            await self.safe_send({"type": MSG_ERROR, "content": "Session not found."})
            return

        problem_id = session_data.get("problem_id")
        mode = session_data.get("mode")
        if mode == "pattern-quiz":
            await self.safe_send({"type": MSG_ERROR, "content": "Pattern quiz sessions cannot be resumed."})
            return

        problem = get_problem(problem_id)
        if not problem:
            await self.safe_send({"type": MSG_ERROR, "content": "Problem not found for this session."})
            return

        resumed = await self.session_logger.resume_session(resume_sid)
        if not resumed:
            await self.safe_send({"type": MSG_ERROR, "content": "Failed to reopen session."})
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
                await self.safe_send({"type": MSG_ERROR, "content": "Failed to restore session context."})
                self.tutor = None

        await self.safe_send({
            "type": MSG_SESSION_RESUMED,
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

        if not test_results:
            return
        if not self.connection_workspace or not self.tutor:
            # No active session — send an error so the frontend can clear
            # its typing indicator instead of spinning forever.
            if is_submit and test_results.get("failed", 1) == 0:
                await self.safe_send({
                    "type": MSG_ERROR,
                    "code": ERR_NO_ACTIVE_SESSION,
                    "content": "Tutor session is not active. Please select a problem to start a new session.",
                })
            return

        # Sync solution.py with the current code
        if code:
            self.last_editor_code = code
            (self.connection_workspace / "solution.py").write_text(code)

        # Write full results to test_results.json (agent can Read it)
        results_path = self.connection_workspace / "test_results.json"
        results_path.write_text(json.dumps(test_results, indent=2))

        # Persist code submission to session JSON
        if code and self.current_session_id:
            await self.session_logger.log_code_submission(code, test_results)

        # Set compact summary on tutor (included in state context)
        if self.tutor:
            passed = test_results.get("passed", 0)
            failed = test_results.get("failed", 0)
            total = passed + failed
            run_type = "submit" if is_submit else "run"
            self.tutor.last_test_summary = f"{passed}/{total} passed ({run_type})"

        # Auto-respond on successful submission
        saved_solution_id = msg.get("saved_solution_id")
        logger.info(
            "test_results_update: is_submit=%s, failed=%s, tutor=%s, solved=%s, saved_sol=%s",
            is_submit, test_results.get("failed"), self.tutor is not None,
            self.tutor.solved if self.tutor else "N/A", saved_solution_id,
        )
        if (
            is_submit
            and test_results.get("failed", 1) == 0
            and self.tutor
        ):
            if not self.tutor.solved:
                # First successful submission
                try:
                    async with self._chat_lock:
                        if self.tutor.mode == "interview" and self.tutor.interview_phase != "review":
                            # Interview mode: transition to review phase
                            await self.session_logger.log_phase_transition("review")
                            await self._stream_tutor_response(
                                self.tutor.enter_review_phase(code=code)
                            )
                            await self.safe_send({"type": MSG_REVIEW_PHASE_STARTED})
                            self.tutor.solved = True
                        else:
                            # Learning mode: congratulate and ask follow-ups
                            await self._stream_tutor_response(
                                self.tutor.auto_congratulate(code=code)
                            )
                except Exception:
                    logger.exception("Error during auto-congratulate on solve")

                # Record in learning history and review scheduler
                await self._record_learning_history(solved=True)
            else:
                # Re-submission after already solved — acknowledge the update
                try:
                    async with self._chat_lock:
                        await self._stream_tutor_response(
                            self.tutor.chat(RESUBMIT_AFTER_SOLVE_PROMPT, code=code)
                        )
                except Exception:
                    logger.exception("Error during post-solve resubmit response")

            # Classify approach after successful solve
            await self._classify_and_notify(code, saved_solution_id)

    async def _classify_and_notify(
        self, code: str | None, saved_solution_id: str | None
    ) -> None:
        """Classify the solution approach and notify the frontend."""
        if not self.tutor or not self.solution_store or not saved_solution_id:
            return
        problem_id = (
            self.session_logger.current_session.get("problem_id")
            if self.session_logger.current_session
            else None
        )
        if not problem_id:
            return

        try:
            async with self._chat_lock:
                result = await self.tutor.classify_approach(code=code)
            if not result:
                return

            approach_name = result["name"]
            approach_complexity = result.get("complexity")

            await self.solution_store.update_approach(
                problem_id, saved_solution_id, approach_name,
                complexity=approach_complexity,
            )

            existing = await self.solution_store.find_by_approach(
                problem_id, approach_name, exclude_id=saved_solution_id
            )

            if existing:
                # Duplicate approach — let the user decide
                new_sol = await self.solution_store.get_solution(
                    problem_id, saved_solution_id
                )
                await self.safe_send({
                    "type": MSG_APPROACH_DUPLICATE,
                    "approach": approach_name,
                    "approach_complexity": approach_complexity,
                    "new_solution_id": saved_solution_id,
                    "existing_solution_id": existing["id"],
                    "new_runtime_ms": new_sol["avg_runtime_ms"] if new_sol else None,
                    "existing_runtime_ms": existing.get("avg_runtime_ms"),
                })
            else:
                await self.safe_send({
                    "type": MSG_APPROACH_CLASSIFIED,
                    "approach": approach_name,
                    "approach_complexity": approach_complexity,
                    "solution_id": saved_solution_id,
                })
                # Send authoritative count now that approach is set
                counts = await self.solution_store.get_solution_counts()
                count = counts.get(problem_id, 0)
                await self.safe_send({
                    "type": MSG_SOLUTION_COUNT_UPDATED,
                    "problem_id": problem_id,
                    "count": count,
                })
        except Exception:
            logger.exception("Error during approach classification")

    async def handle_approach_resolve(self, msg: dict) -> None:
        """Handle the user's choice when a duplicate approach is detected."""
        problem_id = msg.get("problem_id")
        keep_id = msg.get("keep_id")
        discard_id = msg.get("discard_id")
        action = msg.get("action")

        if not all([problem_id, action]) or action not in ("replace", "keep_both", "discard_new"):
            await self.safe_send({
                "type": MSG_ERROR,
                "code": ERR_INVALID_RESOLVE,
                "content": "Invalid approach_resolve message.",
            })
            return

        if not self.solution_store:
            return

        try:
            if action == "replace" and discard_id:
                await self.solution_store.delete_solution(problem_id, discard_id)
            elif action == "discard_new" and discard_id:
                await self.solution_store.delete_solution(problem_id, discard_id)
            # "keep_both" → no-op

            # Send updated count
            counts = await self.solution_store.get_solution_counts()
            count = counts.get(problem_id, 0)
            await self.safe_send({
                "type": MSG_SOLUTION_COUNT_UPDATED,
                "problem_id": problem_id,
                "count": count,
            })
        except Exception:
            logger.exception("Error handling approach_resolve")
            await self.safe_send({
                "type": MSG_ERROR,
                "code": ERR_RESOLVE_FAILED,
                "content": "Failed to resolve approach duplicate.",
            })

    async def handle_save_state(self, msg: dict) -> None:
        """Periodic heartbeat from the frontend — persists editor code to session."""
        code = msg.get("code")
        if code and self.current_session_id:
            self.last_editor_code = code
            await self.session_logger.update_editor_code(code)
            if self.connection_workspace:
                (self.connection_workspace / "solution.py").write_text(code)

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
            await self.safe_send({"type": MSG_ERROR, "content": "An error occurred while ending the session."})

    # ------------------------------------------------------------------
    # Main loop & cleanup
    # ------------------------------------------------------------------

    # Dispatch table: message type -> handler method name
    _HANDLERS = {
        MSG_START_SESSION: "handle_start_session",
        MSG_MESSAGE: "handle_message",
        MSG_TIME_UPDATE: "handle_time_update",
        MSG_TIME_UP: "handle_time_up",
        MSG_REQUEST_HINT: "handle_request_hint",
        MSG_NUDGE_REQUEST: "handle_nudge_request",
        MSG_RESUME_SESSION: "handle_resume_session",
        MSG_END_SESSION: "handle_end_session",
        MSG_TEST_RESULTS_UPDATE: "handle_test_results_update",
        MSG_SAVE_STATE: "handle_save_state",
        MSG_APPROACH_RESOLVE: "handle_approach_resolve",
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
                    await self.ws.send_json({"type": MSG_ERROR, "content": "Invalid message format."})
                    continue

                msg_type = msg.get("type")
                if not msg_type:
                    await self.ws.send_json({"type": MSG_ERROR, "content": "Missing message type."})
                    continue

                # Track real user activity (exclude automated/passive messages)
                if msg_type not in (MSG_NUDGE_REQUEST, MSG_TEST_RESULTS_UPDATE, MSG_SAVE_STATE):
                    self._last_real_activity = time.time()

                handler_name = self._HANDLERS.get(msg_type)
                if not handler_name:
                    await self.ws.send_json({"type": MSG_ERROR, "content": f"Unknown message type: {msg_type}"})
                    continue

                try:
                    await getattr(self, handler_name)(msg)
                except Exception:
                    logger.exception("Unexpected error handling message type=%s", msg_type)
                    try:
                        await self.ws.send_json({"type": MSG_ERROR, "content": "An internal error occurred."})
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
    learning_history: LearningHistory | None = None,
    review_scheduler: ReviewScheduler | None = None,
    api_session_logger: SessionLogger,
    solution_store: SolutionStore | None = None,
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
        if first_msg.get("type") != MSG_AUTH or not verify_token(first_msg.get("token")):
            await websocket.close(code=4001, reason="Unauthorized")
            return

    session = WebSocketSession(
        websocket,
        sessions_dir=sessions_dir,
        workspace_dir=workspace_dir,
        tutor_registry=tutor_registry,
        problem_history=problem_history,
        learning_history=learning_history,
        review_scheduler=review_scheduler,
        api_session_logger=api_session_logger,
        solution_store=solution_store,
    )
    try:
        await session.run()
    finally:
        await session.cleanup()
