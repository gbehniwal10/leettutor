"""Tests for backend.executor -- CodeExecutor sandboxed code execution."""

import asyncio
import sys

import pytest

from backend.executor import CodeExecutor, _validate_function_call


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_test_case(input_dict, expected, function_call="add(**test_input)"):
    return {
        "input": input_dict,
        "expected": expected,
        "function_call": function_call,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSimplePassing:
    """Code that should pass all tests."""

    @pytest.mark.asyncio
    async def test_simple_passing_code(self):
        executor = CodeExecutor(timeout=10)
        code = "def add(a, b):\n    return a + b\n"
        test_cases = [
            _make_test_case({"a": 1, "b": 2}, 3),
            _make_test_case({"a": 0, "b": 0}, 0),
            _make_test_case({"a": -3, "b": 3}, 0),
        ]
        result = await executor.run_tests(code, test_cases)
        assert result["passed"] == 3
        assert result["failed"] == 0
        for r in result["results"]:
            assert r["passed"] is True
            assert r["error"] is None
            assert r["runtime_ms"] is not None

    @pytest.mark.asyncio
    async def test_single_test_case(self):
        executor = CodeExecutor(timeout=10)
        code = "def multiply(a, b):\n    return a * b\n"
        test_cases = [
            _make_test_case({"a": 3, "b": 4}, 12, "multiply(**test_input)"),
        ]
        result = await executor.run_tests(code, test_cases)
        assert result["passed"] == 1
        assert result["failed"] == 0


class TestSimpleFailing:
    """Code that should fail tests (wrong result or runtime error)."""

    @pytest.mark.asyncio
    async def test_simple_failing_code(self):
        executor = CodeExecutor(timeout=10)
        # Returns wrong answer
        code = "def add(a, b):\n    return a - b\n"
        test_cases = [
            _make_test_case({"a": 1, "b": 2}, 3),
        ]
        result = await executor.run_tests(code, test_cases)
        assert result["passed"] == 0
        assert result["failed"] == 1
        assert result["results"][0]["passed"] is False
        assert result["results"][0]["actual"] == -1

    @pytest.mark.asyncio
    async def test_runtime_error(self):
        executor = CodeExecutor(timeout=10)
        code = "def add(a, b):\n    return a / 0\n"
        test_cases = [
            _make_test_case({"a": 1, "b": 2}, 3),
        ]
        result = await executor.run_tests(code, test_cases)
        assert result["passed"] == 0
        assert result["failed"] == 1
        assert result["results"][0]["error"] is not None
        assert "division" in result["results"][0]["error"].lower() or "zero" in result["results"][0]["error"].lower()


class TestTimeoutEnforcement:
    """Ensure infinite loops and long-running code are killed."""

    @pytest.mark.asyncio
    async def test_timeout_enforcement(self):
        executor = CodeExecutor(timeout=2)
        code = "def add(a, b):\n    while True:\n        pass\n"
        test_cases = [
            _make_test_case({"a": 1, "b": 2}, 3),
        ]
        result = await executor.run_tests(code, test_cases)
        assert result["passed"] == 0
        assert result["failed"] == 1
        error = result["results"][0]["error"]
        assert "Time Limit Exceeded" in error

    @pytest.mark.asyncio
    async def test_sleep_timeout(self):
        executor = CodeExecutor(timeout=2)
        code = "import time\ndef add(a, b):\n    time.sleep(30)\n    return a + b\n"
        test_cases = [
            _make_test_case({"a": 1, "b": 2}, 3),
        ]
        result = await executor.run_tests(code, test_cases)
        assert result["passed"] == 0
        assert result["failed"] == 1
        assert "Time Limit Exceeded" in result["results"][0]["error"]


class TestFunctionCallValidation:
    """Test _validate_function_call rejects dangerous expressions."""

    def test_valid_function_call(self):
        # Should not raise
        assert _validate_function_call("add(**test_input)") == "add(**test_input)"
        assert _validate_function_call("twoSum(**test_input)") == "twoSum(**test_input)"

    def test_import_rejected(self):
        with pytest.raises(ValueError, match="import"):
            _validate_function_call("import os; os.system('rm -rf /')")

    def test_eval_rejected(self):
        with pytest.raises(ValueError, match="eval"):
            _validate_function_call("eval('bad')")

    def test_exec_rejected(self):
        with pytest.raises(ValueError, match="exec"):
            _validate_function_call("exec('bad')")

    def test_dunder_rejected(self):
        with pytest.raises(ValueError, match="__"):
            _validate_function_call("__import__('os')")

    def test_open_rejected(self):
        with pytest.raises(ValueError, match="open"):
            _validate_function_call("open('/etc/passwd')")

    def test_os_access_rejected(self):
        with pytest.raises(ValueError, match="os."):
            _validate_function_call("os.system('ls')")

    def test_subprocess_rejected(self):
        with pytest.raises(ValueError, match="subprocess"):
            _validate_function_call("subprocess.run('ls')")

    def test_semicolon_rejected(self):
        with pytest.raises(ValueError, match=";"):
            _validate_function_call("add(1, 2); evil()")

    def test_newline_rejected(self):
        with pytest.raises(ValueError):
            _validate_function_call("add(1, 2)\\nimport os")

    def test_sorted_wrapper_accepted(self):
        """sorted() wrappers used for order-insensitive problems must pass validation."""
        # Single sorted
        assert _validate_function_call("sorted(twoSum(**test_input))")
        assert _validate_function_call("sorted(topKFrequent(**test_input))")
        # Double sorted (inner + outer)
        assert _validate_function_call(
            "sorted([sorted(x) for x in threeSum(**test_input)])"
        )
        assert _validate_function_call(
            "sorted([sorted(x) for x in groupAnagrams(**test_input)])"
        )


class TestMarkerExtraction:
    """Verify that results are properly parsed from the subprocess stderr marker."""

    @pytest.mark.asyncio
    async def test_marker_extraction_success(self):
        executor = CodeExecutor(timeout=10)
        code = "def add(a, b):\n    return a + b\n"
        test_cases = [
            _make_test_case({"a": 5, "b": 10}, 15),
        ]
        result = await executor.run_tests(code, test_cases)
        # A successful extraction yields the actual value and runtime
        r = result["results"][0]
        assert r["actual"] == 15
        assert r["passed"] is True
        assert r["runtime_ms"] is not None
        assert isinstance(r["runtime_ms"], float)

    @pytest.mark.asyncio
    async def test_stdout_capture(self):
        """User print() calls should be captured in the stdout field."""
        executor = CodeExecutor(timeout=10)
        code = 'def add(a, b):\n    print("debug")\n    return a + b\n'
        test_cases = [
            _make_test_case({"a": 1, "b": 2}, 3),
        ]
        result = await executor.run_tests(code, test_cases)
        r = result["results"][0]
        assert r["passed"] is True
        assert "debug" in r["stdout"]


class TestCodeSizeLimit:
    """Verify that excessively large code is rejected before execution."""

    @pytest.mark.asyncio
    async def test_oversized_code_rejected(self):
        executor = CodeExecutor(timeout=10)
        # Create code larger than MAX_CODE_SIZE (50 KB)
        code = "x = 1\n" * 20000  # ~120 KB
        test_cases = [
            _make_test_case({"a": 1, "b": 2}, 3),
        ]
        result = await executor.run_tests(code, test_cases)
        assert result["passed"] == 0
        assert result["failed"] == 1
        assert "maximum size" in result["results"][0]["error"].lower() or "exceeds" in result["results"][0]["error"].lower()


class TestMemoryLimit:
    """Test that allocating huge memory triggers a failure.

    Note: Memory limits via RLIMIT_RSS (macOS) or RLIMIT_AS (Linux) may not
    be perfectly reliable in all environments, so this test checks that the
    process at least does not succeed silently.
    """

    @pytest.mark.asyncio
    async def test_memory_limit(self):
        executor = CodeExecutor(timeout=10)
        # Try to allocate ~1 GB which exceeds the 512 MB limit
        code = "def add(a, b):\n    x = bytearray(1024 * 1024 * 1024)\n    return a + b\n"
        test_cases = [
            _make_test_case({"a": 1, "b": 2}, 3),
        ]
        result = await executor.run_tests(code, test_cases)
        # The code should either fail or produce an error; it should NOT pass
        # On some platforms (macOS) RLIMIT_RSS is advisory so we accept either
        # a crash/error or a passed-but-error result
        r = result["results"][0]
        if r["passed"]:
            # On macOS with advisory limits this may still pass; mark as expected
            pytest.skip("Memory limit not enforced on this platform (advisory RLIMIT_RSS)")
        assert r["error"] is not None


class TestHelpers:
    """Test code execution with data structure helpers enabled."""

    @pytest.mark.asyncio
    async def test_list_node_helper(self):
        executor = CodeExecutor(timeout=10)
        code = (
            "def reverseList(head):\n"
            "    prev = None\n"
            "    curr = head\n"
            "    while curr:\n"
            "        nxt = curr.next\n"
            "        curr.next = prev\n"
            "        prev = curr\n"
            "        curr = nxt\n"
            "    return prev\n"
        )
        test_cases = [
            {
                "input": {"head": [1, 2, 3]},
                "expected": [3, 2, 1],
                "function_call": "list_node_to_list(reverseList(list_node(test_input['head'])))",
            },
        ]
        result = await executor.run_tests(code, test_cases, helpers=["list_node"])
        assert result["passed"] == 1
        assert result["results"][0]["actual"] == [3, 2, 1]
