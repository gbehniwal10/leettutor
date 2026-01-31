import subprocess
import sys
import tempfile
import json
from pathlib import Path


DATA_STRUCTURE_HELPERS = '''
from collections import deque

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def list_node(values):
    if not values:
        return None
    head = ListNode(values[0])
    p = head
    for val in values[1:]:
        node = ListNode(val)
        p.next = node
        p = node
    return head

def list_node_to_list(head):
    result = []
    seen = set()
    while head and id(head) not in seen:
        seen.add(id(head))
        result.append(head.val)
        head = head.next
    return result

def list_node_with_cycle(values, pos):
    if not values:
        return None
    head = list_node(values)
    if pos < 0:
        return head
    tail = head
    while tail.next:
        tail = tail.next
    target = head
    for _ in range(pos):
        target = target.next
    tail.next = target
    return head

def tree_node(values):
    if not values:
        return None
    root = TreeNode(values[0])
    i = 1
    queue = deque()
    queue.append(root)
    while queue and i < len(values):
        node = queue.popleft()
        if i < len(values) and values[i] is not None:
            node.left = TreeNode(values[i])
            queue.append(node.left)
        i += 1
        if i < len(values) and values[i] is not None:
            node.right = TreeNode(values[i])
            queue.append(node.right)
        i += 1
    return root

def tree_node_to_list(root):
    if not root:
        return []
    result = []
    queue = deque([root])
    while queue:
        node = queue.popleft()
        if node:
            result.append(node.val)
            queue.append(node.left)
            queue.append(node.right)
        else:
            result.append(None)
    while result and result[-1] is None:
        result.pop()
    return result
'''


class CodeExecutor:
    def __init__(self, timeout: int = 5):
        self.timeout = timeout
        self._python = sys.executable

    def run_tests(self, code: str, test_cases: list[dict], helpers: list[str] | None = None) -> dict:
        results = []
        for i, test in enumerate(test_cases):
            result = self._run_single_test(code, test, i + 1, helpers)
            results.append(result)

        passed = sum(1 for r in results if r["passed"])
        return {"passed": passed, "failed": len(results) - passed, "results": results}

    def _run_single_test(self, code: str, test: dict, test_num: int, helpers: list[str] | None = None) -> dict:
        helper_code = DATA_STRUCTURE_HELPERS if helpers else ""
        wrapper = f'''
import json
import time
import sys
import io

{helper_code}

{code}

if __name__ == "__main__":
    test_input = {json.dumps(test["input"])}
    _captured = io.StringIO()
    sys.stdout = _captured
    start = time.perf_counter()
    try:
        result = {test["function_call"]}
        elapsed = (time.perf_counter() - start) * 1000
        sys.stdout = sys.__stdout__
        stdout_text = _captured.getvalue()
        print(json.dumps({{"result": result, "runtime_ms": elapsed, "stdout": stdout_text}}))
    except Exception as e:
        sys.stdout = sys.__stdout__
        stdout_text = _captured.getvalue()
        print(json.dumps({{"error": str(e), "stdout": stdout_text}}))
'''

        f = tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False)
        f.write(wrapper)
        f.close()
        tmp_path = Path(f.name)

        try:
            result = subprocess.run(
                [self._python, str(tmp_path)],
                capture_output=True,
                timeout=self.timeout,
                text=True,
            )

            if result.returncode != 0:
                return {
                    "test_num": test_num,
                    "input": test["input"],
                    "expected": test["expected"],
                    "actual": None,
                    "passed": False,
                    "error": result.stderr.strip(),
                    "runtime_ms": None,
                    "stdout": result.stdout.strip() if result.stdout else "",
                }

            try:
                output = json.loads(result.stdout.strip().splitlines()[-1])
            except (json.JSONDecodeError, IndexError):
                return {
                    "test_num": test_num,
                    "input": test["input"],
                    "expected": test["expected"],
                    "actual": None,
                    "passed": False,
                    "error": f"Unexpected output: {result.stdout.strip()[:200]}",
                    "runtime_ms": None,
                    "stdout": "",
                }

            if "error" in output:
                return {
                    "test_num": test_num,
                    "input": test["input"],
                    "expected": test["expected"],
                    "actual": None,
                    "passed": False,
                    "error": output["error"],
                    "runtime_ms": None,
                    "stdout": output.get("stdout", ""),
                }

            return {
                "test_num": test_num,
                "input": test["input"],
                "expected": test["expected"],
                "actual": output["result"],
                "passed": output["result"] == test["expected"],
                "error": None,
                "runtime_ms": output["runtime_ms"],
                "stdout": output.get("stdout", ""),
            }

        except subprocess.TimeoutExpired:
            return {
                "test_num": test_num,
                "input": test["input"],
                "expected": test["expected"],
                "actual": None,
                "passed": False,
                "error": f"Time Limit Exceeded ({self.timeout}s)",
                "runtime_ms": None,
                "stdout": "",
            }
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass
