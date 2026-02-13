import asyncio
import logging
import os
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import json
from pathlib import Path

logger = logging.getLogger(__name__)

# Platform detection for resource limiting
_IS_MACOS = sys.platform == "darwin"

# Maximum code size in bytes (50 KB)
MAX_CODE_SIZE = 50 * 1024

# Resource limits for sandboxed execution
MEMORY_LIMIT_BYTES = 512 * 1024 * 1024  # 512 MB
CPU_TIME_LIMIT_SECONDS = 10              # hard CPU time limit
MAX_FILE_SIZE = 1 * 1024 * 1024          # 1 MB

# Timeout (seconds) to wait for a killed process to be reaped
_KILL_WAIT_TIMEOUT = 3

# Log platform-specific memory limiting strategy at import time
if _IS_MACOS:
    logger.warning(
        "macOS detected: using RLIMIT_RSS for memory limiting "
        "(RLIMIT_AS is unreliable on this platform)"
    )
else:
    logger.info("Linux detected: using RLIMIT_AS for memory limiting")

# Allowed identifiers in function_call expressions (helpers + basic access patterns)
_SAFE_FUNCTION_CALL_RE = re.compile(
    r'^[a-zA-Z_][a-zA-Z0-9_]*'           # starts with identifier
    r'[\w\s\(\)\[\]\'\",=.*:_\-]*$'       # only safe chars: parens, brackets, quotes, etc.
)

# Characters/patterns that must NOT appear in function_call
_DANGEROUS_PATTERNS = [
    '__',          # dunder access
    'import ',     # import statements
    'open(',       # file access
    'eval(',       # eval
    'exec(',       # exec
    'compile(',    # compile
    'getattr',     # attribute access
    'setattr',
    'delattr',
    'globals',
    'locals',
    'vars(',
    'dir(',
    'os.',
    'sys.',
    'subprocess',
    'shutil',
    'pathlib',
    'socket',
    'http',
    'urllib',
    '\\n',         # newlines
    ';',           # statement separator
]


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
    if head is None:
        return None
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
    if root is None:
        return None
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


def _validate_function_call(function_call: str) -> str:
    """Validate that a function_call expression from problem JSON is safe.

    Since function_call comes from server-controlled problem files (not user input),
    this is a defense-in-depth measure against compromised problem files.
    """
    for pattern in _DANGEROUS_PATTERNS:
        if pattern in function_call:
            raise ValueError(f"Unsafe function_call expression: contains '{pattern}'")
    if not _SAFE_FUNCTION_CALL_RE.match(function_call):
        raise ValueError(f"Unsafe function_call expression: failed pattern validation")
    return function_call


def _resource_limits_code() -> str:
    """Return Python source that sets resource limits inside the wrapper script.

    On macOS, RLIMIT_AS is often ignored by the kernel, so we use RLIMIT_RSS
    (resident set size) instead, which is more reliably enforced.
    On Linux, RLIMIT_AS works correctly and is preferred.
    """
    if _IS_MACOS:
        memory_limit_line = f"_safe_setrlimit(resource.RLIMIT_RSS, {MEMORY_LIMIT_BYTES})"
    else:
        memory_limit_line = f"_safe_setrlimit(resource.RLIMIT_AS, {MEMORY_LIMIT_BYTES})"

    return f'''import resource, sys
def _safe_setrlimit(res, limit):
    try:
        resource.setrlimit(res, (limit, limit))
    except ValueError:
        # Hard limit may be lower than requested; use it instead
        _, hard = resource.getrlimit(res)
        if hard > 0 and hard < limit:
            resource.setrlimit(res, (hard, hard))
{memory_limit_line}
_safe_setrlimit(resource.RLIMIT_CPU, {CPU_TIME_LIMIT_SECONDS})
_safe_setrlimit(resource.RLIMIT_FSIZE, {MAX_FILE_SIZE})
try:
    _safe_setrlimit(resource.RLIMIT_NPROC, 0)
except (AttributeError, OSError):
    pass  # RLIMIT_NPROC not available on all platforms
'''


async def _wait_for_killed_process(proc):
    """Wait briefly for a killed process to be reaped, preventing zombies."""
    try:
        await asyncio.wait_for(proc.wait(), timeout=_KILL_WAIT_TIMEOUT)
    except (asyncio.TimeoutError, ProcessLookupError, OSError):
        pass


class CodeExecutor:
    def __init__(self, timeout: int = 5):
        self.timeout = timeout
        self._python = sys.executable

    async def run_tests(self, code: str, test_cases: list[dict], helpers: list[str] | None = None) -> dict:
        # Validate code size
        if len(code.encode('utf-8')) > MAX_CODE_SIZE:
            return {
                "passed": 0,
                "failed": len(test_cases),
                "results": [
                    {
                        "test_num": i + 1,
                        "input": t.get("input"),
                        "expected": t.get("expected"),
                        "actual": None,
                        "passed": False,
                        "error": f"Code exceeds maximum size of {MAX_CODE_SIZE // 1024}KB",
                        "runtime_ms": None,
                        "stdout": "",
                    }
                    for i, t in enumerate(test_cases)
                ],
            }

        results = []
        consecutive_tle = 0
        max_consecutive_tle = 3
        for i, test in enumerate(test_cases):
            result = await self._run_single_test(code, test, i + 1, helpers)
            results.append(result)

            is_tle = (result.get("error") or "").startswith("Time Limit Exceeded")
            consecutive_tle = consecutive_tle + 1 if is_tle else 0

            if consecutive_tle >= max_consecutive_tle:
                skipped_start = len(results)
                for j, t in enumerate(test_cases[skipped_start:]):
                    results.append({
                        "test_num": skipped_start + j + 1,
                        "input": t.get("input"),
                        "expected": t.get("expected"),
                        "actual": None,
                        "passed": False,
                        "error": f"Skipped — {max_consecutive_tle} consecutive Time Limit Exceeded",
                        "runtime_ms": None,
                        "stdout": "",
                    })
                break

        passed = sum(1 for r in results if r["passed"])
        return {"passed": passed, "failed": len(results) - passed, "results": results}

    async def _run_single_test(self, code: str, test: dict, test_num: int, helpers: list[str] | None = None) -> dict:
        # Validate function_call before interpolation
        try:
            function_call = _validate_function_call(test["function_call"])
        except ValueError as e:
            return {
                "test_num": test_num,
                "input": test["input"],
                "expected": test["expected"],
                "actual": None,
                "passed": False,
                "error": str(e),
                "runtime_ms": None,
                "stdout": "",
            }

        helper_code = DATA_STRUCTURE_HELPERS if helpers else ""
        rlimit_code = _resource_limits_code()
        test_input_json = json.dumps(test["input"], ensure_ascii=True)
        marker = secrets.token_hex(32)

        # Escape the JSON string for safe embedding in a Python single-quoted string.
        # json.dumps(ensure_ascii=True) only uses double quotes for strings, but
        # string VALUES may contain single quotes or backslashes that would break
        # a Python single-quoted wrapper.
        safe_json = test_input_json.replace("\\", "\\\\").replace("'", "\\'")

        # Compute line offset so we can map errors back to user code lines
        pre_code = f'\n{rlimit_code}\nimport json\nimport time\nimport sys\nimport io\nimport os\nfrom typing import List, Optional, Dict, Tuple, Set\n\n{helper_code}\n\n'
        user_code_offset = pre_code.count('\n')
        user_code_num_lines = code.count('\n') + 1

        wrapper = f'''
{rlimit_code}
import json
import time
import sys
import io
import os
from typing import List, Optional, Dict, Tuple, Set

{helper_code}

{code}

if __name__ == "__main__":
    test_input = json.loads('{safe_json}')
    _captured = io.StringIO()
    sys.stdout = _captured
    sys.__stdout__ = _captured
    try:
        _devnull_fd = os.open(os.devnull, os.O_WRONLY)
        os.dup2(_devnull_fd, 1)
        os.close(_devnull_fd)
    except OSError:
        pass
    start = time.perf_counter()
    try:
        result = {function_call}
        elapsed = (time.perf_counter() - start) * 1000
        stdout_text = _captured.getvalue()
        _out = json.dumps({{"result": result, "runtime_ms": elapsed, "stdout": stdout_text}})
    except Exception as e:
        import traceback as _tb
        _frames = _tb.extract_tb(sys.exc_info()[2])
        _line = ""
        for _f in reversed(_frames):
            _adj = _f.lineno - {user_code_offset}
            if 0 < _adj <= {user_code_num_lines}:
                _line = f" (line {{_adj}})"
                break
        stdout_text = _captured.getvalue()
        _out = json.dumps({{"error": str(e) + _line, "stdout": stdout_text}})
    sys.stderr.write("{marker}" + _out + "{marker}")
'''

        f = tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False)
        f.write(wrapper)
        f.close()
        tmp_path = Path(f.name)

        proc = None
        try:
            # Use start_new_session=True so we can kill the entire process group on timeout
            proc = await asyncio.create_subprocess_exec(
                self._python, str(tmp_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
                env=_get_restricted_env(),
            )

            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    proc.communicate(), timeout=self.timeout
                )
                stdout = stdout_bytes.decode() if stdout_bytes else ""
                stderr = stderr_bytes.decode() if stderr_bytes else ""
            except asyncio.TimeoutError:
                # Kill entire process group, not just the parent
                _kill_process_group(proc)
                await _wait_for_killed_process(proc)
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

            # Extract result from stderr using the unique marker
            result_json_str = None
            if stderr and marker in stderr:
                parts = stderr.split(marker)
                if len(parts) >= 3:
                    result_json_str = parts[1]
                # Remove marker-delimited result from stderr
                stderr = stderr.replace(marker + (result_json_str or "") + marker, "")

            # Sanitize stderr: strip file paths and include adjusted line number
            stderr = _sanitize_stderr(stderr, user_code_offset, user_code_num_lines)

            if proc.returncode != 0 and result_json_str is None:
                return {
                    "test_num": test_num,
                    "input": test["input"],
                    "expected": test["expected"],
                    "actual": None,
                    "passed": False,
                    "error": stderr.strip() if stderr else "Process exited with non-zero status",
                    "runtime_ms": None,
                    "stdout": stdout.strip() if stdout else "",
                }

            if result_json_str is None:
                return {
                    "test_num": test_num,
                    "input": test["input"],
                    "expected": test["expected"],
                    "actual": None,
                    "passed": False,
                    "error": "No result received from execution",
                    "runtime_ms": None,
                    "stdout": "",
                }

            try:
                output = json.loads(result_json_str)
            except (json.JSONDecodeError, IndexError):
                return {
                    "test_num": test_num,
                    "input": test["input"],
                    "expected": test["expected"],
                    "actual": None,
                    "passed": False,
                    "error": "Failed to parse execution result",
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

        except Exception as e:
            # Ensure process group is cleaned up on any error
            if proc is not None:
                _kill_process_group(proc)
                await _wait_for_killed_process(proc)
            return {
                "test_num": test_num,
                "input": test["input"],
                "expected": test["expected"],
                "actual": None,
                "passed": False,
                "error": f"Execution error: {str(e)}",
                "runtime_ms": None,
                "stdout": "",
            }
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _sanitize_stderr(stderr: str, user_code_offset: int = 0, user_code_num_lines: int = 0) -> str:
    """Strip file paths and return error with adjusted line number."""
    if not stderr or not stderr.strip():
        return ""
    # Replace temp file paths with generic name
    sanitized = re.sub(r'File "(/[^"]*?/)?[^"]*\.py"', 'File "<user_code>"', stderr)
    # Strip any remaining absolute paths, keeping the filename readable
    # Matches paths like /tmp/..., /var/..., /Users/..., /home/..., etc.
    sanitized = re.sub(
        r'(/(?:[^\s,"\':/]+/)+)([^\s,"\':/]+)',
        lambda m: f'<sandbox>/{m.group(2)}',
        sanitized,
    )
    lines = sanitized.strip().splitlines()
    if len(lines) > 1 and lines[0].strip().startswith("Traceback"):
        error_line = lines[-1].strip()
        # Find the last "line N" reference within user code range
        adjusted = None
        for line in reversed(lines):
            m = re.search(r'File "<user_code>", line (\d+)', line)
            if m:
                orig = int(m.group(1))
                adj = orig - user_code_offset
                if 0 < adj <= user_code_num_lines:
                    adjusted = adj
                    break
        if adjusted is not None:
            return f"{error_line} (line {adjusted})"
        return error_line
    return sanitized.strip()


def _kill_process_group(proc):
    """Kill the entire process group to ensure all child processes are terminated."""
    if proc.returncode is not None:
        return  # Already exited; avoid killing a reused PID
    try:
        pgid = os.getpgid(proc.pid)
        os.killpg(pgid, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        pass
    try:
        proc.kill()
    except (OSError, ProcessLookupError):
        pass


def _get_restricted_env() -> dict:
    """Return a minimal environment for the subprocess, stripping sensitive variables."""
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": tempfile.gettempdir(),
        "TMPDIR": tempfile.gettempdir(),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
    }
    # Preserve virtualenv/conda prefix so the correct interpreter and
    # standard library are found, but do NOT carry over PYTHONPATH or
    # other Python-specific env vars that could let sandboxed code import
    # modules from the host (ticket #46).
    for key in ("VIRTUAL_ENV", "CONDA_PREFIX"):
        if key in os.environ:
            env[key] = os.environ[key]
    # Explicitly excluded (never copy into sandbox):
    #   PYTHONPATH, PYTHONSTARTUP, PYTHONHOME, PYTHONUSERBASE, PYTHONPLATLIBDIR
    return env
