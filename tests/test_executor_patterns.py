"""Tests for real-world function_call patterns and multi-test behavior.

These tests simulate the patterns the generation pipeline actually produces
and exercise the wrapper template with realistic inputs.  They also cover
the consecutive-TLE skip logic and parameter mismatch error reporting.
"""

import pytest

from backend.executor import CodeExecutor


def _tc(input_dict, expected, function_call="solve(**test_input)"):
    return {"input": input_dict, "expected": expected, "function_call": function_call}


# ===================================================================
# **test_input unpacking patterns
# ===================================================================


class TestKwargsUnpacking:
    """The generation pipeline always uses ``fname(**test_input)``.
    Test that various input shapes unpack correctly."""

    @pytest.mark.asyncio
    async def test_single_param(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(nums):\n    return sorted(nums)\n"
        result = await executor.run_tests(code, [
            _tc({"nums": [3, 1, 2]}, [1, 2, 3]),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_two_params(self):
        executor = CodeExecutor(timeout=10)
        code = "def twoSum(nums, target):\n    return [0, 1]\n"
        result = await executor.run_tests(code, [
            _tc({"nums": [2, 7, 11], "target": 9}, [0, 1], "twoSum(**test_input)"),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_three_params(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(a, b, c):\n    return a + b + c\n"
        result = await executor.run_tests(code, [
            _tc({"a": 1, "b": 2, "c": 3}, 6),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_extra_key_in_input(self):
        """If test_input has a key that doesn't match any parameter,
        **test_input unpacking should raise a TypeError."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(a):\n    return a\n"
        result = await executor.run_tests(code, [
            _tc({"a": 1, "extra": 2}, 1),
        ])
        r = result["results"][0]
        assert r["passed"] is False
        assert r["error"] is not None
        assert "unexpected" in r["error"].lower() or "TypeError" in r["error"]

    @pytest.mark.asyncio
    async def test_missing_key_in_input(self):
        """If test_input is missing a required parameter, should raise TypeError."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(a, b):\n    return a + b\n"
        result = await executor.run_tests(code, [
            _tc({"a": 1}, 1),  # missing 'b'
        ])
        r = result["results"][0]
        assert r["passed"] is False
        assert r["error"] is not None

    @pytest.mark.asyncio
    async def test_none_param_value(self):
        """A parameter value of None should work (fixed by json.loads wrapper)."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(head):\n    return head is None\n"
        result = await executor.run_tests(code, [
            _tc({"head": None}, True),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_boolean_param_value(self):
        """Boolean param values (fixed by json.loads wrapper)."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(ascending):\n    return ascending\n"
        result = await executor.run_tests(code, [
            _tc({"ascending": True}, True),
            _tc({"ascending": False}, False),
        ])
        assert result["passed"] == 2

    @pytest.mark.asyncio
    async def test_mixed_type_params(self):
        """Mixed types: int, string, list, bool, None."""
        executor = CodeExecutor(timeout=10)
        code = (
            "def solve(n, s, arr, flag, opt):\n"
            "    return [n, s, arr, flag, opt]\n"
        )
        result = await executor.run_tests(code, [
            _tc(
                {"n": 42, "s": "hello", "arr": [1, 2], "flag": True, "opt": None},
                [42, "hello", [1, 2], True, None],
            ),
        ])
        assert result["passed"] == 1


# ===================================================================
# Subscript access patterns
# ===================================================================


class TestSubscriptAccess:
    """Some problems use test_input['key'] instead of **test_input."""

    @pytest.mark.asyncio
    async def test_single_subscript(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(nums):\n    return sum(nums)\n"
        result = await executor.run_tests(code, [
            _tc({"nums": [1, 2, 3]}, 6, "solve(test_input['nums'])"),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_multiple_subscripts(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(nums, target):\n    return target in nums\n"
        result = await executor.run_tests(code, [
            _tc(
                {"nums": [1, 2, 3], "target": 2},
                True,
                "solve(test_input['nums'], test_input['target'])",
            ),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_missing_key_subscript(self):
        """KeyError should be reported, not crash the wrapper."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(x):\n    return x\n"
        result = await executor.run_tests(code, [
            _tc({"a": 1}, 1, "solve(test_input['missing_key'])"),
        ])
        r = result["results"][0]
        assert r["passed"] is False
        assert r["error"] is not None
        assert "missing_key" in r["error"] or "KeyError" in r["error"]


# ===================================================================
# Sorted wrapper patterns
# ===================================================================


class TestSortedWrappers:
    """Problems with order-insensitive outputs use sorted() wrappers."""

    @pytest.mark.asyncio
    async def test_sorted_wrapper(self):
        executor = CodeExecutor(timeout=10)
        code = "def twoSum(nums, target):\n    return [1, 0]\n"
        result = await executor.run_tests(code, [
            _tc(
                {"nums": [2, 7], "target": 9},
                [0, 1],
                "sorted(twoSum(**test_input))",
            ),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_double_sorted_comprehension(self):
        """sorted([sorted(x) for x in func(**test_input)])"""
        executor = CodeExecutor(timeout=10)
        code = (
            "def groupAnagrams(strs):\n"
            "    from collections import defaultdict\n"
            "    d = defaultdict(list)\n"
            "    for s in strs:\n"
            "        d[tuple(sorted(s))].append(s)\n"
            "    return list(d.values())\n"
        )
        result = await executor.run_tests(code, [
            _tc(
                {"strs": ["eat", "tea", "tan", "ate", "nat", "bat"]},
                [["ate", "eat", "tea"], ["bat"], ["nat", "tan"]],
                "sorted([sorted(x) for x in groupAnagrams(**test_input)])",
            ),
        ])
        assert result["passed"] == 1


# ===================================================================
# Chained helper call patterns (linked list / tree)
# ===================================================================


class TestChainedHelperCalls:
    """Realistic patterns with multiple helper functions chained."""

    @pytest.mark.asyncio
    async def test_merge_two_lists(self):
        """list_node_to_list(merge(list_node(a), list_node(b)))"""
        executor = CodeExecutor(timeout=10)
        code = (
            "def mergeTwoLists(l1, l2):\n"
            "    dummy = ListNode(0)\n"
            "    tail = dummy\n"
            "    while l1 and l2:\n"
            "        if l1.val <= l2.val:\n"
            "            tail.next = l1\n"
            "            l1 = l1.next\n"
            "        else:\n"
            "            tail.next = l2\n"
            "            l2 = l2.next\n"
            "        tail = tail.next\n"
            "    tail.next = l1 or l2\n"
            "    return dummy.next\n"
        )
        result = await executor.run_tests(code, [
            _tc(
                {"l1": [1, 2, 4], "l2": [1, 3, 4]},
                [1, 1, 2, 3, 4, 4],
                "list_node_to_list(mergeTwoLists(list_node(test_input['l1']), list_node(test_input['l2'])))",
            ),
            # Both empty
            _tc(
                {"l1": [], "l2": []},
                None,
                "list_node_to_list(mergeTwoLists(list_node(test_input['l1']), list_node(test_input['l2'])))",
            ),
            # One empty
            _tc(
                {"l1": [], "l2": [1]},
                [1],
                "list_node_to_list(mergeTwoLists(list_node(test_input['l1']), list_node(test_input['l2'])))",
            ),
        ], helpers=["data_structures"])
        assert result["passed"] == 3, [r["error"] or r["actual"] for r in result["results"]]

    @pytest.mark.asyncio
    async def test_tree_max_depth(self):
        """Direct return (no tree_node_to_list), tree_node as input."""
        executor = CodeExecutor(timeout=10)
        code = (
            "def maxDepth(root):\n"
            "    if not root:\n"
            "        return 0\n"
            "    return 1 + max(maxDepth(root.left), maxDepth(root.right))\n"
        )
        result = await executor.run_tests(code, [
            _tc(
                {"root": [3, 9, 20, None, None, 15, 7]},
                3,
                "maxDepth(tree_node(test_input['root']))",
            ),
            _tc(
                {"root": [1]},
                1,
                "maxDepth(tree_node(test_input['root']))",
            ),
            _tc(
                {"root": []},
                0,
                "maxDepth(tree_node(test_input['root']))",
            ),
        ], helpers=["data_structures"])
        assert result["passed"] == 3, [r["error"] or r["actual"] for r in result["results"]]

    @pytest.mark.asyncio
    async def test_tree_bool_return(self):
        """Tree problem returning a boolean (isSymmetric, isSameTree, etc.)."""
        executor = CodeExecutor(timeout=10)
        code = (
            "def isSymmetric(root):\n"
            "    def check(l, r):\n"
            "        if not l and not r:\n"
            "            return True\n"
            "        if not l or not r:\n"
            "            return False\n"
            "        return l.val == r.val and check(l.left, r.right) and check(l.right, r.left)\n"
            "    return check(root.left, root.right) if root else True\n"
        )
        result = await executor.run_tests(code, [
            _tc(
                {"root": [1, 2, 2, 3, 4, 4, 3]},
                True,
                "isSymmetric(tree_node(test_input['root']))",
            ),
            _tc(
                {"root": [1, 2, 2, None, 3, None, 3]},
                False,
                "isSymmetric(tree_node(test_input['root']))",
            ),
        ], helpers=["data_structures"])
        assert result["passed"] == 2, [r["error"] or r["actual"] for r in result["results"]]


# ===================================================================
# Generation pipeline pattern: fname(**test_input) with helpers
# ===================================================================


class TestGenerationPipelinePattern:
    """The exact pattern the generator produces: fname(**test_input) where
    input keys match parameter names, and helpers wrap the input/output."""

    @pytest.mark.asyncio
    async def test_kwargs_with_list_node_helper(self):
        """Generator wraps: list_node_to_list(fname(**test_input))
        where test_input['head'] is a list that gets converted."""
        executor = CodeExecutor(timeout=10)
        code = (
            "def removeNthFromEnd(head, n):\n"
            "    dummy = ListNode(0, head)\n"
            "    fast = slow = dummy\n"
            "    for _ in range(n + 1):\n"
            "        fast = fast.next\n"
            "    while fast:\n"
            "        fast = fast.next\n"
            "        slow = slow.next\n"
            "    slow.next = slow.next.next\n"
            "    return dummy.next\n"
        )
        # Note: input uses raw list, function_call converts it
        result = await executor.run_tests(code, [
            _tc(
                {"head": [1, 2, 3, 4, 5], "n": 2},
                [1, 2, 3, 5],
                "list_node_to_list(removeNthFromEnd(list_node(test_input['head']), test_input['n']))",
            ),
        ], helpers=["data_structures"])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_kwargs_simple_no_helpers(self):
        """Standard generated pattern with no helpers: fname(**test_input)."""
        executor = CodeExecutor(timeout=10)
        code = (
            "def maxProfit(prices):\n"
            "    min_price = float('inf')\n"
            "    max_profit = 0\n"
            "    for price in prices:\n"
            "        min_price = min(min_price, price)\n"
            "        max_profit = max(max_profit, price - min_price)\n"
            "    return max_profit\n"
        )
        result = await executor.run_tests(code, [
            _tc({"prices": [7, 1, 5, 3, 6, 4]}, 5, "maxProfit(**test_input)"),
            _tc({"prices": [7, 6, 4, 3, 1]}, 0, "maxProfit(**test_input)"),
        ])
        assert result["passed"] == 2

    @pytest.mark.asyncio
    async def test_input_with_nested_none_and_booleans(self):
        """A realistic generated test case with mixed types in input."""
        executor = CodeExecutor(timeout=10)
        code = (
            "def solve(matrix, target):\n"
            "    for row in matrix:\n"
            "        if target in row:\n"
            "            return True\n"
            "    return False\n"
        )
        result = await executor.run_tests(code, [
            _tc(
                {"matrix": [[1, 2], [3, 4]], "target": 3},
                True,
                "solve(**test_input)",
            ),
            _tc(
                {"matrix": [[1, 2], [3, 4]], "target": 5},
                False,
                "solve(**test_input)",
            ),
        ])
        assert result["passed"] == 2



# ===================================================================
# Multi-test result aggregation
# ===================================================================


class TestMultiTestAggregation:
    """Verify pass/fail counts and result ordering across multiple tests."""

    @pytest.mark.asyncio
    async def test_mixed_pass_fail(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(n):\n    return n * 2\n"
        result = await executor.run_tests(code, [
            _tc({"n": 1}, 2),   # pass
            _tc({"n": 2}, 5),   # fail (actual=4)
            _tc({"n": 3}, 6),   # pass
            _tc({"n": 0}, 1),   # fail (actual=0)
        ])
        assert result["passed"] == 2
        assert result["failed"] == 2
        assert result["results"][0]["passed"] is True
        assert result["results"][1]["passed"] is False
        assert result["results"][2]["passed"] is True
        assert result["results"][3]["passed"] is False

    @pytest.mark.asyncio
    async def test_all_pass(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(n):\n    return n\n"
        tests = [_tc({"n": i}, i) for i in range(10)]
        result = await executor.run_tests(code, tests)
        assert result["passed"] == 10
        assert result["failed"] == 0

    @pytest.mark.asyncio
    async def test_all_fail(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(n):\n    return -1\n"
        tests = [_tc({"n": i}, i) for i in range(1, 6)]
        result = await executor.run_tests(code, tests)
        assert result["passed"] == 0
        assert result["failed"] == 5

    @pytest.mark.asyncio
    async def test_test_num_field(self):
        """Each result should have the correct test_num (1-indexed)."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(n):\n    return n\n"
        tests = [_tc({"n": i}, i) for i in range(5)]
        result = await executor.run_tests(code, tests)
        for i, r in enumerate(result["results"]):
            assert r["test_num"] == i + 1


# ===================================================================
# Unicode and special character inputs
# ===================================================================


class TestUnicodeInputs:
    """Verify Unicode strings survive the JSON round-trip through the wrapper."""

    @pytest.mark.asyncio
    async def test_unicode_input_string(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(s):\n    return len(s)\n"
        result = await executor.run_tests(code, [
            _tc({"s": "hello world"}, 11),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_emoji_input(self):
        """ensure_ascii=True escapes non-ASCII, so emojis should round-trip."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(s):\n    return s\n"
        result = await executor.run_tests(code, [
            _tc({"s": "hello \u2764"}, "hello \u2764"),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_single_quote_in_input(self):
        """Single quotes in string values must survive the wrapper embedding."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(s):\n    return s\n"
        result = await executor.run_tests(code, [
            _tc({"s": "it's a test"}, "it's a test"),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_backslash_in_input(self):
        """Backslashes in string values must survive escaping."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(s):\n    return s\n"
        result = await executor.run_tests(code, [
            _tc({"s": "path\\to\\file"}, "path\\to\\file"),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_double_quote_in_input(self):
        """Double quotes in string values (JSON uses these internally)."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(s):\n    return s\n"
        result = await executor.run_tests(code, [
            _tc({"s": 'she said "hi"'}, 'she said "hi"'),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_newline_in_input(self):
        executor = CodeExecutor(timeout=10)
        code = "def solve(s):\n    return s.count('\\n')\n"
        result = await executor.run_tests(code, [
            _tc({"s": "line1\nline2\nline3"}, 2),
        ])
        assert result["passed"] == 1

    @pytest.mark.asyncio
    async def test_mixed_special_chars(self):
        """Combine single quotes, backslashes, and newlines."""
        executor = CodeExecutor(timeout=10)
        code = "def solve(s):\n    return s\n"
        val = "it's a \\path\\ with \"quotes\"\nand newlines"
        result = await executor.run_tests(code, [
            _tc({"s": val}, val),
        ])
        assert result["passed"] == 1
