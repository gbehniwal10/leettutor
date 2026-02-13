# Ticket 80: Adopt Modern Test Patterns from Focus Engine

**Priority:** Low
**Component:** `tests/conftest.py`, all test files
**Estimated Scope:** Medium (incremental, can apply pattern-by-pattern)
**Depends on:** None
**Port of:** focus-engine test suite patterns

## Overview

The focus-engine test suite developed several testing patterns during its hardening phase that improve test clarity, speed, and reliability. This ticket tracks adopting these patterns in leettutor's test suite incrementally.

## Patterns to Adopt

### 1. Bare Object Factory (skip `__init__`)

Instead of complex constructor mocking:
```python
def _make_session(*, tmp_path=None):
    session = WebSocketSession.__new__(WebSocketSession)
    session.tutor = AsyncMock()
    session.ws = AsyncMock()
    # ... set only what the test needs
    return session
```
Clearer than `patch('__init__')` and avoids fragile mock chains.

### 2. Time-Mocking for TTL Tests

Replace `asyncio.sleep()` waits with:
```python
with patch("backend.tutor_registry.time") as mock_time:
    mock_time.monotonic.return_value = base_time + TTL + 1
    registry.sweep()  # Instant, no waiting
```

### 3. Message Filtering via Call List

```python
started = [
    call[0][0] for call in ws.send_json.call_args_list
    if call[0][0].get("type") == "session_started"
]
assert len(started) == 1
```

### 4. Async Lock Mocking

```python
session._lock = AsyncMock()
session._lock.__aenter__ = AsyncMock()
session._lock.__aexit__ = AsyncMock()
```

### 5. Concurrent Safety Tests

```python
@pytest.mark.asyncio
async def test_concurrent_writes():
    tasks = [logger.write(data) for _ in range(10)]
    await asyncio.gather(*tasks)
    assert result_is_consistent
```

### 6. RNG Mocking for Probabilistic Logic

```python
with patch("backend.module.random") as mock_random:
    mock_random.random.return_value = 0.1  # deterministic
    result = probabilistic_function()
assert result == expected
```

## Application Strategy

Apply these patterns incrementally as tests are touched for other tickets. No need to rewrite all tests at once — adopt pattern-by-pattern as opportunities arise.

## Acceptance Criteria

- [ ] At least one example of each pattern exists in the test suite
- [ ] New tests written for other tickets use these patterns where applicable
- [ ] conftest.py updated if new shared fixtures are needed
- [ ] All existing tests continue to pass
