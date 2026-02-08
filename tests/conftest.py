"""Shared fixtures for LeetCode Tutor test suite."""

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

# Ensure the project root is on sys.path so 'backend' package resolves
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# ---------------------------------------------------------------------------
# Stub out claude_code_sdk if it is not installed so that importing
# backend.tutor (and everything that depends on it) works without the SDK.
# This MUST happen before any backend imports in test files.
# ---------------------------------------------------------------------------
if "claude_code_sdk" not in sys.modules:
    _sdk_stub = MagicMock()
    _sdk_stub.ClaudeSDKClient = MagicMock
    _sdk_stub.ClaudeCodeOptions = MagicMock
    _sdk_stub.AssistantMessage = type("AssistantMessage", (), {})
    _sdk_stub.ResultMessage = type("ResultMessage", (), {})
    _sdk_stub.TextBlock = type("TextBlock", (), {})
    sys.modules["claude_code_sdk"] = _sdk_stub


@pytest.fixture
def sample_problem():
    """A minimal problem dict matching the schema used by the executor and API."""
    return {
        "id": "test-add",
        "title": "Test Add",
        "difficulty": "easy",
        "tags": ["array"],
        "description": "Return the sum of a and b.",
        "starter_code": "def add(a: int, b: int) -> int:\n    pass\n",
        "function_name": "add",
        "test_cases": [
            {
                "input": {"a": 1, "b": 2},
                "expected": 3,
                "function_call": "add(**test_input)",
            },
            {
                "input": {"a": -1, "b": 1},
                "expected": 0,
                "function_call": "add(**test_input)",
            },
        ],
        "hidden_test_cases": [
            {
                "input": {"a": 100, "b": 200},
                "expected": 300,
                "function_call": "add(**test_input)",
            },
        ],
        "hints": ["Think about the + operator."],
    }


@pytest.fixture
def temp_dir(tmp_path):
    """Provide a temporary directory for workspace/session files."""
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    return tmp_path


@pytest.fixture
def auth_token():
    """Generate a valid auth token when auth is enabled.

    This fixture patches the auth module to enable authentication and returns
    a freshly generated token. Tests that need to exercise unauthenticated
    paths should NOT use this fixture.
    """
    from backend.auth import generate_token, _valid_tokens

    token = generate_token()
    yield token
    # Cleanup: remove the token we generated
    _valid_tokens.pop(token, None)


@pytest.fixture
def app(tmp_path, sample_problem):
    """Create a FastAPI TestClient-compatible app with mocked heavy dependencies.

    Heavy external dependencies (TutorRegistry startup/shutdown, Claude SDK,
    PatternExplainPool) are mocked out so tests run fast and offline.
    """
    # Mock the problem history so api_list_problems can call _problem_history.get_all()
    mock_history = MagicMock()
    mock_history.get_all = AsyncMock(return_value={})

    # Patch the problem set with our sample problem so API tests have known data
    def _mock_get_random(difficulty=None, tags=None):
        candidates = [sample_problem]
        if difficulty and sample_problem["difficulty"] != difficulty:
            candidates = []
        if tags and not any(t in sample_problem["tags"] for t in tags):
            candidates = []
        return candidates[0] if candidates else None

    _mock_skill_tree = {
        "version": 1,
        "categories": [
            {
                "id": "basics",
                "title": "Basics",
                "prerequisites": [],
                "problems": [sample_problem["id"]],
            }
        ],
    }

    with patch("backend.server.list_problems", return_value=[
        {"id": sample_problem["id"], "title": sample_problem["title"],
         "difficulty": sample_problem["difficulty"], "tags": sample_problem["tags"]}
    ]), patch("backend.server.get_problem", side_effect=lambda pid: sample_problem if pid == sample_problem["id"] else None), \
         patch("backend.server.get_random_problem", side_effect=_mock_get_random), \
         patch("backend.server._problem_history", mock_history), \
         patch("backend.server.get_skill_tree", return_value=_mock_skill_tree), \
         patch("backend.server.load_skill_tree", return_value=_mock_skill_tree):
        from backend.server import app as fastapi_app
        yield fastapi_app


@pytest.fixture
async def client(app):
    """Async HTTP client for testing REST endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
