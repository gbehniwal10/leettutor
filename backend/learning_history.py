"""Persistent learning history — tracks all practice attempts per topic.

Records **every** attempt so the review scheduler can reason about
when topics were last practiced, how often, and how successfully.

Storage is a single JSON file with atomic writes
(``tempfile`` + ``os.replace``).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_HISTORY_FILENAME = "learning_history.json"
_SESSION_FILE_RE = re.compile(r"^[0-9a-f]{8,}$")

# Difficulty → numeric for averaging
_DIFFICULTY_MAP = {"easy": 1, "medium": 2, "hard": 3}


class LearningHistory:
    """Append-only per-topic attempt log with summary aggregation.

    Each topic maps to a list of attempt records.  The history is
    loaded at startup and saved after each ``record_attempt``.
    """

    def __init__(self, data_dir: str) -> None:
        self._data_dir = Path(data_dir)
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._filepath = self._data_dir / _HISTORY_FILENAME
        self._data: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    async def load(self) -> None:
        """Load history from disk.

        When no history file exists, backfill from session log files
        so that users who upgrade mid-use don't lose prior history.
        """
        data = await asyncio.to_thread(self._load_sync)
        if data is not None:
            self._data = data
        else:
            await asyncio.to_thread(self._backfill_from_sessions)

    def _load_sync(self) -> dict | None:
        if not self._filepath.exists():
            return None
        try:
            with open(self._filepath) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            logger.warning("Failed to load learning history from %s", self._filepath)
            return None

    async def _save(self) -> None:
        await asyncio.to_thread(self._save_sync)

    def _save_sync(self) -> None:
        tmp_fd, tmp_path = tempfile.mkstemp(dir=self._data_dir, suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "w") as f:
                json.dump(self._data, f, indent=2)
            os.replace(tmp_path, self._filepath)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def _backfill_from_sessions(self) -> None:
        """Populate learning history from existing session log files.

        Called once when no ``learning_history.json`` exists yet — e.g.
        after an upgrade adds the learning-history feature to a deployment
        that already has session logs on disk.
        """
        logger.info("Backfilling learning history from session logs")
        files_processed = 0
        total_attempts = 0
        resolved_dir = self._data_dir.resolve()

        for path in self._data_dir.glob("*.json"):
            resolved = path.resolve()
            if not resolved.is_relative_to(resolved_dir):
                continue
            if not _SESSION_FILE_RE.match(path.stem):
                continue

            try:
                with open(resolved) as f:
                    data = json.load(f)
            except (json.JSONDecodeError, KeyError, TypeError):
                logger.debug("Skipping unreadable session file: %s", path.name)
                continue

            tags = data.get("problem", {}).get("tags", [])
            if not tags:
                logger.debug("Skipping session without tags: %s", path.name)
                continue

            problem_id = data.get("problem_id", "")
            difficulty = data.get("difficulty", "medium")
            solved = data.get("final_result") == "solved"
            time_to_solve = data.get("duration_seconds")
            hint_level = data.get("hints_requested", 0)
            attempts = len(data.get("code_submissions", []))
            timestamp = data.get("ended_at") or data.get("started_at")

            files_processed += 1
            for tag in tags:
                entry: dict = {
                    "problem_id": problem_id,
                    "difficulty": difficulty,
                    "solved": solved,
                    "time_to_solve": time_to_solve,
                    "hint_level": hint_level,
                    "attempts": attempts,
                    "timestamp": timestamp,
                }
                self._data.setdefault(tag, {"attempts": []})["attempts"].append(entry)
                total_attempts += 1

        # Sort each topic's attempts by timestamp
        for record in self._data.values():
            record["attempts"].sort(key=lambda a: a.get("timestamp", ""))

        # Save even if empty to prevent re-backfill on next load
        self._save_sync()
        topics_count = len(self._data)
        logger.info(
            "Backfilled %d attempts across %d topics from %d session files",
            total_attempts, topics_count, files_processed,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def record_attempt(
        self,
        topic: str,
        problem_id: str,
        difficulty: str,
        solved: bool,
        time_to_solve: float | None = None,
        hint_level: int = 0,
        attempts: int = 0,
    ) -> None:
        """Append an attempt record for *topic* and persist."""
        async with self._lock:
            record = self._data.setdefault(topic, {"attempts": []})
            now = datetime.now().isoformat()
            entry = {
                "problem_id": problem_id,
                "difficulty": difficulty,
                "solved": solved,
                "time_to_solve": time_to_solve,
                "hint_level": hint_level,
                "attempts": attempts,
                "timestamp": now,
            }
            record["attempts"].append(entry)
            await self._save()

    def get_topic_summary(self, topic: str) -> dict | None:
        """Return aggregated stats for *topic*, or ``None`` if unseen."""
        record = self._data.get(topic)
        if record is None:
            return None
        return self._summarize(record)

    def get_all_topic_summaries(self) -> dict[str, dict]:
        """Return ``{topic: summary}`` for every tracked topic."""
        return {t: self._summarize(r) for t, r in self._data.items()}

    def get_problem_history(self, problem_id: str) -> list[dict]:
        """Return all attempt records that involved *problem_id*."""
        results = []
        for topic, record in self._data.items():
            for attempt in record.get("attempts", []):
                if attempt.get("problem_id") == problem_id:
                    results.append({**attempt, "topic": topic})
        results.sort(key=lambda a: a.get("timestamp", ""))
        return results

    # ------------------------------------------------------------------
    # Aggregation
    # ------------------------------------------------------------------

    @staticmethod
    def _summarize(record: dict) -> dict:
        attempts = record.get("attempts", [])
        n = len(attempts)
        if n == 0:
            return {
                "total_attempts": 0,
                "solves": 0,
                "last_practiced": None,
                "last_solved": None,
                "avg_difficulty_numeric": 0,
                "hint_dependency": 0.0,
                "days_since_last": None,
            }

        solves = sum(1 for a in attempts if a.get("solved"))
        last_practiced = attempts[-1]["timestamp"]

        solved_timestamps = [a["timestamp"] for a in attempts if a.get("solved")]
        last_solved = solved_timestamps[-1] if solved_timestamps else None

        diffs = [_DIFFICULTY_MAP.get(a.get("difficulty", "medium"), 2) for a in attempts]
        avg_diff = sum(diffs) / n

        avg_hint = sum(a.get("hint_level", 0) for a in attempts) / n

        try:
            last_dt = datetime.fromisoformat(last_practiced)
            days_since = (datetime.now() - last_dt).days
        except (ValueError, TypeError):
            days_since = None

        return {
            "total_attempts": n,
            "solves": solves,
            "last_practiced": last_practiced,
            "last_solved": last_solved,
            "avg_difficulty_numeric": round(avg_diff, 2),
            "hint_dependency": round(avg_hint, 2),
            "days_since_last": days_since,
        }
