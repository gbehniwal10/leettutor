"""Tests for the LearningHistory module."""

import asyncio
import json
from pathlib import Path

import pytest

from backend.learning_history import LearningHistory


@pytest.fixture
def history(tmp_path):
    return LearningHistory(str(tmp_path))


# ------------------------------------------------------------------
# Basic recording
# ------------------------------------------------------------------


async def test_record_solved_attempt(history):
    await history.record_attempt(
        topic="two-pointers", problem_id="two-sum-ii", difficulty="medium",
        solved=True, time_to_solve=120.0, hint_level=1, attempts=3,
    )
    summary = history.get_topic_summary("two-pointers")
    assert summary is not None
    assert summary["total_attempts"] == 1
    assert summary["solves"] == 1
    assert summary["last_solved"] is not None


async def test_record_unsolved_attempt(history):
    await history.record_attempt(
        topic="graphs", problem_id="number-of-islands", difficulty="hard",
        solved=False, time_to_solve=300.0, hint_level=3, attempts=5,
    )
    summary = history.get_topic_summary("graphs")
    assert summary["total_attempts"] == 1
    assert summary["solves"] == 0
    assert summary["last_solved"] is None


async def test_multiple_attempts(history):
    await history.record_attempt(topic="dp", problem_id="climbing-stairs", difficulty="easy", solved=False)
    await history.record_attempt(topic="dp", problem_id="coin-change", difficulty="medium", solved=True, time_to_solve=60.0)
    await history.record_attempt(topic="dp", problem_id="edit-distance", difficulty="hard", solved=True, time_to_solve=180.0)
    summary = history.get_topic_summary("dp")
    assert summary["total_attempts"] == 3
    assert summary["solves"] == 2


async def test_multiple_topics_independent(history):
    await history.record_attempt(topic="arrays", problem_id="two-sum", difficulty="easy", solved=True)
    await history.record_attempt(topic="trees", problem_id="invert-binary-tree", difficulty="medium", solved=False)
    assert history.get_topic_summary("arrays")["solves"] == 1
    assert history.get_topic_summary("trees")["solves"] == 0


async def test_unseen_topic_returns_none(history):
    assert history.get_topic_summary("unknown") is None


# ------------------------------------------------------------------
# Aggregation
# ------------------------------------------------------------------


async def test_avg_difficulty_numeric(history):
    # easy=1, medium=2, hard=3 → avg = 2.0
    await history.record_attempt(topic="t", problem_id="a", difficulty="easy", solved=True)
    await history.record_attempt(topic="t", problem_id="b", difficulty="medium", solved=True)
    await history.record_attempt(topic="t", problem_id="c", difficulty="hard", solved=True)
    summary = history.get_topic_summary("t")
    assert summary["avg_difficulty_numeric"] == 2.0


async def test_hint_dependency(history):
    await history.record_attempt(topic="t", problem_id="a", difficulty="easy", solved=True, hint_level=0)
    await history.record_attempt(topic="t", problem_id="b", difficulty="easy", solved=True, hint_level=4)
    summary = history.get_topic_summary("t")
    assert summary["hint_dependency"] == 2.0


async def test_days_since_last(history):
    await history.record_attempt(topic="t", problem_id="a", difficulty="easy", solved=True)
    summary = history.get_topic_summary("t")
    # Just recorded, should be 0 days
    assert summary["days_since_last"] == 0


async def test_last_solved_tracks_most_recent(history):
    await history.record_attempt(topic="t", problem_id="a", difficulty="easy", solved=True)
    await history.record_attempt(topic="t", problem_id="b", difficulty="easy", solved=False)
    await history.record_attempt(topic="t", problem_id="c", difficulty="easy", solved=True)
    summary = history.get_topic_summary("t")
    assert summary["last_solved"] is not None
    assert summary["solves"] == 2


# ------------------------------------------------------------------
# get_all_topic_summaries
# ------------------------------------------------------------------


async def test_get_all_topic_summaries(history):
    await history.record_attempt(topic="a", problem_id="p1", difficulty="easy", solved=True)
    await history.record_attempt(topic="b", problem_id="p2", difficulty="medium", solved=False)
    summaries = history.get_all_topic_summaries()
    assert set(summaries.keys()) == {"a", "b"}
    assert summaries["a"]["solves"] == 1
    assert summaries["b"]["solves"] == 0


async def test_get_all_empty(history):
    assert history.get_all_topic_summaries() == {}


# ------------------------------------------------------------------
# get_problem_history
# ------------------------------------------------------------------


async def test_get_problem_history(history):
    await history.record_attempt(topic="arrays", problem_id="two-sum", difficulty="easy", solved=True)
    await history.record_attempt(topic="hash-map", problem_id="two-sum", difficulty="easy", solved=True)
    await history.record_attempt(topic="arrays", problem_id="contains-duplicate", difficulty="easy", solved=False)

    ph = history.get_problem_history("two-sum")
    assert len(ph) == 2
    assert all(r["problem_id"] == "two-sum" for r in ph)
    topics = {r["topic"] for r in ph}
    assert topics == {"arrays", "hash-map"}


async def test_get_problem_history_empty(history):
    assert history.get_problem_history("nonexistent") == []


# ------------------------------------------------------------------
# Persistence
# ------------------------------------------------------------------


async def test_persistence_round_trip(tmp_path):
    h1 = LearningHistory(str(tmp_path))
    await h1.record_attempt(topic="sliding-window", problem_id="minimum-window-substring", difficulty="medium", solved=True, time_to_solve=90.0)
    await h1.record_attempt(topic="sliding-window", problem_id="longest-substring-without-repeating-characters", difficulty="hard", solved=False)

    h2 = LearningHistory(str(tmp_path))
    await h2.load()
    summary = h2.get_topic_summary("sliding-window")
    assert summary["total_attempts"] == 2
    assert summary["solves"] == 1


async def test_load_empty_file(tmp_path):
    h = LearningHistory(str(tmp_path))
    await h.load()  # no file yet
    assert h.get_all_topic_summaries() == {}


async def test_load_corrupted_file(tmp_path):
    filepath = tmp_path / "learning_history.json"
    filepath.write_text("not valid json{{{")
    h = LearningHistory(str(tmp_path))
    await h.load()
    assert h.get_all_topic_summaries() == {}


# ------------------------------------------------------------------
# Concurrent safety
# ------------------------------------------------------------------


async def test_concurrent_writes(tmp_path):
    h = LearningHistory(str(tmp_path))
    tasks = [
        h.record_attempt(topic=f"topic-{i}", problem_id=f"problem-{i}", difficulty="easy", solved=True)
        for i in range(10)
    ]
    await asyncio.gather(*tasks)
    summaries = h.get_all_topic_summaries()
    assert len(summaries) == 10
    for s in summaries.values():
        assert s["total_attempts"] == 1


# ------------------------------------------------------------------
# Default parameters
# ------------------------------------------------------------------


async def test_default_parameters(history):
    await history.record_attempt(topic="t", problem_id="p", difficulty="easy", solved=False)
    summary = history.get_topic_summary("t")
    assert summary["hint_dependency"] == 0.0
    assert summary["total_attempts"] == 1


# ------------------------------------------------------------------
# Backfill from session logs
# ------------------------------------------------------------------


def _make_session_file(directory, *, session_id=None, tags=None, difficulty="medium",
                       final_result=None, duration_seconds=None, hints_requested=0,
                       code_submissions=None, started_at=None, ended_at=None,
                       problem_id=None):
    """Write a minimal mock session file and return its path."""
    import uuid as _uuid
    if session_id is None:
        session_id = _uuid.uuid4().hex
    if problem_id is None:
        problem_id = session_id
    data = {
        "session_id": session_id,
        "problem_id": problem_id,
        "mode": "learning",
        "started_at": started_at or "2026-01-15T10:00:00",
        "ended_at": ended_at,
        "duration_seconds": duration_seconds,
        "hints_requested": hints_requested,
        "code_submissions": code_submissions or [],
        "chat_history": [],
        "final_result": final_result,
        "notes": "",
        "phase_transitions": [],
        "problem_title": f"Test Problem {session_id[:8]}",
        "difficulty": difficulty,
    }
    if tags is not None:
        data["problem"] = {
            "title": data["problem_title"],
            "difficulty": difficulty,
            "tags": tags,
        }
    filepath = directory / f"{session_id}.json"
    filepath.write_text(json.dumps(data, indent=2))
    return filepath


class TestBackfillFromSessionLogs:
    """Tests for the session-log backfill path in LearningHistory.load()."""

    async def test_backfill_from_session_logs(self, tmp_path):
        """Backfill picks up solved/unsolved sessions and multi-tag sessions."""
        _make_session_file(
            tmp_path, tags=["two-pointers", "arrays"], difficulty="medium",
            final_result="solved", duration_seconds=120.0, hints_requested=1,
            code_submissions=[{"code": "x", "test_results": {}}],
        )
        _make_session_file(
            tmp_path, tags=["graphs"], difficulty="hard",
            final_result=None, duration_seconds=300.0, hints_requested=3,
            code_submissions=[{"code": "a", "test_results": {}}, {"code": "b", "test_results": {}}],
        )
        _make_session_file(
            tmp_path, tags=["trees"], difficulty="easy",
            final_result="solved",
        )

        h = LearningHistory(str(tmp_path))
        await h.load()

        tp = h.get_topic_summary("two-pointers")
        assert tp is not None
        assert tp["total_attempts"] == 1
        assert tp["solves"] == 1

        arr = h.get_topic_summary("arrays")
        assert arr is not None
        assert arr["total_attempts"] == 1
        assert arr["solves"] == 1

        gr = h.get_topic_summary("graphs")
        assert gr is not None
        assert gr["total_attempts"] == 1
        assert gr["solves"] == 0

        tr = h.get_topic_summary("trees")
        assert tr is not None
        assert tr["total_attempts"] == 1
        assert tr["solves"] == 1

    async def test_backfill_skips_sessions_without_tags(self, tmp_path):
        _make_session_file(tmp_path, tags=None)
        _make_session_file(tmp_path, tags=["dp"], final_result="solved")

        h = LearningHistory(str(tmp_path))
        await h.load()

        summaries = h.get_all_topic_summaries()
        assert list(summaries.keys()) == ["dp"]

    async def test_backfill_skips_non_session_files(self, tmp_path):
        (tmp_path / "review_scheduler.json").write_text(json.dumps({"box": {}}))
        (tmp_path / "competence.json").write_text(json.dumps({"topics": {}}))
        _make_session_file(tmp_path, tags=["arrays"], final_result="solved")

        h = LearningHistory(str(tmp_path))
        await h.load()

        summaries = h.get_all_topic_summaries()
        assert list(summaries.keys()) == ["arrays"]

    async def test_backfill_handles_corrupted_session(self, tmp_path):
        import uuid as _uuid
        _make_session_file(tmp_path, tags=["dp"], final_result="solved")
        bad_id = _uuid.uuid4().hex
        (tmp_path / f"{bad_id}.json").write_text("not valid json{{{")

        h = LearningHistory(str(tmp_path))
        await h.load()

        summaries = h.get_all_topic_summaries()
        assert "dp" in summaries
        assert summaries["dp"]["total_attempts"] == 1

    async def test_backfill_does_not_rerun_if_history_exists(self, tmp_path):
        _make_session_file(tmp_path, tags=["bfs"], final_result="solved")

        manual_data = {
            "manual-topic": {
                "attempts": [{
                    "problem_id": "test",
                    "difficulty": "hard",
                    "solved": True,
                    "time_to_solve": 999.0,
                    "hint_level": 0,
                    "attempts": 1,
                    "timestamp": "2026-01-01T00:00:00",
                }],
            },
        }
        (tmp_path / "learning_history.json").write_text(json.dumps(manual_data))

        h = LearningHistory(str(tmp_path))
        await h.load()

        assert h.get_topic_summary("manual-topic") is not None
        assert h.get_topic_summary("bfs") is None

    async def test_backfill_uses_session_timestamp(self, tmp_path):
        _make_session_file(
            tmp_path, tags=["backtracking"],
            started_at="2026-01-10T08:00:00",
            ended_at="2026-01-10T08:30:00",
            final_result="solved",
        )
        _make_session_file(
            tmp_path, tags=["greedy"],
            started_at="2026-01-12T14:00:00",
            ended_at=None,
            final_result=None,
        )

        h = LearningHistory(str(tmp_path))
        await h.load()

        raw = h._data["backtracking"]["attempts"][0]
        assert raw["timestamp"] == "2026-01-10T08:30:00"

        raw_greedy = h._data["greedy"]["attempts"][0]
        assert raw_greedy["timestamp"] == "2026-01-12T14:00:00"

    async def test_backfill_empty_sessions_dir(self, tmp_path):
        h = LearningHistory(str(tmp_path))
        await h.load()

        assert h.get_all_topic_summaries() == {}
        assert (tmp_path / "learning_history.json").exists()

    async def test_backfill_solved_vs_unsolved_counts(self, tmp_path):
        _make_session_file(
            tmp_path, tags=["sliding-window"], final_result="solved",
            started_at="2026-01-10T10:00:00", ended_at="2026-01-10T10:20:00",
        )
        _make_session_file(
            tmp_path, tags=["sliding-window"], final_result="solved",
            started_at="2026-01-11T10:00:00", ended_at="2026-01-11T10:25:00",
        )
        _make_session_file(
            tmp_path, tags=["sliding-window"], final_result=None,
            started_at="2026-01-12T10:00:00", ended_at="2026-01-12T10:30:00",
        )

        h = LearningHistory(str(tmp_path))
        await h.load()

        summary = h.get_topic_summary("sliding-window")
        assert summary is not None
        assert summary["total_attempts"] == 3
        assert summary["solves"] == 2
