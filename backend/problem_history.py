import asyncio
import json
import logging
import os
import tempfile
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)


class ProblemHistory:
    def __init__(self, filepath: str | Path):
        self.filepath = Path(filepath).resolve()
        self._data: dict[str, dict] = {}
        self._lock = asyncio.Lock()
        self._load_sync()

    def _load_sync(self):
        """Synchronous load — called from __init__ and via asyncio.to_thread()."""
        if self.filepath.exists():
            try:
                with open(self.filepath) as f:
                    self._data = json.load(f)
            except (json.JSONDecodeError, OSError):
                logger.warning("Corrupt problem_history.json, starting fresh")
                self._data = {}

    def _save_sync(self):
        """Synchronous save — must be called via asyncio.to_thread()."""
        self.filepath.parent.mkdir(parents=True, exist_ok=True)
        tmp_fd, tmp_path = tempfile.mkstemp(
            dir=str(self.filepath.parent), suffix=".tmp"
        )
        try:
            with os.fdopen(tmp_fd, "w") as f:
                json.dump(self._data, f, indent=2)
            os.replace(tmp_path, self.filepath)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    async def _load(self):
        await asyncio.to_thread(self._load_sync)

    async def _save(self):
        await asyncio.to_thread(self._save_sync)

    async def record_attempt(self, problem_id: str):
        async with self._lock:
            now = datetime.now().isoformat()
            entry = self._data.get(problem_id, {
                "status": "attempted",
                "last_attempted_at": None,
                "last_solved_at": None,
                "attempt_count": 0,
                "solve_count": 0,
            })
            entry["attempt_count"] = entry.get("attempt_count", 0) + 1
            entry["last_attempted_at"] = now
            if entry.get("solve_count", 0) > 0:
                entry["status"] = "solved"
            else:
                entry["status"] = "attempted"
            self._data[problem_id] = entry
            await self._save()

    async def record_solve(self, problem_id: str):
        async with self._lock:
            now = datetime.now().isoformat()
            entry = self._data.get(problem_id, {
                "status": "solved",
                "last_attempted_at": None,
                "last_solved_at": None,
                "attempt_count": 0,
                "solve_count": 0,
            })
            entry["solve_count"] = entry.get("solve_count", 0) + 1
            entry["last_solved_at"] = now
            entry["status"] = "solved"
            # Also count as an attempt if not already counted this session
            if not entry.get("last_attempted_at"):
                entry["attempt_count"] = entry.get("attempt_count", 0) + 1
                entry["last_attempted_at"] = now
            self._data[problem_id] = entry
            await self._save()

    async def get_all(self) -> dict[str, dict]:
        async with self._lock:
            return dict(self._data)

    async def get(self, problem_id: str) -> dict | None:
        async with self._lock:
            return self._data.get(problem_id)
