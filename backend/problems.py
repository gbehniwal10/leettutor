import json
import random
from pathlib import Path

PROBLEMS_DIR = Path(__file__).parent / "problems"


def _load_problems():
    problems = {}
    for f in PROBLEMS_DIR.glob("*.json"):
        p = json.loads(f.read_text(encoding="utf-8"))
        problems[p["id"]] = p
    return problems


PROBLEMS = _load_problems()


def get_problem(problem_id: str) -> dict | None:
    return PROBLEMS.get(problem_id)


def list_problems() -> list[dict]:
    return [
        {"id": p["id"], "title": p["title"], "difficulty": p["difficulty"], "tags": p["tags"]}
        for p in PROBLEMS.values()
    ]


def get_random_problem(difficulty: str = None, tags: list[str] = None) -> dict:
    candidates = list(PROBLEMS.values())
    if difficulty:
        candidates = [p for p in candidates if p["difficulty"] == difficulty]
    if tags:
        candidates = [p for p in candidates if any(t in p["tags"] for t in tags)]
    return random.choice(candidates) if candidates else None
