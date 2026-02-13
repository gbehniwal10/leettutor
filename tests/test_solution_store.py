"""Tests for backend.solution_store — solution storage, deduplication, CRUD."""

import asyncio

import pytest

from backend.solution_store import SolutionStore


@pytest.fixture
def store(tmp_path):
    """Create a SolutionStore with a temporary directory."""
    return SolutionStore(solutions_dir=tmp_path / "solutions")


# ---------------------------------------------------------------------------
# save_solution
# ---------------------------------------------------------------------------


class TestSaveSolution:

    @pytest.mark.asyncio
    async def test_save_creates_solution(self, store):
        sol = await store.save_solution(
            problem_id="two-sum",
            code="def twoSum(nums, target):\n    pass\n",
            passed=3,
            total=3,
            avg_runtime_ms=0.42,
            mode="learning",
            session_id="abc123def",
        )
        assert sol["id"]
        assert sol["passed"] == 3
        assert sol["total"] == 3
        assert sol["avg_runtime_ms"] == 0.42
        assert sol["mode"] == "learning"
        assert sol["label"] == ""
        assert sol["code_hash"]

    @pytest.mark.asyncio
    async def test_save_deduplicates_identical_code(self, store):
        code = "def add(a, b):\n    return a + b\n"
        sol1 = await store.save_solution("test-add", code, 2, 2, 0.1)
        sol2 = await store.save_solution("test-add", code, 2, 2, 0.2)
        assert sol1["id"] == sol2["id"]
        # Only one solution should exist
        solutions = await store.list_solutions("test-add")
        assert len(solutions) == 1

    @pytest.mark.asyncio
    async def test_save_deduplicates_with_trailing_whitespace(self, store):
        code1 = "def add(a, b):\n    return a + b\n"
        code2 = "def add(a, b):  \n    return a + b  \n\n"
        sol1 = await store.save_solution("test-add", code1, 2, 2, 0.1)
        sol2 = await store.save_solution("test-add", code2, 2, 2, 0.2)
        assert sol1["id"] == sol2["id"]

    @pytest.mark.asyncio
    async def test_save_different_code_creates_new_solution(self, store):
        sol1 = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        sol2 = await store.save_solution("test-add", "def add(a, b): return a + b + 0", 2, 2, 0.2)
        assert sol1["id"] != sol2["id"]
        solutions = await store.list_solutions("test-add")
        assert len(solutions) == 2

    @pytest.mark.asyncio
    async def test_save_invalid_problem_id_raises(self, store):
        with pytest.raises(ValueError, match="Invalid problem_id"):
            await store.save_solution("../etc/passwd", "code", 1, 1, 0.1)

    @pytest.mark.asyncio
    async def test_save_empty_problem_id_raises(self, store):
        with pytest.raises(ValueError, match="Invalid problem_id"):
            await store.save_solution("", "code", 1, 1, 0.1)


# ---------------------------------------------------------------------------
# list_solutions
# ---------------------------------------------------------------------------


class TestListSolutions:

    @pytest.mark.asyncio
    async def test_list_empty(self, store):
        result = await store.list_solutions("nonexistent")
        assert result == []

    @pytest.mark.asyncio
    async def test_list_excludes_code_field(self, store):
        await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        solutions = await store.list_solutions("test-add")
        assert len(solutions) == 1
        assert "code" not in solutions[0]
        assert "code_hash" not in solutions[0]
        assert "id" in solutions[0]
        assert "timestamp" in solutions[0]

    @pytest.mark.asyncio
    async def test_list_invalid_problem_id(self, store):
        result = await store.list_solutions("../../etc")
        assert result == []


# ---------------------------------------------------------------------------
# get_solution
# ---------------------------------------------------------------------------


class TestGetSolution:

    @pytest.mark.asyncio
    async def test_get_existing(self, store):
        saved = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        got = await store.get_solution("test-add", saved["id"])
        assert got is not None
        assert got["id"] == saved["id"]
        assert got["code"] == "def add(a, b): return a + b"

    @pytest.mark.asyncio
    async def test_get_nonexistent(self, store):
        result = await store.get_solution("test-add", "deadbeef00000000")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_invalid_solution_id(self, store):
        result = await store.get_solution("test-add", "not-valid!")
        assert result is None


# ---------------------------------------------------------------------------
# delete_solution
# ---------------------------------------------------------------------------


class TestDeleteSolution:

    @pytest.mark.asyncio
    async def test_delete_existing(self, store):
        saved = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        deleted = await store.delete_solution("test-add", saved["id"])
        assert deleted is True
        result = await store.get_solution("test-add", saved["id"])
        assert result is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent(self, store):
        deleted = await store.delete_solution("test-add", "deadbeef00000000")
        assert deleted is False

    @pytest.mark.asyncio
    async def test_delete_invalid_solution_id(self, store):
        deleted = await store.delete_solution("test-add", "bad!")
        assert deleted is False


# ---------------------------------------------------------------------------
# update_label
# ---------------------------------------------------------------------------


class TestUpdateLabel:

    @pytest.mark.asyncio
    async def test_update_label(self, store):
        saved = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        updated = await store.update_label("test-add", saved["id"], "brute force")
        assert updated is not None
        assert updated["label"] == "brute force"

        # Verify persistence
        got = await store.get_solution("test-add", saved["id"])
        assert got["label"] == "brute force"

    @pytest.mark.asyncio
    async def test_update_label_nonexistent(self, store):
        result = await store.update_label("test-add", "deadbeef00000000", "label")
        assert result is None

    @pytest.mark.asyncio
    async def test_update_label_too_long(self, store):
        saved = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        with pytest.raises(ValueError, match="Label too long"):
            await store.update_label("test-add", saved["id"], "x" * 200)


# ---------------------------------------------------------------------------
# get_solution_counts
# ---------------------------------------------------------------------------


class TestGetSolutionCounts:

    @pytest.mark.asyncio
    async def test_empty_returns_empty(self, store):
        counts = await store.get_solution_counts()
        assert counts == {}

    @pytest.mark.asyncio
    async def test_counts_multiple_problems(self, store):
        await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        await store.save_solution("test-add", "def add(a, b): return b + a", 2, 2, 0.2)
        await store.save_solution("two-sum", "def twoSum(): pass", 3, 3, 0.3)
        counts = await store.get_solution_counts()
        assert counts["test-add"] == 2
        assert counts["two-sum"] == 1


# ---------------------------------------------------------------------------
# get_solutions_summary
# ---------------------------------------------------------------------------


class TestGetSolutionsSummary:

    @pytest.mark.asyncio
    async def test_summary_no_solutions(self, store):
        result = await store.get_solutions_summary("nonexistent")
        assert result is None

    @pytest.mark.asyncio
    async def test_summary_with_solutions(self, store):
        await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.5)
        sol2 = await store.save_solution("test-add", "def add(a, b): return b + a", 2, 2, 0.3)
        await store.update_label("test-add", sol2["id"], "optimized")

        summary = await store.get_solutions_summary("test-add")
        assert summary["solution_count"] == 2
        assert summary["best_avg_runtime_ms"] == 0.3
        assert len(summary["approaches_tried"]) == 2


# ---------------------------------------------------------------------------
# Path traversal protection
# ---------------------------------------------------------------------------


class TestPathTraversal:

    @pytest.mark.asyncio
    async def test_problem_id_with_path_traversal(self, store):
        with pytest.raises(ValueError):
            await store.save_solution("../secret", "code", 1, 1, 0.1)

    @pytest.mark.asyncio
    async def test_list_with_path_traversal(self, store):
        result = await store.list_solutions("../secret")
        assert result == []

    @pytest.mark.asyncio
    async def test_get_with_path_traversal(self, store):
        result = await store.get_solution("../secret", "deadbeef00000000")
        assert result is None


# ---------------------------------------------------------------------------
# Concurrent access
# ---------------------------------------------------------------------------


class TestConcurrentAccess:

    @pytest.mark.asyncio
    async def test_concurrent_saves(self, store):
        """Multiple concurrent saves should not corrupt data."""
        tasks = [
            store.save_solution("test-add", f"def add(a, b): return a + b + {i}", 2, 2, 0.1 * i)
            for i in range(10)
        ]
        results = await asyncio.gather(*tasks)
        # All should succeed
        assert len(results) == 10
        # All should have unique IDs (no dedup since code differs)
        ids = {r["id"] for r in results}
        assert len(ids) == 10
        # List should show all 10
        solutions = await store.list_solutions("test-add")
        assert len(solutions) == 10


# ---------------------------------------------------------------------------
# update_approach
# ---------------------------------------------------------------------------


class TestUpdateApproach:

    @pytest.mark.asyncio
    async def test_update_approach(self, store):
        saved = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        updated = await store.update_approach("test-add", saved["id"], "Hash Map O(n)")
        assert updated is not None
        assert updated["approach"] == "Hash Map O(n)"

        # Verify persistence
        got = await store.get_solution("test-add", saved["id"])
        assert got["approach"] == "Hash Map O(n)"

    @pytest.mark.asyncio
    async def test_update_approach_nonexistent(self, store):
        result = await store.update_approach("test-add", "deadbeef00000000", "Brute Force O(n²)")
        assert result is None

    @pytest.mark.asyncio
    async def test_update_approach_invalid_solution_id(self, store):
        result = await store.update_approach("test-add", "bad!", "Brute Force O(n²)")
        assert result is None


# ---------------------------------------------------------------------------
# find_by_approach
# ---------------------------------------------------------------------------


class TestFindByApproach:

    @pytest.mark.asyncio
    async def test_find_existing_approach(self, store):
        sol = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        await store.update_approach("test-add", sol["id"], "Hash Map O(n)")
        found = await store.find_by_approach("test-add", "Hash Map O(n)")
        assert found is not None
        assert found["id"] == sol["id"]
        # Should not include code field
        assert "code" not in found

    @pytest.mark.asyncio
    async def test_find_with_exclude(self, store):
        sol = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        await store.update_approach("test-add", sol["id"], "Hash Map O(n)")
        # Excluding the only match should return None
        found = await store.find_by_approach("test-add", "Hash Map O(n)", exclude_id=sol["id"])
        assert found is None

    @pytest.mark.asyncio
    async def test_find_no_match(self, store):
        await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        found = await store.find_by_approach("test-add", "Nonexistent O(1)")
        assert found is None


# ---------------------------------------------------------------------------
# Unique approach counting
# ---------------------------------------------------------------------------


class TestUniqueApproachCounting:

    @pytest.mark.asyncio
    async def test_counts_unique_approaches(self, store):
        """Two solutions with the same approach should count as 1."""
        sol1 = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        sol2 = await store.save_solution("test-add", "def add(a, b): return b + a", 2, 2, 0.2)
        await store.update_approach("test-add", sol1["id"], "Hash Map O(n)")
        await store.update_approach("test-add", sol2["id"], "Hash Map O(n)")
        counts = await store.get_solution_counts()
        assert counts["test-add"] == 1

    @pytest.mark.asyncio
    async def test_counts_different_approaches(self, store):
        sol1 = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        sol2 = await store.save_solution("test-add", "def add(a, b): return b + a", 2, 2, 0.2)
        await store.update_approach("test-add", sol1["id"], "Hash Map O(n)")
        await store.update_approach("test-add", sol2["id"], "Brute Force O(n²)")
        counts = await store.get_solution_counts()
        assert counts["test-add"] == 2

    @pytest.mark.asyncio
    async def test_counts_null_approaches_individually(self, store):
        """Solutions without approach tags each count individually."""
        await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.1)
        await store.save_solution("test-add", "def add(a, b): return b + a", 2, 2, 0.2)
        counts = await store.get_solution_counts()
        assert counts["test-add"] == 2

    @pytest.mark.asyncio
    async def test_summary_uses_approach_tags(self, store):
        sol1 = await store.save_solution("test-add", "def add(a, b): return a + b", 2, 2, 0.5)
        sol2 = await store.save_solution("test-add", "def add(a, b): return b + a", 2, 2, 0.3)
        await store.update_approach("test-add", sol1["id"], "Hash Map O(n)")
        await store.update_label("test-add", sol2["id"], "optimized")

        summary = await store.get_solutions_summary("test-add")
        assert "Hash Map O(n)" in summary["approaches_tried"]
        # sol2 has no approach, falls back to label
        assert "optimized" in summary["approaches_tried"]
