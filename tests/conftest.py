"""Shared fixtures for LeetCode Tutor test suite."""

import asyncio
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


# ---------------------------------------------------------------------------
# Pattern 1: Bare Object Factory — skip __init__ for WebSocketSession
# ---------------------------------------------------------------------------

def make_bare_ws_session(*, tmp_path=None):
    """Create a WebSocketSession with __new__ (skip __init__).

    This avoids constructing real SessionLogger, TutorRegistry, etc.
    Only the attributes needed by the test are set — callers add more
    as needed.  This pattern is clearer than ``patch('__init__')`` and
    avoids fragile mock chains.
    """
    from backend.ws_handler import WebSocketSession

    session = WebSocketSession.__new__(WebSocketSession)
    session.ws = AsyncMock()
    session.tutor = AsyncMock()
    session.tutor.solved = False
    session.tutor.mode = "learning"
    session.tutor.interview_phase = None
    session.tutor.claude_session_id = "mock-claude-id"
    session.tutor.hint_count = 0
    session.session_logger = AsyncMock()
    session.session_logger.current_session = {
        "problem_id": "two-sum",
        "mode": "learning",
        "hints_requested": 0,
    }
    session.connection_workspace = Path(tmp_path) if tmp_path else None
    session.current_session_id = "abcdef0123456789"
    session.last_editor_code = None
    session._ws_alive = True
    session._chat_lock = asyncio.Lock()
    session._last_real_activity = 0.0
    session.solution_store = AsyncMock()
    session.tutor_registry = AsyncMock()
    session.problem_history = AsyncMock()
    session.learning_history = AsyncMock()
    session.review_scheduler = AsyncMock()
    session.api_session_logger = AsyncMock()
    session.sessions_dir = str(tmp_path) if tmp_path else "/tmp"
    session.workspace_dir = Path(tmp_path) if tmp_path else Path("/tmp")
    return session


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
        "approaches": ["Brute Force O(n²)", "Hash Map O(n)"],
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
    mock_history.record_solve = AsyncMock()

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

    # Mock solution store
    mock_solution_store = MagicMock()
    mock_solution_store.save_solution = AsyncMock(return_value={"id": "mock_sol_id"})
    mock_solution_store.list_solutions = AsyncMock(return_value=[])
    mock_solution_store.get_solution = AsyncMock(return_value=None)
    mock_solution_store.delete_solution = AsyncMock(return_value=False)
    mock_solution_store.update_label = AsyncMock(return_value=None)
    mock_solution_store.get_solution_counts = AsyncMock(return_value={})

    # Mock learning history and review scheduler
    mock_learning_history = MagicMock()
    mock_learning_history.get_all_topic_summaries = MagicMock(return_value={})
    mock_learning_history.load = AsyncMock()

    mock_review_scheduler = MagicMock()
    mock_review_scheduler.get_due_topics = MagicMock(return_value=[])
    mock_review_scheduler.get_due_problems = MagicMock(return_value=[])
    mock_review_scheduler.load = AsyncMock()

    with patch("backend.server.list_problems", return_value=[
        {"id": sample_problem["id"], "title": sample_problem["title"],
         "difficulty": sample_problem["difficulty"], "tags": sample_problem["tags"]}
    ]), patch("backend.server.get_problem", side_effect=lambda pid: sample_problem if pid == sample_problem["id"] else None), \
         patch("backend.server.get_random_problem", side_effect=_mock_get_random), \
         patch("backend.server._problem_history", mock_history), \
         patch("backend.server._solution_store", mock_solution_store), \
         patch("backend.server._learning_history", mock_learning_history), \
         patch("backend.server._review_scheduler", mock_review_scheduler), \
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
