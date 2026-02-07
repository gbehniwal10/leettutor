# Ticket 12: Prevent Test Result Spoofing in Executor

**Priority:** MEDIUM
**Component:** `backend/executor.py`
**Estimated Scope:** Small

## Problem

1. **Result spoofing via stdout** (line 164): The executor parses the last line of stdout as the JSON test result. User code can print a fake result line (e.g., `{"result": [expected], "runtime_ms": 0.1, "stdout": ""}`) to make tests appear to pass.

2. **`sys.__stdout__` bypass** (lines 124, 129): The wrapper redirects `sys.stdout` to `StringIO`, but user code can write to `sys.__stdout__` or `os.write(1, ...)` to inject content into the actual stdout, spoofing the JSON result.

3. **Stderr leaks internal paths** (line 158): Full stderr (including tracebacks with temp file paths and server filesystem layout) is returned to the user.

## Files to Modify

- `backend/executor.py`

## Requirements

1. Use a unique delimiter/marker for the result JSON that user code cannot predict. For example, generate a random token per execution and wrap the result:
   ```python
   marker = secrets.token_hex(16)
   # In wrapper: print(f"{marker}{json.dumps(result)}{marker}")
   # In parser: extract content between markers
   ```

2. Also redirect `sys.__stdout__` (or close fd 1 and reopen it to the StringIO) so user code cannot bypass the capture.

3. Sanitize stderr before returning — strip file paths, or return only the relevant error message (last line of traceback).

## Acceptance Criteria

- User code printing fake JSON results does not affect the test outcome.
- `sys.__stdout__.write()` and `os.write(1, ...)` cannot inject into the result stream.
- Stderr responses do not contain server filesystem paths.
