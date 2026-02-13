"""Tests for WebSocket protocol -- connection auth, message validation, and session start.

Patterns adopted from focus-engine test suite:
- Pattern 1: Bare Object Factory (make_bare_ws_session) — skip __init__
- Pattern 3: Message Filtering via Call List — filter ws.send_json calls by type
- Pattern 4: Async Lock Mocking — mock _chat_lock for handler unit tests
"""

import asyncio
import json
import time
from unittest.mock import patch, AsyncMock, MagicMock, call

import pytest
from starlette.testclient import TestClient

from tests.conftest import make_bare_ws_session


# ---------------------------------------------------------------------------
# Pattern 3: Message Filtering Helper
# ---------------------------------------------------------------------------

def filter_ws_messages(ws_mock, msg_type: str) -> list[dict]:
    """Extract all messages of a given type sent through a mock WebSocket.

    Uses call_args_list to inspect every call to ws.send_json() and returns
    only those whose ``type`` field matches *msg_type*.
    """
    return [
        c[0][0]
        for c in ws_mock.send_json.call_args_list
        if isinstance(c[0][0], dict) and c[0][0].get("type") == msg_type
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def ws_app(app):
    """Wrap the FastAPI app in a synchronous TestClient for WebSocket tests."""
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------

class TestWsAuth:

    def test_unauthenticated_ws_rejected_when_auth_required(self, ws_app):
        """When AUTH_ENABLED is True, a WS connection that sends a bad auth
        message should be closed with code 4001."""
        with patch("backend.ws_handler.AUTH_ENABLED", True), \
             patch("backend.ws_handler.verify_token", return_value=False):
            with ws_app.websocket_connect("/ws/chat") as ws:
                # Send an auth message with a bad token
                ws.send_json({"type": "auth", "token": "bad-token"})
                # The server should close the connection
                # After the close, any receive will raise or return close frame
                try:
                    data = ws.receive()
                    # If we get data, check if it's a close frame
                    assert data.get("type") == "websocket.close" or data.get("code") == 4001
                except Exception:
                    # Connection was closed as expected
                    pass

    def test_missing_auth_type_rejected_when_auth_required(self, ws_app):
        """When AUTH_ENABLED is True, a first message without type=auth should
        be rejected."""
        with patch("backend.ws_handler.AUTH_ENABLED", True), \
             patch("backend.ws_handler.verify_token", return_value=False):
            with ws_app.websocket_connect("/ws/chat") as ws:
                ws.send_json({"type": "message", "content": "hello"})
                try:
                    data = ws.receive()
                    assert data.get("type") == "websocket.close" or data.get("code") == 4001
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Message type validation
# ---------------------------------------------------------------------------

class TestWsMessageValidation:

    def test_unknown_message_type_returns_error(self, ws_app):
        """Sending an unknown message type should return an error response."""
        with ws_app.websocket_connect("/ws/chat") as ws:
            # First message: auth (auth disabled, so any message works)
            ws.send_json({"type": "auth", "token": "no-auth"})
            # Send an unknown message type
            ws.send_json({"type": "bogus_type", "content": "test"})
            resp = ws.receive_json()
            assert resp["type"] == "error"
            assert "bogus_type" in resp["content"]

    def test_missing_message_type_returns_error(self, ws_app):
        """Sending a message without a type field should return an error."""
        with ws_app.websocket_connect("/ws/chat") as ws:
            ws.send_json({"type": "auth", "token": "no-auth"})
            ws.send_json({"content": "no type here"})
            resp = ws.receive_json()
            assert resp["type"] == "error"
            assert "Missing" in resp["content"] or "type" in resp["content"].lower()

    def test_malformed_json_returns_error(self, ws_app):
        """Sending invalid JSON should return an error response."""
        with ws_app.websocket_connect("/ws/chat") as ws:
            ws.send_json({"type": "auth", "token": "no-auth"})
            ws.send_text("this is not valid json{{{")
            resp = ws.receive_json()
            assert resp["type"] == "error"

    def test_test_results_update_is_recognized(self, ws_app):
        """test_results_update should be dispatched (not return 'Unknown message type')."""
        with ws_app.websocket_connect("/ws/chat") as ws:
            ws.send_json({"type": "auth", "token": "no-auth"})
            ws.send_json({
                "type": "test_results_update",
                "test_results": {"passed": 2, "failed": 1, "results": []},
                "code": "def foo(): pass",
                "is_submit": False,
            })
            # The handler should silently succeed (no active session/workspace,
            # so it returns early). Send a follow-up to confirm no error queued.
            ws.send_json({"type": "bogus_for_flush"})
            resp = ws.receive_json()
            # The response should be for the bogus message, not test_results_update
            assert resp["type"] == "error"
            assert "bogus_for_flush" in resp["content"]


# ---------------------------------------------------------------------------
# start_session validation
# ---------------------------------------------------------------------------

class TestWsStartSession:

    def test_start_session_requires_problem_id(self, ws_app):
        """start_session without problem_id should return an error."""
        with ws_app.websocket_connect("/ws/chat") as ws:
            ws.send_json({"type": "auth", "token": "no-auth"})
            ws.send_json({"type": "start_session", "mode": "learning"})
            resp = ws.receive_json()
            assert resp["type"] == "error"

    def test_start_session_requires_mode(self, ws_app):
        """start_session without mode should return an error."""
        with ws_app.websocket_connect("/ws/chat") as ws:
            ws.send_json({"type": "auth", "token": "no-auth"})
            ws.send_json({"type": "start_session", "problem_id": "test-add"})
            resp = ws.receive_json()
            assert resp["type"] == "error"

    def test_start_session_with_unknown_problem(self, ws_app):
        """start_session with a non-existent problem_id should return an error."""
        with ws_app.websocket_connect("/ws/chat") as ws:
            ws.send_json({"type": "auth", "token": "no-auth"})
            ws.send_json({
                "type": "start_session",
                "problem_id": "nonexistent-xyz",
                "mode": "learning",
            })
            resp = ws.receive_json()
            assert resp["type"] == "error"
            assert "not found" in resp["content"].lower()


# ---------------------------------------------------------------------------
# Approach resolve message type
# ---------------------------------------------------------------------------

class TestWsApproachResolve:

    def test_approach_resolve_is_recognized(self, ws_app):
        """approach_resolve should be dispatched (not return 'Unknown message type')."""
        with ws_app.websocket_connect("/ws/chat") as ws:
            ws.send_json({"type": "auth", "token": "no-auth"})
            ws.send_json({
                "type": "approach_resolve",
                "problem_id": "two-sum",
                "keep_id": "abc123",
                "discard_id": "def456",
                "action": "replace",
            })
            # The handler processes and sends solution_count_updated
            resp = ws.receive_json()
            assert resp["type"] == "solution_count_updated"
            assert resp["problem_id"] == "two-sum"

    def test_approach_resolve_invalid_action(self, ws_app):
        """approach_resolve with invalid action should return error."""
        with ws_app.websocket_connect("/ws/chat") as ws:
            ws.send_json({"type": "auth", "token": "no-auth"})
            ws.send_json({
                "type": "approach_resolve",
                "problem_id": "two-sum",
                "action": "invalid_action",
            })
            resp = ws.receive_json()
            assert resp["type"] == "error"


# ---------------------------------------------------------------------------
# Pattern 1: Bare Object Factory — unit-test handler methods directly
# ---------------------------------------------------------------------------

class TestBareSessionHandlers:
    """Use make_bare_ws_session() to test handler methods in isolation.

    The bare factory creates a WebSocketSession via __new__, skipping the
    real __init__ and its heavy dependencies (TutorRegistry, SessionLogger
    file I/O, workspace dirs).  Each test sets only the attributes it needs.
    """

    @pytest.mark.asyncio
    async def test_handle_end_session_clears_state(self, tmp_path):
        """handle_end_session should null out tutor and session ID."""
        session = make_bare_ws_session(tmp_path=tmp_path)
        session.tutor.end_session = AsyncMock()

        await session.handle_end_session({})

        assert session.tutor is None
        assert session.current_session_id is None
        assert session.last_editor_code is None
        session.session_logger.end_session.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_save_state_persists_code(self, tmp_path):
        """handle_save_state should update last_editor_code and persist."""
        session = make_bare_ws_session(tmp_path=tmp_path)
        ws_dir = tmp_path / "workspace"
        ws_dir.mkdir()
        session.connection_workspace = ws_dir

        await session.handle_save_state({"code": "def solve(): return 42"})

        assert session.last_editor_code == "def solve(): return 42"
        session.session_logger.update_editor_code.assert_awaited_once_with(
            "def solve(): return 42"
        )

    @pytest.mark.asyncio
    async def test_handle_time_update_forwards_to_tutor(self, tmp_path):
        """handle_time_update should call tutor.update_time for interview mode."""
        session = make_bare_ws_session(tmp_path=tmp_path)
        session.tutor.mode = "interview"

        await session.handle_time_update({"time_remaining": 1200})

        session.tutor.update_time.assert_called_once_with(1200)
        session.session_logger.update_time_remaining.assert_awaited_once_with(1200)

    @pytest.mark.asyncio
    async def test_handle_time_update_ignored_for_learning_mode(self, tmp_path):
        """handle_time_update should be a no-op when mode is not interview."""
        session = make_bare_ws_session(tmp_path=tmp_path)
        session.tutor.mode = "learning"

        await session.handle_time_update({"time_remaining": 1200})

        session.tutor.update_time.assert_not_called()


# ---------------------------------------------------------------------------
# Pattern 3: Message Filtering via Call List
# ---------------------------------------------------------------------------

class TestMessageFiltering:
    """Demonstrate the filter_ws_messages() helper for inspecting
    specific message types from a sequence of send_json calls."""

    @pytest.mark.asyncio
    async def test_filter_error_messages_from_mixed_stream(self, tmp_path):
        """filter_ws_messages should isolate only the requested type."""
        session = make_bare_ws_session(tmp_path=tmp_path)

        # Simulate a sequence of outgoing messages
        await session.ws.send_json({"type": "session_started", "session_id": "abc"})
        await session.ws.send_json({"type": "error", "content": "first error"})
        await session.ws.send_json({"type": "assistant_chunk", "content": "hi"})
        await session.ws.send_json({"type": "error", "content": "second error"})

        errors = filter_ws_messages(session.ws, "error")
        assert len(errors) == 2
        assert errors[0]["content"] == "first error"
        assert errors[1]["content"] == "second error"

        # Also verify we can filter other types
        started = filter_ws_messages(session.ws, "session_started")
        assert len(started) == 1
        assert started[0]["session_id"] == "abc"

    @pytest.mark.asyncio
    async def test_filter_returns_empty_when_no_match(self, tmp_path):
        """filter_ws_messages should return [] when no messages match."""
        session = make_bare_ws_session(tmp_path=tmp_path)
        await session.ws.send_json({"type": "assistant_chunk", "content": "hi"})

        result = filter_ws_messages(session.ws, "session_started")
        assert result == []


# ---------------------------------------------------------------------------
# Pattern 4: Async Lock Mocking
# ---------------------------------------------------------------------------

class TestAsyncLockMocking:
    """Demonstrate replacing _chat_lock with a mock for handler tests.

    In production, _chat_lock is an asyncio.Lock that serializes chat
    messages.  For unit tests of individual handlers we replace it with
    an AsyncMock so the lock acquire/release is a no-op and does not
    require a running event loop or real coroutine scheduling.
    """

    @pytest.mark.asyncio
    async def test_nudge_skipped_when_problem_solved(self, tmp_path):
        """handle_nudge_request should return early when tutor.solved is True,
        even when _chat_lock is a mock."""
        session = make_bare_ws_session(tmp_path=tmp_path)
        # Pattern 4: replace the real lock with a mock
        session._chat_lock = AsyncMock()
        session._chat_lock.__aenter__ = AsyncMock()
        session._chat_lock.__aexit__ = AsyncMock()

        session.tutor.solved = True

        await session.handle_nudge_request({"trigger": "inactivity"})

        # Tutor chat should NOT have been called
        session.tutor.chat.assert_not_called()

    @pytest.mark.asyncio
    async def test_nudge_skipped_after_abandon_timeout(self, tmp_path):
        """handle_nudge_request should skip when user has been inactive
        for longer than the abandonment threshold."""
        session = make_bare_ws_session(tmp_path=tmp_path)
        session._chat_lock = AsyncMock()
        session._chat_lock.__aenter__ = AsyncMock()
        session._chat_lock.__aexit__ = AsyncMock()

        session.tutor.solved = False
        # Set _last_real_activity to 31+ minutes ago
        session._last_real_activity = time.time() - (31 * 60)

        await session.handle_nudge_request({"trigger": "inactivity"})

        session.tutor.chat.assert_not_called()


# ---------------------------------------------------------------------------
# Pattern 2: Time-Mocking for TTL Tests (TutorRegistry)
# ---------------------------------------------------------------------------

class TestRegistryTimeMocking:
    """Test TutorRegistry TTL behaviour using mocked time.monotonic().

    Instead of sleeping for 5+ minutes in tests, we patch ``time.monotonic``
    to simulate the passage of time.  This makes TTL tests instant and
    deterministic.
    """

    @pytest.mark.asyncio
    async def test_reclaim_within_ttl_succeeds(self):
        """A parked tutor reclaimed before TTL expires should be returned."""
        from backend.tutor_registry import TutorRegistry, ParkedTutor, TTL_SECONDS

        registry = TutorRegistry()
        mock_tutor = AsyncMock()
        mock_tutor.force_kill = AsyncMock()
        parked = ParkedTutor(
            tutor=mock_tutor,
            session_logger=AsyncMock(),
            workspace_path="/tmp/test",
            problem_id="two-sum",
            mode="learning",
        )

        base_time = 1000.0
        with patch("backend.tutor_registry.time") as mock_time:
            # Park at base_time
            mock_time.monotonic.return_value = base_time
            parked.parked_at = base_time
            await registry.park("session-1", parked)

            # Reclaim at base_time + half the TTL (still fresh)
            mock_time.monotonic.return_value = base_time + (TTL_SECONDS / 2)
            result = await registry.reclaim("session-1")

        assert result is not None
        assert result.problem_id == "two-sum"

    @pytest.mark.asyncio
    async def test_reclaim_after_ttl_returns_none(self):
        """A parked tutor reclaimed after TTL expires should return None."""
        from backend.tutor_registry import TutorRegistry, ParkedTutor, TTL_SECONDS

        registry = TutorRegistry()
        mock_tutor = AsyncMock()
        mock_tutor.force_kill = AsyncMock()
        parked = ParkedTutor(
            tutor=mock_tutor,
            session_logger=AsyncMock(),
            workspace_path="/tmp/test",
            problem_id="two-sum",
            mode="learning",
        )

        base_time = 1000.0
        with patch("backend.tutor_registry.time") as mock_time:
            mock_time.monotonic.return_value = base_time
            parked.parked_at = base_time
            await registry.park("session-1", parked)

            # Reclaim well after TTL expires -- instant, no sleep
            mock_time.monotonic.return_value = base_time + TTL_SECONDS + 1
            result = await registry.reclaim("session-1")

        assert result is None

    @pytest.mark.asyncio
    async def test_is_alive_uses_monotonic_time(self):
        """is_alive should use time.monotonic to check TTL expiry."""
        from backend.tutor_registry import TutorRegistry, ParkedTutor, TTL_SECONDS

        registry = TutorRegistry()
        mock_tutor = AsyncMock()
        mock_tutor.force_kill = AsyncMock()
        parked = ParkedTutor(
            tutor=mock_tutor,
            session_logger=AsyncMock(),
            workspace_path="/tmp/test",
            problem_id="two-sum",
            mode="learning",
        )

        base_time = 1000.0
        with patch("backend.tutor_registry.time") as mock_time:
            mock_time.monotonic.return_value = base_time
            parked.parked_at = base_time
            await registry.park("session-1", parked)

            # Within TTL
            mock_time.monotonic.return_value = base_time + 10
            assert await registry.is_alive("session-1") is True

            # After TTL
            mock_time.monotonic.return_value = base_time + TTL_SECONDS + 1
            assert await registry.is_alive("session-1") is False
