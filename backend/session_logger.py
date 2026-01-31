import json
from datetime import datetime
from pathlib import Path
from uuid import uuid4


class SessionLogger:
    def __init__(self, sessions_dir: str = "sessions"):
        self.sessions_dir = Path(sessions_dir)
        self.sessions_dir.mkdir(exist_ok=True)
        self.current_session = None

    def start_session(self, problem_id: str, mode: str) -> str:
        session_id = str(uuid4())[:8]
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
        self._save()
        return session_id

    def log_message(self, role: str, content: str):
        if not self.current_session:
            return
        self.current_session["chat_history"].append(
            {"role": role, "content": content, "timestamp": datetime.now().isoformat()}
        )
        self._save()

    def log_code_submission(self, code: str, test_results: dict):
        if not self.current_session:
            return
        self.current_session["code_submissions"].append(
            {"code": code, "test_results": test_results, "timestamp": datetime.now().isoformat()}
        )
        self._save()

    def log_phase_transition(self, phase: str):
        if not self.current_session:
            return
        self.current_session["phase_transitions"].append(
            {"phase": phase, "timestamp": datetime.now().isoformat()}
        )
        self._save()

    def log_hint_requested(self):
        if not self.current_session:
            return
        self.current_session["hints_requested"] += 1
        self._save()

    def end_session(self, final_result: str = None, notes: str = ""):
        if not self.current_session:
            return
        started = datetime.fromisoformat(self.current_session["started_at"])
        ended = datetime.now()
        self.current_session["ended_at"] = ended.isoformat()
        self.current_session["duration_seconds"] = (ended - started).total_seconds()
        self.current_session["final_result"] = final_result
        self.current_session["notes"] = notes
        self._save()
        self.current_session = None

    def _save(self):
        if not self.current_session:
            return
        filepath = self.sessions_dir / f"{self.current_session['session_id']}.json"
        with open(filepath, "w") as f:
            json.dump(self.current_session, f, indent=2)

    def list_sessions(self) -> list[dict]:
        sessions = []
        for filepath in self.sessions_dir.glob("*.json"):
            with open(filepath) as f:
                data = json.load(f)
                sessions.append({
                    "session_id": data["session_id"],
                    "problem_id": data["problem_id"],
                    "mode": data["mode"],
                    "started_at": data["started_at"],
                    "duration_seconds": data["duration_seconds"],
                    "final_result": data["final_result"],
                })
        return sorted(sessions, key=lambda x: x["started_at"], reverse=True)

    def get_session(self, session_id: str) -> dict | None:
        filepath = self.sessions_dir / f"{session_id}.json"
        if filepath.exists():
            with open(filepath) as f:
                return json.load(f)
        return None
