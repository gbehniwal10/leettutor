"""Thorough tests for data-structure helpers injected by the executor.

The helpers (ListNode, TreeNode, list_node, tree_node, etc.) are defined
as a code string in ``executor_helpers.py`` and exec'd into the sandbox.
We test them both **in-process** (fast, supports property-based testing)
and **through the executor subprocess** (integration).

The bug that motivated this file: ``list_node_to_list(None)`` returned
``[]`` instead of ``None``, causing test-case comparisons to fail when
the expected value was ``null``/``None``.
"""

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

from backend.executor import CodeExecutor
from backend.executor import DATA_STRUCTURE_HELPERS

# ---------------------------------------------------------------------------
# In-process helper namespace — exec the helper code once for fast tests
# ---------------------------------------------------------------------------

_NS = {}
exec(DATA_STRUCTURE_HELPERS, _NS)

ListNode = _NS["ListNode"]
TreeNode = _NS["TreeNode"]
list_node = _NS["list_node"]
list_node_to_list = _NS["list_node_to_list"]
list_node_with_cycle = _NS["list_node_with_cycle"]
tree_node = _NS["tree_node"]
tree_node_to_list = _NS["tree_node_to_list"]

# ---------------------------------------------------------------------------
# Strategies for Hypothesis
# ---------------------------------------------------------------------------

# Integer values that fit in a typical LeetCode problem
lc_int = st.integers(min_value=-(10**4), max_value=10**4)

# Non-empty lists of ints (linked-list values)
linked_list_values = st.lists(lc_int, min_size=1, max_size=50)

# Tree values: valid level-order sequences where child values only appear
# if their parent is non-None.  This mirrors LeetCode's serialization format.
@st.composite
def tree_values(draw):
    """Generate a valid BFS level-order tree serialization."""
    root_val = draw(lc_int)
    values = [root_val]
    # Track how many non-None nodes need children
    pending_parents = 1
    max_depth_nodes = draw(st.integers(min_value=0, max_value=15))
    added = 0
    while pending_parents > 0 and added < max_depth_nodes:
        # For each pending parent, generate left and right children
        val = draw(st.one_of(lc_int, st.none()))
        values.append(val)
        added += 1
        if val is not None:
            pending_parents += 1
        pending_parents -= 0  # children come in pairs, decrement after both
        if added < max_depth_nodes:
            val2 = draw(st.one_of(lc_int, st.none()))
            values.append(val2)
            added += 1
            if val2 is not None:
                pending_parents += 1
        pending_parents -= 1  # one parent fully processed
    return values


# ===================================================================
# Linked-list helpers — property-based
# ===================================================================


class TestLinkedListRoundTrip:
    """list_node_to_list(list_node(x)) == x for all valid inputs."""

    @given(values=linked_list_values)
    @settings(max_examples=200)
    def test_round_trip(self, values):
        head = list_node(values)
        assert list_node_to_list(head) == values

    @given(values=linked_list_values)
    @settings(max_examples=100)
    def test_list_node_builds_correct_length(self, values):
        head = list_node(values)
        length = 0
        curr = head
        while curr:
            length += 1
            curr = curr.next
        assert length == len(values)

    @given(values=linked_list_values)
    @settings(max_examples=100)
    def test_list_node_first_value(self, values):
        head = list_node(values)
        assert head.val == values[0]

    @given(values=linked_list_values)
    @settings(max_examples=100)
    def test_list_node_last_next_is_none(self, values):
        head = list_node(values)
        curr = head
        while curr.next:
            curr = curr.next
        assert curr.next is None


# ===================================================================
# Linked-list helpers — explicit edge cases
# ===================================================================


class TestLinkedListEdgeCases:
    """Boundary conditions that property tests might miss."""

    def test_none_input_to_list_node(self):
        assert list_node(None) is None

    def test_empty_list_to_list_node(self):
        assert list_node([]) is None

    def test_none_input_to_list_node_to_list(self):
        """The bug: this used to return [] instead of None."""
        assert list_node_to_list(None) is None

    def test_empty_round_trip(self):
        """list_node([]) -> None -> list_node_to_list(None) -> None."""
        head = list_node([])
        assert head is None
        assert list_node_to_list(head) is None

    def test_single_element(self):
        head = list_node([42])
        assert list_node_to_list(head) == [42]
        assert head.next is None

    def test_two_elements(self):
        head = list_node([1, 2])
        assert list_node_to_list(head) == [1, 2]
        assert head.val == 1
        assert head.next.val == 2
        assert head.next.next is None

    def test_negative_values(self):
        vals = [-1, -100, 0, 100]
        assert list_node_to_list(list_node(vals)) == vals

    def test_large_values(self):
        vals = [10**9, -(10**9)]
        assert list_node_to_list(list_node(vals)) == vals

    def test_duplicate_values(self):
        vals = [1, 1, 1, 1]
        assert list_node_to_list(list_node(vals)) == vals

    def test_cycle_detection_stops(self):
        """list_node_to_list should not infinite-loop on a cyclic list."""
        head = list_node_with_cycle([1, 2, 3], 0)
        result = list_node_to_list(head)
        # Should get at most all values (cycle detection via id set)
        assert len(result) == 3
        assert result == [1, 2, 3]

    def test_cycle_at_tail(self):
        head = list_node_with_cycle([1, 2, 3], 2)
        result = list_node_to_list(head)
        assert result == [1, 2, 3]

    def test_no_cycle_negative_pos(self):
        head = list_node_with_cycle([1, 2, 3], -1)
        result = list_node_to_list(head)
        assert result == [1, 2, 3]


# ===================================================================
# Tree helpers — property-based
# ===================================================================


class TestTreeRoundTrip:
    """tree_node_to_list(tree_node(x)) == x for all valid level-order inputs."""

    @given(values=tree_values())
    @settings(max_examples=200)
    def test_round_trip(self, values):
        root = tree_node(values)
        result = tree_node_to_list(root)
        # tree_node_to_list strips trailing Nones, so normalize expected
        expected = list(values)
        while expected and expected[-1] is None:
            expected.pop()
        assert result == expected

    @given(values=tree_values())
    @settings(max_examples=100)
    def test_root_value(self, values):
        root = tree_node(values)
        assert root is not None
        assert root.val == values[0]


# ===================================================================
# Tree helpers — explicit edge cases
# ===================================================================


class TestTreeEdgeCases:
    """Boundary conditions for tree helpers."""

    def test_none_input_to_tree_node(self):
        assert tree_node(None) is None

    def test_empty_list_to_tree_node(self):
        assert tree_node([]) is None

    def test_none_input_to_tree_node_to_list(self):
        """The bug: this used to return [] instead of None."""
        assert tree_node_to_list(None) is None

    def test_empty_round_trip(self):
        root = tree_node([])
        assert root is None
        assert tree_node_to_list(root) is None

    def test_single_node(self):
        root = tree_node([1])
        assert tree_node_to_list(root) == [1]
        assert root.left is None
        assert root.right is None

    def test_complete_binary_tree(self):
        vals = [1, 2, 3, 4, 5, 6, 7]
        root = tree_node(vals)
        assert tree_node_to_list(root) == vals

    def test_left_skewed(self):
        vals = [1, 2, None, 3, None, 4]
        root = tree_node(vals)
        result = tree_node_to_list(root)
        expected = [1, 2, None, 3, None, 4]
        while expected and expected[-1] is None:
            expected.pop()
        assert result == expected

    def test_right_skewed(self):
        vals = [1, None, 2, None, 3, None, 4]
        root = tree_node(vals)
        result = tree_node_to_list(root)
        expected = [1, None, 2, None, 3, None, 4]
        while expected and expected[-1] is None:
            expected.pop()
        assert result == expected

    def test_tree_with_none_holes(self):
        vals = [1, None, 3]
        root = tree_node(vals)
        assert root.left is None
        assert root.right is not None
        assert root.right.val == 3
        assert tree_node_to_list(root) == [1, None, 3]

    def test_negative_and_zero_values(self):
        vals = [0, -1, -2]
        assert tree_node_to_list(tree_node(vals)) == vals

    def test_large_values_in_tree(self):
        vals = [10**9, -(10**9)]
        assert tree_node_to_list(tree_node(vals)) == vals

    def test_trailing_nones_stripped(self):
        """tree_node_to_list should strip trailing Nones from output."""
        vals = [1, 2, None]
        root = tree_node(vals)
        result = tree_node_to_list(root)
        assert result == [1, 2]  # trailing None stripped


# ===================================================================
# ListNode/TreeNode class behavior
# ===================================================================


class TestNodeClasses:
    """Verify the node classes themselves work correctly."""

    def test_list_node_defaults(self):
        node = ListNode()
        assert node.val == 0
        assert node.next is None

    def test_list_node_with_val(self):
        node = ListNode(42)
        assert node.val == 42

    def test_list_node_with_next(self):
        b = ListNode(2)
        a = ListNode(1, b)
        assert a.next is b

    def test_tree_node_defaults(self):
        node = TreeNode()
        assert node.val == 0
        assert node.left is None
        assert node.right is None

    def test_tree_node_with_children(self):
        left = TreeNode(2)
        right = TreeNode(3)
        root = TreeNode(1, left, right)
        assert root.left is left
        assert root.right is right


# ===================================================================
# Executor integration — run helpers through the real subprocess
# ===================================================================


def _make_test_case(input_dict, expected, function_call):
    return {"input": input_dict, "expected": expected, "function_call": function_call}


class TestHelpersThroughExecutor:
    """End-to-end tests: helpers run inside the sandboxed subprocess."""

    @pytest.mark.asyncio
    async def test_linked_list_none_returns_none(self):
        """The exact bug scenario: function returns None, expected is None."""
        executor = CodeExecutor(timeout=10)
        code = "def deleteNode(head):\n    return None\n"
        test_cases = [
            _make_test_case(
                {"head": []},
                None,
                "list_node_to_list(deleteNode(list_node(test_input['head'])))",
            ),
        ]
        result = await executor.run_tests(code, test_cases, helpers=["list_node"])
        assert result["passed"] == 1
        assert result["results"][0]["actual"] is None

    @pytest.mark.asyncio
    async def test_tree_none_returns_none(self):
        executor = CodeExecutor(timeout=10)
        code = "def pruneTree(root):\n    return None\n"
        test_cases = [
            _make_test_case(
                {"root": []},
                None,
                "tree_node_to_list(pruneTree(tree_node(test_input['root'])))",
            ),
        ]
        result = await executor.run_tests(code, test_cases, helpers=["tree_node"])
        assert result["passed"] == 1
        assert result["results"][0]["actual"] is None

    @pytest.mark.asyncio
    async def test_linked_list_reverse(self):
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
            _make_test_case(
                {"head": [1, 2, 3, 4, 5]},
                [5, 4, 3, 2, 1],
                "list_node_to_list(reverseList(list_node(test_input['head'])))",
            ),
            _make_test_case(
                {"head": [1]},
                [1],
                "list_node_to_list(reverseList(list_node(test_input['head'])))",
            ),
            _make_test_case(
                {"head": []},
                None,
                "list_node_to_list(reverseList(list_node(test_input['head'])))",
            ),
        ]
        result = await executor.run_tests(code, test_cases, helpers=["list_node"])
        assert result["passed"] == 3, [r["error"] or r["actual"] for r in result["results"]]

    @pytest.mark.asyncio
    async def test_tree_invert(self):
        executor = CodeExecutor(timeout=10)
        code = (
            "def invertTree(root):\n"
            "    if not root:\n"
            "        return None\n"
            "    root.left, root.right = invertTree(root.right), invertTree(root.left)\n"
            "    return root\n"
        )
        test_cases = [
            _make_test_case(
                {"root": [4, 2, 7, 1, 3, 6, 9]},
                [4, 7, 2, 9, 6, 3, 1],
                "tree_node_to_list(invertTree(tree_node(test_input['root'])))",
            ),
            _make_test_case(
                {"root": [1]},
                [1],
                "tree_node_to_list(invertTree(tree_node(test_input['root'])))",
            ),
            _make_test_case(
                {"root": []},
                None,
                "tree_node_to_list(invertTree(tree_node(test_input['root'])))",
            ),
        ]
        result = await executor.run_tests(code, test_cases, helpers=["tree_node"])
        assert result["passed"] == 3, [r["error"] or r["actual"] for r in result["results"]]

    @pytest.mark.asyncio
    async def test_linked_list_cycle_detection(self):
        """hasCycle should work with list_node_with_cycle helper."""
        executor = CodeExecutor(timeout=10)
        code = (
            "def hasCycle(head):\n"
            "    slow = fast = head\n"
            "    while fast and fast.next:\n"
            "        slow = slow.next\n"
            "        fast = fast.next.next\n"
            "        if slow is fast:\n"
            "            return True\n"
            "    return False\n"
        )
        test_cases = [
            _make_test_case(
                {"head": [3, 2, 0, -4], "pos": 1},
                True,
                "hasCycle(list_node_with_cycle(test_input['head'], test_input['pos']))",
            ),
            _make_test_case(
                {"head": [1], "pos": -1},
                False,
                "hasCycle(list_node_with_cycle(test_input['head'], test_input['pos']))",
            ),
        ]
        result = await executor.run_tests(code, test_cases, helpers=["list_node"])
        assert result["passed"] == 2, [r["error"] or r["actual"] for r in result["results"]]
