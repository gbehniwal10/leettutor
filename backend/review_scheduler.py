"""Leitner-style spaced-review scheduler.

Determines which topics are due for review based on
:class:`~backend.learning_history.LearningHistory` data.

Topics advance through boxes with expanding intervals::

    Box 0 → 1 day     (new topic)
    Box 1 → 2 days
    Box 2 → 5 days
    Box 3 → 14 days
    Box 4 → 30 days
    Box 5 → 90 days   (mastered)

A topic advances on a successful review, and drops back on failure or
when overdue by more than ``OVERDUE_PENALTY_FACTOR × interval``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SPACING_INTERVALS: list[int] = [1, 2, 5, 14, 30, 90]  # days per box
MAX_BOX: int = len(SPACING_INTERVALS) - 1

OVERDUE_PENALTY_FACTOR: float = 2.0
"""Drop a box if overdue by more than this multiple of the interval."""

REVIEW_RATIO_DEFAULT: float = 0.4
"""Default fraction of problems that should be reviews in mixed mode."""

MAX_CONSECUTIVE_REVIEW: int = 2

_SCHEDULER_FILENAME = "review_scheduler.json"

# Priority weights
_OVERDUE_WEIGHT = 0.5
_BOX_WEIGHT = 0.3
_COMPETENCE_WEIGHT = 0.2


class ReviewScheduler:
    """Persistent Leitner-box scheduler.

    Box state is stored in ``{data_dir}/review_scheduler.json``.
    """

    def __init__(self, data_dir: str) -> None:
        self._data_dir = Path(data_dir)
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._filepath = self._data_dir / _SCHEDULER_FILENAME
        # {topic: {"box": int, "last_reviewed": iso-str | None}}
        self._boxes: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    async def load(self) -> None:
        data = await asyncio.to_thread(self._load_sync)
        if data is not None:
            self._boxes = data

    def _load_sync(self) -> dict | None:
        if not self._filepath.exists():
            return None
        try:
            with open(self._filepath) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            logger.warning("Failed to load scheduler state from %s", self._filepath)
            return None

    async def _save(self) -> None:
        await asyncio.to_thread(self._save_sync)

    def _save_sync(self) -> None:
        tmp_fd, tmp_path = tempfile.mkstemp(dir=self._data_dir, suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "w") as f:
                json.dump(self._boxes, f, indent=2)
            os.replace(tmp_path, self._filepath)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    # ------------------------------------------------------------------
    # Box transitions
    # ------------------------------------------------------------------

    async def record_review(self, topic: str, *, success: bool) -> None:
        """Record a review outcome: advance on success, demote on failure."""
        async with self._lock:
            entry = self._boxes.setdefault(topic, {"box": 0, "last_reviewed": None})
            if success:
                entry["box"] = min(entry["box"] + 1, MAX_BOX)
            else:
                entry["box"] = max(entry["box"] - 1, 0)
            entry["last_reviewed"] = datetime.now().isoformat()
            await self._save()

    async def ensure_topic(self, topic: str) -> None:
        """Ensure *topic* has a box entry (box 0) if it doesn't already exist."""
        async with self._lock:
            if topic not in self._boxes:
                self._boxes[topic] = {"box": 0, "last_reviewed": None}
                await self._save()

    def _apply_overdue_penalty(self, entry: dict) -> int:
        """Return the effective box after applying overdue demotion."""
        box = entry["box"]
        last = entry.get("last_reviewed")
        if not last or box == 0:
            return box
        try:
            last_dt = datetime.fromisoformat(last)
        except (ValueError, TypeError):
            return box
        days_since = (datetime.now() - last_dt).days
        interval = SPACING_INTERVALS[box]
        if days_since > interval * OVERDUE_PENALTY_FACTOR:
            return max(box - 1, 0)
        return box

    # ------------------------------------------------------------------
    # Due topics
    # ------------------------------------------------------------------

    def get_due_topics(
        self,
        competence_map: dict[str, int] | None = None,
    ) -> list[dict]:
        """Return topics due for review, sorted by priority (descending).

        Topics in box 0 that have never been reviewed are excluded — they
        are "new", not "review" topics.
        """
        now = datetime.now()
        competence_map = competence_map or {}
        due: list[dict] = []

        for topic, entry in self._boxes.items():
            box = self._apply_overdue_penalty(entry)
            last = entry.get("last_reviewed")
            if last is None:
                # Never reviewed → new topic, not a review candidate
                continue

            try:
                last_dt = datetime.fromisoformat(last)
            except (ValueError, TypeError):
                continue
            days_since = (now - last_dt).days
            interval = SPACING_INTERVALS[box]
            days_overdue = days_since - interval
            if days_overdue < 0:
                continue  # not due yet

            priority = self._compute_priority(
                box, days_overdue, interval, competence_map.get(topic, 0),
            )
            due.append({
                "topic": topic,
                "box": box,
                "days_overdue": days_overdue,
                "priority": round(priority, 3),
            })

        due.sort(key=lambda d: d["priority"], reverse=True)
        return due

    def get_due_problems(
        self,
        available_problems: list[dict],
        competence_map: dict[str, int] | None = None,
    ) -> list[dict]:
        """Map due topics to specific problems from the static pool.

        For each due topic, find matching problems by tag.  Prefer
        problems the student hasn't solved on that topic; fall back
        to the one solved longest ago for true spaced retrieval.

        Returns a list of ``{"problem_id", "topic", "box", "priority",
        "days_overdue"}`` dicts.
        """
        due_topics = self.get_due_topics(competence_map)
        if not due_topics:
            return []

        # Build tag → [problem] index
        tag_index: dict[str, list[dict]] = {}
        for p in available_problems:
            for tag in p.get("tags", []):
                tag_index.setdefault(tag, []).append(p)

        seen_ids: set[str] = set()
        result: list[dict] = []

        for due in due_topics:
            topic = due["topic"]
            candidates = tag_index.get(topic, [])
            if not candidates:
                continue

            # Prefer unsolved problems
            unsolved = [p for p in candidates if p["id"] not in seen_ids
                        and p.get("status", "unsolved") != "solved"]
            if unsolved:
                chosen = unsolved[0]
            else:
                # All solved — pick one we haven't already queued
                remaining = [p for p in candidates if p["id"] not in seen_ids]
                if not remaining:
                    continue
                # Sort by last_solved_at ascending (oldest first = best for review)
                remaining.sort(key=lambda p: p.get("last_solved_at") or "")
                chosen = remaining[0]

            seen_ids.add(chosen["id"])
            result.append({
                "problem_id": chosen["id"],
                "topic": topic,
                "box": due["box"],
                "priority": due["priority"],
                "days_overdue": due["days_overdue"],
            })

        return result

    @staticmethod
    def _compute_priority(
        box: int,
        days_overdue: int,
        interval: int,
        competence: int,
    ) -> float:
        """Compute a 0-1 priority score.

        Higher = more urgent.
        - overdue_score: how overdue relative to the interval (capped at 1)
        - box_score: lower boxes → higher urgency (fragile knowledge)
        - competence_score: lower competence → higher urgency
        """
        overdue_score = min(days_overdue / max(interval, 1), 1.0)
        box_score = 1.0 - (box / MAX_BOX)
        competence_score = 1.0 - (competence / 3.0)
        return (
            _OVERDUE_WEIGHT * overdue_score
            + _BOX_WEIGHT * box_score
            + _COMPETENCE_WEIGHT * competence_score
        )

    # ------------------------------------------------------------------
    # Session plan
    # ------------------------------------------------------------------

    def get_session_plan(
        self,
        requested_problem_id: str | None = None,
        problem_tags: list[str] | None = None,
        competence_map: dict[str, int] | None = None,
    ) -> dict:
        """Suggest what to practice and which review topics to interleave.

        Returns::

            {
                "primary": "two-sum",
                "is_review": False,
                "review_queue": [{"topic": "binary-search", ...}, ...],
                "suggested_mix": {"primary_ratio": 0.6, "review_ratio": 0.4},
            }
        """
        due = self.get_due_topics(competence_map)
        review_topics = [d["topic"] for d in due]

        if requested_problem_id:
            # User selected a specific problem — filter its tags out of review queue
            exclude_tags = set(problem_tags or [])
            review_queue = [d for d in due if d["topic"] not in exclude_tags]
            return {
                "primary": requested_problem_id,
                "is_review": False,
                "review_queue": review_queue,
                "suggested_mix": {
                    "primary_ratio": 1.0 - REVIEW_RATIO_DEFAULT,
                    "review_ratio": REVIEW_RATIO_DEFAULT,
                },
            }

        # No specific problem requested — pick the highest-priority due topic
        if review_topics:
            primary_topic = review_topics[0]
            review_queue = [d for d in due[1:]]
            return {
                "primary": primary_topic,
                "is_review": True,
                "review_queue": review_queue,
                "suggested_mix": {
                    "primary_ratio": 0.0,
                    "review_ratio": 1.0,
                },
            }

        # Nothing due
        return {
            "primary": None,
            "is_review": False,
            "review_queue": [],
            "suggested_mix": {
                "primary_ratio": 1.0,
                "review_ratio": 0.0,
            },
        }
