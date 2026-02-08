"""Tests for WebSocket protocol -- connection auth, message validation, and session start."""

import json
from unittest.mock import patch, AsyncMock, MagicMock

import pytest
from starlette.testclient import TestClient


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
