"""Tests for the ReviewScheduler module."""

from datetime import datetime, timedelta

import pytest

from backend.review_scheduler import (
    MAX_BOX,
    REVIEW_RATIO_DEFAULT,
    SPACING_INTERVALS,
    ReviewScheduler,
)


@pytest.fixture
def scheduler(tmp_path):
    return ReviewScheduler(str(tmp_path))


# ------------------------------------------------------------------
# Box transitions
# ------------------------------------------------------------------


async def test_record_review_success_advances_box(scheduler):
    await scheduler.ensure_topic("dp")
    await scheduler.record_review("dp", success=True)
    entry = scheduler._boxes["dp"]
    assert entry["box"] == 1
    assert entry["last_reviewed"] is not None


async def test_record_review_failure_demotes_box(scheduler):
    await scheduler.ensure_topic("dp")
    await scheduler.record_review("dp", success=True)
    await scheduler.record_review("dp", success=True)
    assert scheduler._boxes["dp"]["box"] == 2
    await scheduler.record_review("dp", success=False)
    assert scheduler._boxes["dp"]["box"] == 1


async def test_failure_at_box_0_stays_at_0(scheduler):
    await scheduler.ensure_topic("dp")
    await scheduler.record_review("dp", success=False)
    assert scheduler._boxes["dp"]["box"] == 0


async def test_success_caps_at_max_box(scheduler):
    await scheduler.ensure_topic("dp")
    for _ in range(MAX_BOX + 5):
        await scheduler.record_review("dp", success=True)
    assert scheduler._boxes["dp"]["box"] == MAX_BOX


async def test_ensure_topic_creates_entry(scheduler):
    await scheduler.ensure_topic("arrays")
    assert "arrays" in scheduler._boxes
    assert scheduler._boxes["arrays"]["box"] == 0
    assert scheduler._boxes["arrays"]["last_reviewed"] is None


async def test_ensure_topic_idempotent(scheduler):
    await scheduler.ensure_topic("arrays")
    await scheduler.record_review("arrays", success=True)
    await scheduler.ensure_topic("arrays")
    assert scheduler._boxes["arrays"]["box"] == 1


# ------------------------------------------------------------------
# Due topics
# ------------------------------------------------------------------


async def test_no_due_topics_empty_scheduler(scheduler):
    assert scheduler.get_due_topics() == []


async def test_never_reviewed_topics_not_due(scheduler):
    """Topics with last_reviewed=None are new, not review candidates."""
    await scheduler.ensure_topic("trees")
    assert scheduler.get_due_topics() == []


async def test_topic_due_after_interval(scheduler):
    await scheduler.ensure_topic("dp")
    scheduler._boxes["dp"]["last_reviewed"] = (
        datetime.now() - timedelta(days=2)
    ).isoformat()
    due = scheduler.get_due_topics()
    assert len(due) == 1
    assert due[0]["topic"] == "dp"
    assert due[0]["days_overdue"] >= 1


async def test_topic_not_due_before_interval(scheduler):
    await scheduler.ensure_topic("dp")
    scheduler._boxes["dp"]["box"] = 3
    scheduler._boxes["dp"]["last_reviewed"] = datetime.now().isoformat()
    assert scheduler.get_due_topics() == []


async def test_due_topics_sorted_by_priority(scheduler):
    now = datetime.now()
    scheduler._boxes["a"] = {
        "box": 3,
        "last_reviewed": (now - timedelta(days=15)).isoformat(),
    }
    scheduler._boxes["b"] = {
        "box": 1,
        "last_reviewed": (now - timedelta(days=3)).isoformat(),
    }
    due = scheduler.get_due_topics()
    assert len(due) == 2
    assert due[0]["topic"] == "b"


async def test_overdue_penalty_demotes_effective_box(scheduler):
    now = datetime.now()
    scheduler._boxes["dp"] = {
        "box": 2,
        "last_reviewed": (now - timedelta(days=15)).isoformat(),
    }
    due = scheduler.get_due_topics()
    assert len(due) == 1
    assert due[0]["box"] == 1


async def test_competence_affects_priority(scheduler):
    now = datetime.now()
    scheduler._boxes["a"] = {
        "box": 1,
        "last_reviewed": (now - timedelta(days=5)).isoformat(),
    }
    scheduler._boxes["b"] = {
        "box": 1,
        "last_reviewed": (now - timedelta(days=5)).isoformat(),
    }
    competence_map = {"a": 3, "b": 0}
    due = scheduler.get_due_topics(competence_map)
    topics = [d["topic"] for d in due]
    assert topics.index("b") < topics.index("a")


# ------------------------------------------------------------------
# Due problems (static pool mapping)
# ------------------------------------------------------------------


async def test_get_due_problems_maps_topics_to_problems(scheduler):
    now = datetime.now()
    scheduler._boxes["arrays"] = {
        "box": 0,
        "last_reviewed": (now - timedelta(days=2)).isoformat(),
    }
    problems = [
        {"id": "two-sum", "tags": ["arrays", "hash-map"], "status": "unsolved"},
        {"id": "contains-duplicate", "tags": ["arrays"], "status": "solved"},
    ]
    result = scheduler.get_due_problems(problems)
    assert len(result) == 1
    assert result[0]["problem_id"] == "two-sum"  # prefers unsolved
    assert result[0]["topic"] == "arrays"


async def test_get_due_problems_prefers_unsolved(scheduler):
    now = datetime.now()
    scheduler._boxes["dp"] = {
        "box": 0,
        "last_reviewed": (now - timedelta(days=2)).isoformat(),
    }
    problems = [
        {"id": "climbing-stairs", "tags": ["dp"], "status": "solved", "last_solved_at": "2026-01-01T00:00:00"},
        {"id": "coin-change", "tags": ["dp"], "status": "unsolved"},
    ]
    result = scheduler.get_due_problems(problems)
    assert result[0]["problem_id"] == "coin-change"


async def test_get_due_problems_falls_back_to_oldest_solved(scheduler):
    now = datetime.now()
    scheduler._boxes["dp"] = {
        "box": 0,
        "last_reviewed": (now - timedelta(days=2)).isoformat(),
    }
    problems = [
        {"id": "climbing-stairs", "tags": ["dp"], "status": "solved", "last_solved_at": "2026-01-15T00:00:00"},
        {"id": "coin-change", "tags": ["dp"], "status": "solved", "last_solved_at": "2026-01-01T00:00:00"},
    ]
    result = scheduler.get_due_problems(problems)
    assert result[0]["problem_id"] == "coin-change"  # oldest solved


async def test_get_due_problems_skips_topics_without_matching_problems(scheduler):
    now = datetime.now()
    scheduler._boxes["graph-theory"] = {
        "box": 0,
        "last_reviewed": (now - timedelta(days=2)).isoformat(),
    }
    problems = [
        {"id": "two-sum", "tags": ["arrays"], "status": "unsolved"},
    ]
    result = scheduler.get_due_problems(problems)
    assert result == []


async def test_get_due_problems_no_duplicates(scheduler):
    now = datetime.now()
    # Two due topics that share the same problem
    scheduler._boxes["arrays"] = {
        "box": 0,
        "last_reviewed": (now - timedelta(days=2)).isoformat(),
    }
    scheduler._boxes["hash-map"] = {
        "box": 0,
        "last_reviewed": (now - timedelta(days=2)).isoformat(),
    }
    problems = [
        {"id": "two-sum", "tags": ["arrays", "hash-map"], "status": "unsolved"},
    ]
    result = scheduler.get_due_problems(problems)
    # Only one entry, not two
    assert len(result) == 1


async def test_get_due_problems_empty_when_nothing_due(scheduler):
    problems = [{"id": "two-sum", "tags": ["arrays"], "status": "unsolved"}]
    assert scheduler.get_due_problems(problems) == []


# ------------------------------------------------------------------
# Session plan
# ------------------------------------------------------------------


async def test_session_plan_specific_problem(scheduler):
    plan = scheduler.get_session_plan("two-sum", problem_tags=["arrays", "hash-map"])
    assert plan["primary"] == "two-sum"
    assert plan["is_review"] is False
    assert plan["review_queue"] == []


async def test_session_plan_with_review_queue(scheduler):
    now = datetime.now()
    scheduler._boxes["binary-search"] = {
        "box": 1,
        "last_reviewed": (now - timedelta(days=5)).isoformat(),
    }
    plan = scheduler.get_session_plan("two-sum", problem_tags=["arrays"])
    assert plan["primary"] == "two-sum"
    assert plan["is_review"] is False
    assert len(plan["review_queue"]) == 1
    assert plan["review_queue"][0]["topic"] == "binary-search"
    assert plan["suggested_mix"]["review_ratio"] == REVIEW_RATIO_DEFAULT


async def test_session_plan_excludes_problem_tags_from_queue(scheduler):
    now = datetime.now()
    scheduler._boxes["arrays"] = {
        "box": 1,
        "last_reviewed": (now - timedelta(days=5)).isoformat(),
    }
    plan = scheduler.get_session_plan("two-sum", problem_tags=["arrays", "hash-map"])
    # "arrays" should be excluded since it's a tag of the requested problem
    assert all(d["topic"] != "arrays" for d in plan["review_queue"])


async def test_session_plan_no_problem_picks_top_due(scheduler):
    now = datetime.now()
    scheduler._boxes["trees"] = {
        "box": 0,
        "last_reviewed": (now - timedelta(days=3)).isoformat(),
    }
    plan = scheduler.get_session_plan()
    assert plan["primary"] == "trees"
    assert plan["is_review"] is True


async def test_session_plan_no_problem_nothing_due(scheduler):
    plan = scheduler.get_session_plan()
    assert plan["primary"] is None
    assert plan["is_review"] is False
    assert plan["review_queue"] == []


# ------------------------------------------------------------------
# Persistence
# ------------------------------------------------------------------


async def test_persistence_round_trip(tmp_path):
    s1 = ReviewScheduler(str(tmp_path))
    await s1.ensure_topic("dp")
    await s1.record_review("dp", success=True)
    await s1.record_review("dp", success=True)

    s2 = ReviewScheduler(str(tmp_path))
    await s2.load()
    assert s2._boxes["dp"]["box"] == 2


async def test_load_empty(tmp_path):
    s = ReviewScheduler(str(tmp_path))
    await s.load()
    assert s._boxes == {}


async def test_load_corrupted(tmp_path):
    (tmp_path / "review_scheduler.json").write_text("{bad json!!!")
    s = ReviewScheduler(str(tmp_path))
    await s.load()
    assert s._boxes == {}


# ------------------------------------------------------------------
# Priority edge cases
# ------------------------------------------------------------------


async def test_priority_in_valid_range(scheduler):
    now = datetime.now()
    scheduler._boxes["t"] = {
        "box": 0,
        "last_reviewed": (now - timedelta(days=100)).isoformat(),
    }
    due = scheduler.get_due_topics()
    assert len(due) == 1
    assert 0.0 <= due[0]["priority"] <= 1.0


async def test_all_boxes_produce_valid_priority(scheduler):
    now = datetime.now()
    for box in range(MAX_BOX + 1):
        topic = f"topic-{box}"
        interval = SPACING_INTERVALS[box]
        scheduler._boxes[topic] = {
            "box": box,
            "last_reviewed": (now - timedelta(days=interval + 1)).isoformat(),
        }
    due = scheduler.get_due_topics()
    for d in due:
        assert 0.0 <= d["priority"] <= 1.0
