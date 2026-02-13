"""Tests for the executor's result comparison and serialization boundaries.

The executor compares ``output["result"] == test["expected"]`` after the
result has been through a JSON round-trip (json.dumps in the subprocess →
json.loads in the runner).  This file tests edge cases in that comparison:

- Float precision (no epsilon → false negatives)
- Type coercion across JSON (tuples → lists, booleans ↔ ints)
- None/null in nested structures
- Non-serializable return values (sets, inf, nan)
- Large outputs and stdout interactions
- User code that writes to stderr
"""

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

from backend.executor import CodeExecutor


def _tc(input_dict, expected, function_call="solve(**test_input)"):
    return {"input": input_dict, "expected": expected, "function_call": function_call}


# ===================================================================
# Float comparison
# ===================================================================


class TestFloatComparison:
    """The executor uses bare == for comparison.  Floats that are
    mathematically equal but differ at the ULP level will fail."""

    @pytest.mark.asyncio
    async def test_exact_float_passes(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(x):\n    return 2.5\n"
        result = await executor.run_tests(code, [_tc({"x": 0}, 2.5)])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_float_arithmetic_precision(self):
        """0.1 + 0.2 != 0.3 in IEEE 754.  This documents the current
        behavior — bare == means this test FAILS."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(a, b):\n    return a + b\n"
        result = await executor.run_tests(code, [_tc({"a": 0.1, "b": 0.2}, 0.3)])
        # This WILL fail because 0.1+0.2 == 0.30000000000000004
        r = result["results"][0]
        assert r["passed"] is False
        assert abs(r["actual"] - 0.3) < 1e-10  # close but not ==

    @pytest.mark.asyncio
    async def test_float_division_precision(self):
        """10.0 / 3.0 produces 3.3333... which won't match a rounded expected."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(a, b):\n    return a / b\n"
        result = await executor.run_tests(code, [
            _tc({"a": 10.0, "b": 3.0}, 3.3333333333333335),
        ])
        # This should pass because the expected is the exact IEEE 754 value
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_float_negative_zero(self):
        """-0.0 == 0.0 in Python, so this should pass."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return -0.0\n"
        result = await executor.run_tests(code, [_tc({}, 0.0, "solve()")])
        assert result["passed"] == 1


# ===================================================================
# Non-serializable return values
# ===================================================================


class TestNonSerializable:
    """Return values that json.dumps can't handle."""

    @pytest.mark.asyncio
    async def test_set_return_value(self):
        """Sets are not JSON-serializable.  The wrapper's try/except should
        catch the TypeError and report an error, not crash."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return {1, 2, 3}\n"
        result = await executor.run_tests(code, [_tc({}, [1, 2, 3], "solve()")])
        r = result["results"][0]
        assert r["passed"] is False
        assert r["error"] is not None
        # Should be a serialization error from json.dumps
        assert "serializable" in r["error"].lower() or "error" in r["error"].lower()

    @pytest.mark.asyncio
    async def test_inf_return_value(self):
        """Python's json.dumps handles inf (non-standard but works).
        The result comes back but won't match a normal expected value."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return float('inf')\n"
        result = await executor.run_tests(code, [_tc({}, 999, "solve()")])
        r = result["results"][0]
        # inf serializes fine in Python's json, but won't match 999
        assert r["passed"] is False

    @pytest.mark.asyncio
    async def test_nan_return_value(self):
        """Python's json.dumps handles nan (non-standard but works).
        nan != nan in IEEE 754, so it won't match anything."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return float('nan')\n"
        result = await executor.run_tests(code, [_tc({}, 0, "solve()")])
        r = result["results"][0]
        assert r["passed"] is False

    @pytest.mark.asyncio
    async def test_tuple_becomes_list(self):
        """Tuples become lists after JSON round-trip.  If expected is a list,
        a returned tuple should match."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return (1, 2, 3)\n"
        result = await executor.run_tests(code, [_tc({}, [1, 2, 3], "solve()")])
        assert result["passed"] == 1
        # The actual value should be a list, not a tuple
        assert result["results"][0]["actual"] == [1, 2, 3]
        assert isinstance(result["results"][0]["actual"], list)

    @pytest.mark.asyncio
    async def test_nested_tuple_becomes_list(self):
        """Nested tuples also become lists."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return ((1, 2), (3, 4))\n"
        result = await executor.run_tests(code, [_tc({}, [[1, 2], [3, 4]], "solve()")])
        assert result["passed"] == 1


# ===================================================================
# Boolean / integer coercion
# ===================================================================


class TestBoolIntCoercion:
    """In Python, True == 1 and False == 0.  JSON preserves the type
    distinction (true vs 1), but Python's == doesn't."""

    @pytest.mark.asyncio
    async def test_true_equals_one(self):
        """True == 1 in Python, so if expected is 1 and result is True, it passes."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return True\n"
        # JSON will encode True as 'true', and json.loads gives back Python True
        # True == 1 in Python, so this passes
        result = await executor.run_tests(code, [_tc({}, True, "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_bool_in_list(self):
        """[True, False] == [1, 0] in Python, but after JSON round-trip
        the types are preserved."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return [True, False]\n"
        result = await executor.run_tests(code, [_tc({}, [True, False], "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_one_vs_true_expected(self):
        """If expected is 1 (int) and result is True (bool), Python says equal."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return True\n"
        result = await executor.run_tests(code, [_tc({}, 1, "solve()")])
        assert result["passed"] == 1  # True == 1


# ===================================================================
# None handling in various positions
# ===================================================================


class TestNoneHandling:
    """None/null should work at all nesting levels."""

    @pytest.mark.asyncio
    async def test_return_none(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return None\n"
        result = await executor.run_tests(code, [_tc({}, None, "solve()")])
        assert result["passed"] == 1
        assert result["results"][0]["actual"] is None

    @pytest.mark.asyncio
    async def test_none_in_list(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return [1, None, 3]\n"
        result = await executor.run_tests(code, [_tc({}, [1, None, 3], "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_none_in_nested_list(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return [[None], [1, None]]\n"
        result = await executor.run_tests(code, [_tc({}, [[None], [1, None]], "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_none_vs_empty_list(self):
        """None != [] — these should NOT be considered equal."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return None\n"
        result = await executor.run_tests(code, [_tc({}, [], "solve()")])
        assert result["passed"] == 0

    @pytest.mark.asyncio
    async def test_none_vs_zero(self):
        """None != 0 — these should NOT be considered equal."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return None\n"
        result = await executor.run_tests(code, [_tc({}, 0, "solve()")])
        assert result["passed"] == 0

    @pytest.mark.asyncio
    async def test_none_vs_empty_string(self):
        """None != '' — these should NOT be considered equal."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return None\n"
        result = await executor.run_tests(code, [_tc({}, "", "solve()")])
        assert result["passed"] == 0


# ===================================================================
# Empty collections
# ===================================================================


class TestEmptyCollections:
    """Verify correct comparison for empty structures."""

    @pytest.mark.asyncio
    async def test_empty_list(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return []\n"
        result = await executor.run_tests(code, [_tc({}, [], "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_empty_dict(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return {}\n"
        result = await executor.run_tests(code, [_tc({}, {}, "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_empty_string(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return ''\n"
        result = await executor.run_tests(code, [_tc({}, "", "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_zero(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return 0\n"
        result = await executor.run_tests(code, [_tc({}, 0, "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_empty_nested(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return [[], {}]\n"
        result = await executor.run_tests(code, [_tc({}, [[], {}], "solve()")])
        assert result["passed"] == 1


# ===================================================================
# String edge cases
# ===================================================================


class TestStringEdgeCases:
    """Strings with special characters should survive JSON round-trip."""

    @pytest.mark.asyncio
    async def test_unicode_string(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return 'hello'\n"
        result = await executor.run_tests(code, [_tc({}, "hello", "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_string_with_quotes(self):
        executor = CodeExecutor(timeout=10)
        code = '''def solve():\n    return 'he said "hi"'\n'''
        result = await executor.run_tests(code, [_tc({}, 'he said "hi"', "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_string_with_newlines(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return 'a\\nb'\n"
        result = await executor.run_tests(code, [_tc({}, "a\nb", "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_string_with_backslash(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return 'a\\\\b'\n"
        result = await executor.run_tests(code, [_tc({}, "a\\b", "solve()")])
        assert result["passed"] == 1


# ===================================================================
# Nested and complex structures
# ===================================================================


class TestComplexStructures:
    """Deep nesting, mixed types, large collections."""

    @pytest.mark.asyncio
    async def test_deeply_nested_list(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return [[[1, 2], [3, 4]], [[5, 6]]]\n"
        result = await executor.run_tests(code, [
            _tc({}, [[[1, 2], [3, 4]], [[5, 6]]], "solve()"),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_dict_with_varied_value_types(self):
        executor = CodeExecutor(timeout=10)
        code = (
            "def solve():\n"
            "    return {'a': 1, 'b': [2, 3], 'c': None, 'd': True}\n"
        )
        result = await executor.run_tests(code, [
            _tc({}, {"a": 1, "b": [2, 3], "c": None, "d": True}, "solve()"),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_large_list(self):
        """A result with 1000 elements should serialize and compare fine."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(n):\n    return list(range(n))\n"
        expected = list(range(1000))
        result = await executor.run_tests(code, [_tc({"n": 1000}, expected)])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_list_order_matters(self):
        """[1, 2] != [2, 1] — order must be respected."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return [2, 1]\n"
        result = await executor.run_tests(code, [_tc({}, [1, 2], "solve()")])
        assert result["passed"] == 0


# ===================================================================
# Stdout / stderr interactions
# ===================================================================


class TestStdoutStderrInteraction:
    """User code that prints or writes to stderr shouldn't break result extraction."""

    @pytest.mark.asyncio
    async def test_print_doesnt_break_result(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    print('debug output')\n    return 42\n"
        result = await executor.run_tests(code, [_tc({}, 42, "solve()")])
        assert result["passed"] == 1
        assert "debug" in result["results"][0]["stdout"]

    @pytest.mark.asyncio
    async def test_stderr_write_doesnt_break_result(self):
        """User code writing to stderr should not corrupt marker extraction."""
        executor = CodeExecutor(timeout=10)
        code = (
            "import sys\n"
            "def solve():\n"
            "    sys.stderr.write('some warning\\n')\n"
            "    return 42\n"
        )
        result = await executor.run_tests(code, [_tc({}, 42, "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_large_stdout_doesnt_break(self):
        """Lots of print output shouldn't interfere with result."""
        executor = CodeExecutor(timeout=10)
        code = (
            "def solve():\n"
            "    for i in range(100):\n"
            "        print(f'line {i}')\n"
            "    return 'done'\n"
        )
        result = await executor.run_tests(code, [_tc({}, "done", "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_empty_stdout_captured(self):
        """When no print is called, stdout should be empty string."""
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return 1\n"
        result = await executor.run_tests(code, [_tc({}, 1, "solve()")])
        assert result["results"][0]["stdout"] == ""


# ===================================================================
# Input edge cases (test_input)
# ===================================================================


class TestInputEdgeCases:
    """Edge cases in how test_input is injected into the wrapper."""

    @pytest.mark.asyncio
    async def test_string_input_with_quotes(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(s):\n    return s\n"
        result = await executor.run_tests(code, [_tc({"s": 'he said "hi"'}, 'he said "hi"')])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_nested_none_in_input(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(data):\n    return data\n"
        result = await executor.run_tests(code, [_tc({"data": [1, None, 3]}, [1, None, 3])])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_empty_input_dict(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return 'ok'\n"
        result = await executor.run_tests(code, [_tc({}, "ok", "solve()")])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_boolean_input(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(flag):\n    return not flag\n"
        result = await executor.run_tests(code, [_tc({"flag": True}, False)])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_large_integer_input(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(n):\n    return n\n"
        big = 10**18
        result = await executor.run_tests(code, [_tc({"n": big}, big)])
        assert result["passed"] == 1


# ===================================================================
# Error reporting quality
# ===================================================================


class TestErrorReporting:
    """Verify that errors are reported clearly, not swallowed."""

    @pytest.mark.asyncio
    async def test_name_error_reported(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return undefined_var\n"
        result = await executor.run_tests(code, [_tc({}, 0, "solve()")])
        r = result["results"][0]
        assert r["passed"] is False
        assert r["error"] is not None
        assert "undefined_var" in r["error"] or "NameError" in r["error"]

    @pytest.mark.asyncio
    async def test_type_error_reported(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return 1 + 'a'\n"
        result = await executor.run_tests(code, [_tc({}, 0, "solve()")])
        r = result["results"][0]
        assert r["passed"] is False
        assert r["error"] is not None

    @pytest.mark.asyncio
    async def test_index_error_reported(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return [][0]\n"
        result = await executor.run_tests(code, [_tc({}, 0, "solve()")])
        r = result["results"][0]
        assert r["passed"] is False
        assert r["error"] is not None
        assert "index" in r["error"].lower()

    @pytest.mark.asyncio
    async def test_recursion_error_reported(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return solve()\n"
        result = await executor.run_tests(code, [_tc({}, 0, "solve()")])
        r = result["results"][0]
        assert r["passed"] is False
        assert r["error"] is not None

    @pytest.mark.asyncio
    async def test_syntax_error_in_user_code(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve():\n    return (\n"  # incomplete expression
        result = await executor.run_tests(code, [_tc({}, 0, "solve()")])
        r = result["results"][0]
        assert r["passed"] is False
        assert r["error"] is not None
