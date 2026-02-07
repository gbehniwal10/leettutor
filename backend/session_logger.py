import asyncio
import json
import logging
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from uuid import uuid4

logger = logging.getLogger(__name__)

_SESSION_ID_RE = re.compile(r"^[0-9a-f]{8,}$")


def _is_valid_session_id(session_id: str) -> bool:
    return isinstance(session_id, str) and bool(_SESSION_ID_RE.match(session_id))


class SessionLogger:
    def __init__(self, sessions_dir: str = "sessions"):
        self.sessions_dir = Path(sessions_dir).resolve()
        self.sessions_dir.mkdir(exist_ok=True)
        self.current_session = None

    async def start_session(self, problem_id: str, mode: str) -> str:
        session_id = uuid4().hex
        self.current_session = {
            "session_id": session_id,
            "problem_id": problem_id,
            "mode": mode,
            "started_at": datetime.now().isoformat(),
            "ended_at": None,
            "duration_seconds": None,
            "hints_requested": 0,
            "code_submissions": [],
            "chat_history": [],
            "final_result": None,
            "notes": "",
            "phase_transitions": [],
        }
        await self._save()
        return session_id

    async def log_message(self, role: str, content: str):
        if not self.current_session:
            logger.warning("log_message called without an active session")
            return
        self.current_session["chat_history"].append(
            {"role": role, "content": content, "timestamp": datetime.now().isoformat()}
        )
        await self._save()

    async def log_code_submission(self, code: str, test_results: dict):
        if not self.current_session:
            logger.warning("log_code_submission called without an active session")
            return
        self.current_session["code_submissions"].append(
            {"code": code, "test_results": test_results, "timestamp": datetime.now().isoformat()}
        )
        await self._save()

    async def log_phase_transition(self, phase: str):
        if not self.current_session:
            logger.warning("log_phase_transition called without an active session")
            return
        self.current_session["phase_transitions"].append(
            {"phase": phase, "timestamp": datetime.now().isoformat()}
        )
        await self._save()

    async def log_hint_requested(self):
        if not self.current_session:
            logger.warning("log_hint_requested called without an active session")
            return
        self.current_session["hints_requested"] += 1
        await self._save()

    async def update_editor_code(self, code: str):
        """Update the last editor code for resume support."""
        if not self.current_session:
            return
        self.current_session["last_editor_code"] = code
        await self._save()

    async def update_time_remaining(self, seconds: int):
        """Store the interview timer for resume support."""
        if not self.current_session:
            return
        self.current_session["time_remaining"] = seconds
        await self._save()

    async def update_claude_session_id(self, claude_session_id: str):
        """Store the Claude SDK session ID for resume support."""
        if not self.current_session:
            return
        self.current_session["claude_session_id"] = claude_session_id
        await self._save()

    async def resume_session(self, session_id: str) -> dict | None:
        """Reopen a previously ended session. Returns session data or None."""
        if not _is_valid_session_id(session_id):
            return None
        filepath = (self.sessions_dir / f"{session_id}.json").resolve()
        if not filepath.is_relative_to(self.sessions_dir):
            return None
        if not filepath.exists():
            return None

        def _read():
            with open(filepath) as f:
                return json.load(f)

        try:
            data = await asyncio.to_thread(_read)
        except (json.JSONDecodeError, KeyError):
            logger.warning("Corrupt session file for resume: %s", filepath)
            return None
        # Reopen: clear ended_at so it's treated as active
        data["ended_at"] = None
        data["duration_seconds"] = None
        self.current_session = data
        await self._save()
        return data

    async def end_session(self, final_result: str = None, notes: str = ""):
        if not self.current_session:
            logger.warning("end_session called without an active session")
            return
        started = datetime.fromisoformat(self.current_session["started_at"])
        ended = datetime.now()
        self.current_session["ended_at"] = ended.isoformat()
        self.current_session["duration_seconds"] = (ended - started).total_seconds()
        self.current_session["final_result"] = final_result
        self.current_session["notes"] = notes
        await self._save()
        self.current_session = None

    def _save_sync(self):
        """Synchronous save — must be called via asyncio.to_thread()."""
        if not self.current_session:
            return
        filepath = self.sessions_dir / f"{self.current_session['session_id']}.json"
        tmp_fd, tmp_path = tempfile.mkstemp(dir=self.sessions_dir, suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "w") as f:
                json.dump(self.current_session, f, indent=2)
            os.replace(tmp_path, filepath)
        except BaseException:
            os.unlink(tmp_path)
            raise

    async def _save(self):
        await asyncio.to_thread(self._save_sync)

    async def find_latest_resumable_session(self, problem_id: str) -> dict | None:
        """Find the most recent resumable session for a given problem.

        Skips pattern-quiz sessions and sessions with no chat history
        and no claude_session_id (i.e. abandoned before any interaction).
        Returns a summary dict or None.
        """

        def _scan():
            best = None
            best_time = ""
            for filepath in self.sessions_dir.glob("*.json"):
                resolved = filepath.resolve()
                if not resolved.is_relative_to(self.sessions_dir):
                    continue
                try:
                    with open(resolved) as f:
                        data = json.load(f)
                    if data.get("problem_id") != problem_id:
                        continue
                    if data.get("mode") == "pattern-quiz":
                        continue
                    # Skip empty sessions (no interaction at all)
                    has_chat = len(data.get("chat_history", [])) > 0
                    has_claude = data.get("claude_session_id") is not None
                    if not has_chat and not has_claude:
                        continue
                    started = data.get("started_at", "")
                    if started > best_time:
                        best_time = started
                        best = {
                            "session_id": data["session_id"],
                            "problem_id": data["problem_id"],
                            "mode": data["mode"],
                            "started_at": data["started_at"],
                            "duration_seconds": data.get("duration_seconds"),
                        }
                except (json.JSONDecodeError, KeyError):
                    continue
            return best

        return await asyncio.to_thread(_scan)

    async def list_sessions(self) -> list[dict]:

        def _read_all():
            sessions = []
            for filepath in self.sessions_dir.glob("*.json"):
                resolved = filepath.resolve()
                if not resolved.is_relative_to(self.sessions_dir):
                    continue
                try:
                    with open(resolved) as f:
                        data = json.load(f)
                    sessions.append({
                        "session_id": data["session_id"],
                        "problem_id": data["problem_id"],
                        "mode": data["mode"],
                        "started_at": data["started_at"],
                        "duration_seconds": data["duration_seconds"],
                        "final_result": data["final_result"],
                    })
                except (json.JSONDecodeError, KeyError):
                    logger.warning("Skipping corrupt session file: %s", resolved)
                    continue
            return sorted(sessions, key=lambda x: x["started_at"], reverse=True)

        return await asyncio.to_thread(_read_all)

    async def delete_session(self, session_id: str) -> bool:
        """Delete a session file. Returns True if deleted, False if not found."""
        if not _is_valid_session_id(session_id):
            return False
        filepath = (self.sessions_dir / f"{session_id}.json").resolve()
        if not filepath.is_relative_to(self.sessions_dir):
            return False

        def _unlink():
            if filepath.exists():
                filepath.unlink()
                return True
            return False

        return await asyncio.to_thread(_unlink)

    async def get_session(self, session_id: str) -> dict | None:
        if not _is_valid_session_id(session_id):
            return None
        filepath = (self.sessions_dir / f"{session_id}.json").resolve()
        if not filepath.is_relative_to(self.sessions_dir):
            return None

        def _read():
            if filepath.exists():
                try:
                    with open(filepath) as f:
                        return json.load(f)
                except (json.JSONDecodeError, KeyError):
                    logger.warning("Corrupt session file: %s", filepath)
                    return None
            return None

        return await asyncio.to_thread(_read)

    async def patch_session(self, session_id: str, **updates) -> bool:
        """Atomically update fields on a session file.

        Used by REST endpoints that don't hold the session as current_session.
        Returns True if the session was found and updated.
        """
        if not _is_valid_session_id(session_id):
            return False
        filepath = (self.sessions_dir / f"{session_id}.json").resolve()
        if not filepath.is_relative_to(self.sessions_dir):
            return False

        def _patch():
            if not filepath.exists():
                return False
            with open(filepath) as f:
                data = json.load(f)
            data.update(updates)
            tmp_fd, tmp_path = tempfile.mkstemp(dir=str(self.sessions_dir), suffix=".tmp")
            try:
                with os.fdopen(tmp_fd, "w") as f:
                    json.dump(data, f, indent=2)
                os.replace(tmp_path, filepath)
            except BaseException:
                os.unlink(tmp_path)
                raise
            return True

        return await asyncio.to_thread(_patch)
