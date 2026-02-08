import json
import logging
import random
from pathlib import Path

logger = logging.getLogger(__name__)

PROBLEMS_DIR = Path(__file__).parent / "problems"
_SKILL_TREE_FILE = PROBLEMS_DIR / "skill-tree.json"

# ---------------------------------------------------------------------------
# Problem loading
# ---------------------------------------------------------------------------

def _load_problems():
    problems = {}
    for f in PROBLEMS_DIR.glob("*.json"):
        if f.name == "skill-tree.json":
            continue
        try:
            p = json.loads(f.read_text(encoding="utf-8"))
            problems[p["id"]] = p
        except (KeyError, json.JSONDecodeError) as exc:
            logger.warning("Skipping %s: %s", f.name, exc)
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


# ---------------------------------------------------------------------------
# Skill-tree loading & validation
# ---------------------------------------------------------------------------

_SKILL_TREE: dict | None = None


def load_skill_tree() -> dict:
    """Load and validate the skill-tree manifest.

    - Every problem ID in each category must exist in PROBLEMS.
    - Every prerequisite ID must reference an actual category in the manifest.
    Invalid references are logged and filtered out; the server does not crash.
    """
    global _SKILL_TREE

    raw = json.loads(_SKILL_TREE_FILE.read_text(encoding="utf-8"))
    categories = raw.get("categories", [])

    # Build a set of valid category IDs for prerequisite validation
    category_ids = {cat["id"] for cat in categories}

    validated_categories = []
    for cat in categories:
        # --- Validate problem IDs ---
        valid_problems = []
        for pid in cat.get("problems", []):
            if get_problem(pid) is not None:
                valid_problems.append(pid)
            else:
                logger.warning(
                    "Skill-tree category '%s': problem '%s' not found in loaded problems — removed",
                    cat["id"], pid,
                )

        # --- Validate prerequisite IDs ---
        valid_prereqs = []
        for prereq_id in cat.get("prerequisites", []):
            if prereq_id in category_ids:
                valid_prereqs.append(prereq_id)
            else:
                logger.warning(
                    "Skill-tree category '%s': prerequisite '%s' not found in categories — removed",
                    cat["id"], prereq_id,
                )

        validated_categories.append({
            **cat,
            "problems": valid_problems,
            "prerequisites": valid_prereqs,
        })

    _SKILL_TREE = {**raw, "categories": validated_categories}
    return _SKILL_TREE


def get_skill_tree() -> dict:
    """Return the cached skill-tree manifest (loaded once at startup)."""
    if _SKILL_TREE is None:
        load_skill_tree()
    return _SKILL_TREE
