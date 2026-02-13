"""Solution storage — saves, deduplicates, and retrieves user solutions.

One JSON file per problem in ``solutions/{problem_id}.json``, each containing
an array of solution objects.  Follows the same atomic-write and path-validation
patterns used by ``session_logger.py`` and ``problem_history.py``.
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from uuid import uuid4

logger = logging.getLogger(__name__)

_PROBLEM_ID_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{0,98}[a-z0-9]$")
_SOLUTION_ID_RE = re.compile(r"^[0-9a-f]{8,}$")
_MAX_LABEL_LENGTH = 120
_MAX_SOLUTIONS_PER_PROBLEM = 50


def _is_valid_problem_id(pid: str) -> bool:
    return isinstance(pid, str) and bool(_PROBLEM_ID_RE.match(pid))


def _is_valid_solution_id(sid: str) -> bool:
    return isinstance(sid, str) and bool(_SOLUTION_ID_RE.match(sid))


def _normalize_code(code: str) -> str:
    """Strip trailing whitespace per line and trailing newlines for hashing."""
    lines = code.rstrip("\n").split("\n")
    return "\n".join(line.rstrip() for line in lines)


def _code_hash(code: str) -> str:
    return hashlib.sha256(_normalize_code(code).encode()).hexdigest()


class SolutionStore:
    def __init__(self, solutions_dir: str | Path = "solutions"):
        self.solutions_dir = Path(solutions_dir).resolve()
        self.solutions_dir.mkdir(exist_ok=True)
        self._lock = asyncio.Lock()

    def _filepath(self, problem_id: str) -> Path | None:
        if not _is_valid_problem_id(problem_id):
            return None
        fp = (self.solutions_dir / f"{problem_id}.json").resolve()
        if not fp.is_relative_to(self.solutions_dir):
            return None
        return fp

    def _read_sync(self, filepath: Path) -> list[dict]:
        if not filepath.exists():
            return []
        try:
            with open(filepath) as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except (json.JSONDecodeError, OSError):
            logger.warning("Corrupt solutions file: %s", filepath)
            return []

    def _write_sync(self, filepath: Path, solutions: list[dict]) -> None:
        filepath.parent.mkdir(parents=True, exist_ok=True)
        tmp_fd, tmp_path = tempfile.mkstemp(
            dir=str(self.solutions_dir), suffix=".tmp"
        )
        try:
            with os.fdopen(tmp_fd, "w") as f:
                json.dump(solutions, f, indent=2)
            os.replace(tmp_path, filepath)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    async def save_solution(
        self,
        problem_id: str,
        code: str,
        passed: int,
        total: int,
        avg_runtime_ms: float,
        mode: str = "",
        session_id: str = "",
    ) -> dict:
        """Save a solution. Returns the solution dict (existing if deduplicated)."""
        filepath = self._filepath(problem_id)
        if filepath is None:
            raise ValueError(f"Invalid problem_id: {problem_id}")

        code_digest = _code_hash(code)

        async with self._lock:
            solutions = await asyncio.to_thread(self._read_sync, filepath)

            # Deduplicate: return existing solution if code hash matches
            for sol in solutions:
                if sol.get("code_hash") == code_digest:
                    return sol

            if len(solutions) >= _MAX_SOLUTIONS_PER_PROBLEM:
                raise ValueError("Maximum solutions per problem reached")

            solution = {
                "id": uuid4().hex,
                "code": code,
                "code_hash": code_digest,
                "timestamp": datetime.now().isoformat(),
                "passed": passed,
                "total": total,
                "avg_runtime_ms": round(avg_runtime_ms, 3),
                "label": "",
                "approach": None,
                "mode": mode,
                "session_id": session_id,
            }
            solutions.append(solution)
            await asyncio.to_thread(self._write_sync, filepath, solutions)
            return solution

    async def list_solutions(self, problem_id: str) -> list[dict]:
        filepath = self._filepath(problem_id)
        if filepath is None:
            return []
        async with self._lock:
            solutions = await asyncio.to_thread(self._read_sync, filepath)
        # Return without code field for list view (lighter payload)
        return [
            {k: v for k, v in sol.items() if k not in ("code", "code_hash")}
            for sol in solutions
        ]

    async def get_solution(self, problem_id: str, solution_id: str) -> dict | None:
        if not _is_valid_solution_id(solution_id):
            return None
        filepath = self._filepath(problem_id)
        if filepath is None:
            return None
        async with self._lock:
            solutions = await asyncio.to_thread(self._read_sync, filepath)
        for sol in solutions:
            if sol.get("id") == solution_id:
                return sol
        return None

    async def delete_solution(self, problem_id: str, solution_id: str) -> bool:
        if not _is_valid_solution_id(solution_id):
            return False
        filepath = self._filepath(problem_id)
        if filepath is None:
            return False
        async with self._lock:
            solutions = await asyncio.to_thread(self._read_sync, filepath)
            new_solutions = [s for s in solutions if s.get("id") != solution_id]
            if len(new_solutions) == len(solutions):
                return False
            await asyncio.to_thread(self._write_sync, filepath, new_solutions)
            return True

    async def update_label(
        self, problem_id: str, solution_id: str, label: str
    ) -> dict | None:
        if not _is_valid_solution_id(solution_id):
            return None
        if len(label) > _MAX_LABEL_LENGTH:
            raise ValueError("Label too long")
        filepath = self._filepath(problem_id)
        if filepath is None:
            return None
        async with self._lock:
            solutions = await asyncio.to_thread(self._read_sync, filepath)
            for sol in solutions:
                if sol.get("id") == solution_id:
                    sol["label"] = label
                    await asyncio.to_thread(self._write_sync, filepath, solutions)
                    return sol
        return None

    async def update_approach(
        self, problem_id: str, solution_id: str, approach: str,
        *, complexity: dict | None = None,
    ) -> dict | None:
        """Set the approach tag (and optional complexity) on a solution."""
        if not _is_valid_solution_id(solution_id):
            return None
        filepath = self._filepath(problem_id)
        if filepath is None:
            return None
        async with self._lock:
            solutions = await asyncio.to_thread(self._read_sync, filepath)
            for sol in solutions:
                if sol.get("id") == solution_id:
                    sol["approach"] = approach
                    if complexity:
                        sol["approach_complexity"] = complexity
                    await asyncio.to_thread(self._write_sync, filepath, solutions)
                    return sol
        return None

    async def find_by_approach(
        self, problem_id: str, approach: str, exclude_id: str | None = None
    ) -> dict | None:
        """Find an existing solution with the same approach tag."""
        filepath = self._filepath(problem_id)
        if filepath is None:
            return None
        async with self._lock:
            solutions = await asyncio.to_thread(self._read_sync, filepath)
        for sol in solutions:
            if sol.get("approach") == approach and sol.get("id") != exclude_id:
                return {k: v for k, v in sol.items() if k not in ("code", "code_hash")}
        return None

    async def get_solution_counts(self) -> dict[str, int]:
        """Return {problem_id: count} for all problems with solutions.

        Counts unique approaches (solutions with approach=None each count
        as their own bucket).
        """

        def _scan():
            counts = {}
            for fp in self.solutions_dir.glob("*.json"):
                resolved = fp.resolve()
                if not resolved.is_relative_to(self.solutions_dir):
                    continue
                try:
                    with open(resolved) as f:
                        data = json.load(f)
                    if isinstance(data, list) and data:
                        pid = fp.stem
                        # Count unique approaches; None-approach solutions each count individually
                        named = {s["approach"] for s in data if s.get("approach")}
                        unnamed = sum(1 for s in data if not s.get("approach"))
                        counts[pid] = len(named) + unnamed
                except (json.JSONDecodeError, OSError):
                    continue
            return counts

        async with self._lock:
            return await asyncio.to_thread(_scan)

    async def get_solutions_summary(self, problem_id: str) -> dict | None:
        """Return a compact summary for the tutor workspace file."""
        filepath = self._filepath(problem_id)
        if filepath is None:
            return None
        async with self._lock:
            solutions = await asyncio.to_thread(self._read_sync, filepath)
        if not solutions:
            return None
        runtimes = [s["avg_runtime_ms"] for s in solutions if s.get("avg_runtime_ms")]
        approaches = [s.get("approach") or s.get("label", "") for s in solutions]
        return {
            "solution_count": len(solutions),
            "best_avg_runtime_ms": min(runtimes) if runtimes else None,
            "approaches_tried": approaches,
        }
