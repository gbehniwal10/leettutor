"""Tests for backend.problems -- problem loading and schema validation.

Patterns adopted from focus-engine test suite:
- Pattern 6: RNG Mocking — deterministic testing of random.choice in get_random_problem
"""

import json
import re
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.problems import PROBLEMS, list_problems, get_problem, get_random_problem


# ---------------------------------------------------------------------------
# Loading from the real problems directory
# ---------------------------------------------------------------------------

class TestLoadValidProblems:

    def test_problems_are_loaded(self):
        """The PROBLEMS dict should have been populated from backend/problems/*.json."""
        assert len(PROBLEMS) > 0, "No problems loaded -- check backend/problems/ directory"

    def test_list_problems_returns_list(self):
        problems = list_problems()
        assert isinstance(problems, list)
        assert len(problems) > 0

    def test_list_problems_contains_summary_fields(self):
        """list_problems should return dicts with id, title, difficulty, tags."""
        problems = list_problems()
        for p in problems:
            assert "id" in p
            assert "title" in p
            assert "difficulty" in p
            assert "tags" in p

    def test_get_problem_known_id(self):
        """Getting a known problem ID should return the full problem dict."""
        problem = get_problem("two-sum")
        assert problem is not None
        assert problem["id"] == "two-sum"
        assert problem["title"] == "Two Sum"

    def test_get_problem_unknown_id(self):
        assert get_problem("nonexistent-problem-xyz") is None

    def test_get_random_problem_returns_something(self):
        problem = get_random_problem()
        assert problem is not None
        assert "id" in problem

    def test_get_random_problem_filter_by_difficulty(self):
        problem = get_random_problem(difficulty="easy")
        if problem is not None:
            assert problem["difficulty"] == "easy"

    def test_get_random_problem_filter_by_tags(self):
        problem = get_random_problem(tags=["array"])
        if problem is not None:
            assert any(t in problem["tags"] for t in ["array"])


# ---------------------------------------------------------------------------
# Malformed JSON handling
# ---------------------------------------------------------------------------

class TestMalformedJsonHandling:

    def test_malformed_json_file(self, tmp_path, monkeypatch):
        """A malformed JSON file in the problems directory is logged and skipped.

        _load_problems() catches JSONDecodeError and KeyError, logs a warning,
        and continues loading other files.
        """
        problems_dir = tmp_path / "problems"
        problems_dir.mkdir()
        bad_file = problems_dir / "bad-problem.json"
        bad_file.write_text("{invalid json content", encoding="utf-8")

        from backend import problems as problems_module
        original_dir = problems_module.PROBLEMS_DIR
        try:
            problems_module.PROBLEMS_DIR = problems_dir
            loaded = problems_module._load_problems()
            assert loaded == {}
        finally:
            problems_module.PROBLEMS_DIR = original_dir

    def test_valid_json_wrong_schema(self, tmp_path, monkeypatch):
        """A valid JSON file missing required fields should still load but may break
        downstream access. This documents the current behavior."""
        problems_dir = tmp_path / "problems"
        problems_dir.mkdir()
        incomplete = problems_dir / "incomplete.json"
        incomplete.write_text(json.dumps({"id": "incomplete"}), encoding="utf-8")

        from backend import problems as problems_module
        original_dir = problems_module.PROBLEMS_DIR
        try:
            problems_module.PROBLEMS_DIR = problems_dir
            loaded = problems_module._load_problems()
            assert "incomplete" in loaded
            # It loaded, but missing fields
            assert "title" not in loaded["incomplete"]
        finally:
            problems_module.PROBLEMS_DIR = original_dir


# ---------------------------------------------------------------------------
# Problem schema validation
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = {"id", "title", "difficulty", "tags", "description",
                   "starter_code", "function_name", "test_cases"}


class TestProblemSchema:

    def test_all_problems_have_required_fields(self):
        """Every loaded problem should have the required fields."""
        for problem_id, problem in PROBLEMS.items():
            for field in REQUIRED_FIELDS:
                assert field in problem, (
                    f"Problem '{problem_id}' is missing required field '{field}'"
                )

    def test_difficulty_values(self):
        """Difficulty should be one of easy, medium, hard."""
        valid_difficulties = {"easy", "medium", "hard"}
        for problem_id, problem in PROBLEMS.items():
            assert problem["difficulty"] in valid_difficulties, (
                f"Problem '{problem_id}' has invalid difficulty: {problem['difficulty']}"
            )

    def test_tags_are_lists(self):
        for problem_id, problem in PROBLEMS.items():
            assert isinstance(problem["tags"], list), (
                f"Problem '{problem_id}' tags should be a list"
            )

    def test_test_cases_structure(self):
        """Each test case should have input, expected, and function_call."""
        for problem_id, problem in PROBLEMS.items():
            assert len(problem["test_cases"]) > 0, (
                f"Problem '{problem_id}' has no test_cases"
            )
            for i, tc in enumerate(problem["test_cases"]):
                assert "input" in tc, (
                    f"Problem '{problem_id}' test_case {i} missing 'input'"
                )
                assert "expected" in tc, (
                    f"Problem '{problem_id}' test_case {i} missing 'expected'"
                )
                assert "function_call" in tc, (
                    f"Problem '{problem_id}' test_case {i} missing 'function_call'"
                )

    def test_starter_code_contains_function_name(self):
        """The starter_code should define the function named in function_name."""
        for problem_id, problem in PROBLEMS.items():
            assert problem["function_name"] in problem["starter_code"], (
                f"Problem '{problem_id}' starter_code does not contain "
                f"function_name '{problem['function_name']}'"
            )


# ---------------------------------------------------------------------------
# Ordering consistency -- prevent order-sensitive comparison regressions
# ---------------------------------------------------------------------------

# Problems whose descriptions say "any order" but whose output order is
# actually significant (sorted by interval start, etc.)
_ANY_ORDER_FALSE_POSITIVES = {
    "insert-interval",      # output must be sorted by interval start
    "merge-intervals",      # output must be sorted by interval start
    "alien-dictionary",     # returns a string, not a list
    "task-scheduler",       # returns an integer
}


class TestOrderingConsistency:

    def test_no_duplicate_problem_titles(self):
        """No two problem files should share the same title."""
        seen_titles = {}
        for problem_id, problem in PROBLEMS.items():
            title = problem["title"]
            assert title not in seen_titles, (
                f"Duplicate title '{title}': found in both "
                f"'{seen_titles[title]}' and '{problem_id}'"
            )
            seen_titles[title] = problem_id

    def test_any_order_problems_use_sorted_wrapper(self):
        """Problems whose description mentions 'any order' should wrap
        function_call with sorted() to avoid false test failures."""
        any_order_re = re.compile(r"any\s+order", re.IGNORECASE)
        for problem_id, problem in PROBLEMS.items():
            if problem_id in _ANY_ORDER_FALSE_POSITIVES:
                continue
            desc = problem.get("description", "")
            if not any_order_re.search(desc):
                continue
            # At least the first test case should use sorted()
            fc = problem["test_cases"][0]["function_call"]
            assert "sorted(" in fc, (
                f"Problem '{problem_id}' says 'any order' in description "
                f"but function_call lacks sorted() wrapper: {fc}"
            )

    def test_expected_values_are_normalized(self):
        """For problems with sorted() wrappers, expected values must already
        be in sorted form so that == comparison works correctly."""
        for problem_id, problem in PROBLEMS.items():
            for section in ("test_cases", "hidden_test_cases"):
                for i, tc in enumerate(problem.get(section, [])):
                    fc = tc.get("function_call", "")
                    expected = tc["expected"]
                    if "sorted(" not in fc:
                        continue
                    if not isinstance(expected, list) or len(expected) == 0:
                        continue
                    if "sorted([sorted(x)" in fc:
                        # Double-sorted: inner lists sorted, outer sorted
                        normalized = sorted(
                            [sorted(x) if isinstance(x, list) else [x]
                             for x in expected]
                        )
                    else:
                        # Single-sorted: outer list sorted
                        normalized = sorted(expected)
                    assert expected == normalized, (
                        f"Problem '{problem_id}' {section}[{i}]: expected "
                        f"value is not in sorted form"
                    )


# ---------------------------------------------------------------------------
# Pattern 6: RNG Mocking for Probabilistic Logic
# ---------------------------------------------------------------------------

class TestRandomProblemRNGMocking:
    """Mock random.choice so get_random_problem is deterministic.

    get_random_problem() calls random.choice(candidates) to pick a
    problem.  By patching random.choice we can verify the filtering
    logic without depending on which element happens to be chosen.
    """

    def test_random_choice_receives_filtered_candidates(self):
        """Verify that random.choice is called with only easy problems
        when difficulty='easy' is specified."""
        with patch("backend.problems.random") as mock_random:
            # Make random.choice return whatever it receives as the first element
            mock_random.choice.side_effect = lambda candidates: candidates[0]

            result = get_random_problem(difficulty="easy")

            # random.choice must have been called once
            mock_random.choice.assert_called_once()
            # Every candidate passed to choice must be "easy"
            candidates = mock_random.choice.call_args[0][0]
            assert len(candidates) > 0
            for p in candidates:
                assert p["difficulty"] == "easy"

    def test_random_returns_specific_problem_when_mocked(self):
        """Mock random.choice to always return a specific problem
        regardless of the candidate list."""
        target = {"id": "mock-problem", "title": "Mock", "difficulty": "easy", "tags": []}
        with patch("backend.problems.random") as mock_random:
            mock_random.choice.return_value = target

            result = get_random_problem()

        assert result["id"] == "mock-problem"
        assert result is target

    def test_random_with_tag_filter_passes_correct_candidates(self):
        """Verify tag filtering produces the correct candidate set for random.choice."""
        with patch("backend.problems.random") as mock_random:
            mock_random.choice.side_effect = lambda candidates: candidates[0]

            result = get_random_problem(tags=["dynamic-programming"])

            mock_random.choice.assert_called_once()
            candidates = mock_random.choice.call_args[0][0]
            for p in candidates:
                assert any(t in p["tags"] for t in ["dynamic-programming"])
