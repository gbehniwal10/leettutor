"""Tests for backend.session_logger -- session persistence and retrieval."""

import json

import pytest

from backend.session_logger import SessionLogger, _is_valid_session_id


# ---------------------------------------------------------------------------
# Session ID validation
# ---------------------------------------------------------------------------

class TestSessionIdValidation:

    def test_valid_hex_id(self):
        assert _is_valid_session_id("abcdef01234567890abcdef012345678") is True

    def test_short_hex_id(self):
        assert _is_valid_session_id("abcdef01") is True

    def test_too_short_id(self):
        assert _is_valid_session_id("abc") is False

    def test_non_hex_chars(self):
        assert _is_valid_session_id("xyz_not_hex!") is False

    def test_empty_string(self):
        assert _is_valid_session_id("") is False

    def test_none(self):
        assert _is_valid_session_id(None) is False

    def test_integer(self):
        assert _is_valid_session_id(12345678) is False


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

class TestSessionLifecycle:

    @pytest.mark.asyncio
    async def test_start_session(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        session_id = await logger.start_session("two-sum", "learning")
        assert _is_valid_session_id(session_id)
        assert logger.current_session is not None
        assert logger.current_session["problem_id"] == "two-sum"
        assert logger.current_session["mode"] == "learning"

    @pytest.mark.asyncio
    async def test_session_persisted_to_disk(self, tmp_path):
        sessions_dir = tmp_path / "sessions"
        logger = SessionLogger(sessions_dir=str(sessions_dir))
        session_id = await logger.start_session("two-sum", "learning")
        filepath = sessions_dir / f"{session_id}.json"
        assert filepath.exists()
        data = json.loads(filepath.read_text())
        assert data["session_id"] == session_id
        assert data["problem_id"] == "two-sum"

    @pytest.mark.asyncio
    async def test_log_message(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        await logger.start_session("two-sum", "learning")
        await logger.log_message("user", "How do I solve this?")
        await logger.log_message("assistant", "Think about hash maps.")
        assert len(logger.current_session["chat_history"]) == 2
        assert logger.current_session["chat_history"][0]["role"] == "user"
        assert logger.current_session["chat_history"][1]["role"] == "assistant"

    @pytest.mark.asyncio
    async def test_log_hint_requested(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        await logger.start_session("two-sum", "learning")
        await logger.log_hint_requested()
        await logger.log_hint_requested()
        assert logger.current_session["hints_requested"] == 2

    @pytest.mark.asyncio
    async def test_log_code_submission(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        await logger.start_session("two-sum", "learning")
        await logger.log_code_submission("def twoSum(): pass", {"passed": 0, "failed": 3})
        assert len(logger.current_session["code_submissions"]) == 1

    @pytest.mark.asyncio
    async def test_end_session(self, tmp_path):
        sessions_dir = tmp_path / "sessions"
        logger = SessionLogger(sessions_dir=str(sessions_dir))
        session_id = await logger.start_session("two-sum", "learning")
        await logger.end_session(final_result="solved", notes="Easy problem")
        assert logger.current_session is None
        # Verify on disk
        data = json.loads((sessions_dir / f"{session_id}.json").read_text())
        assert data["ended_at"] is not None
        assert data["final_result"] == "solved"
        assert data["duration_seconds"] is not None

    @pytest.mark.asyncio
    async def test_log_phase_transition(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        await logger.start_session("two-sum", "interview")
        await logger.log_phase_transition("coding")
        assert len(logger.current_session["phase_transitions"]) == 1
        assert logger.current_session["phase_transitions"][0]["phase"] == "coding"


# ---------------------------------------------------------------------------
# Session retrieval
# ---------------------------------------------------------------------------

class TestSessionRetrieval:

    @pytest.mark.asyncio
    async def test_get_session(self, tmp_path):
        sessions_dir = tmp_path / "sessions"
        logger = SessionLogger(sessions_dir=str(sessions_dir))
        session_id = await logger.start_session("two-sum", "learning")
        await logger.end_session()
        # Use a fresh logger to verify file-based retrieval
        logger2 = SessionLogger(sessions_dir=str(sessions_dir))
        data = await logger2.get_session(session_id)
        assert data is not None
        assert data["session_id"] == session_id

    @pytest.mark.asyncio
    async def test_get_nonexistent_session(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        data = await logger.get_session("00000000deadbeef")
        assert data is None

    @pytest.mark.asyncio
    async def test_list_sessions(self, tmp_path):
        sessions_dir = tmp_path / "sessions"
        logger = SessionLogger(sessions_dir=str(sessions_dir))
        await logger.start_session("two-sum", "learning")
        await logger.end_session()
        await logger.start_session("valid-anagram", "interview")
        await logger.end_session()
        sessions = await logger.list_sessions()
        assert len(sessions) == 2

    @pytest.mark.asyncio
    async def test_delete_session(self, tmp_path):
        sessions_dir = tmp_path / "sessions"
        logger = SessionLogger(sessions_dir=str(sessions_dir))
        session_id = await logger.start_session("two-sum", "learning")
        await logger.end_session()
        deleted = await logger.delete_session(session_id)
        assert deleted is True
        assert await logger.get_session(session_id) is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_session(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        deleted = await logger.delete_session("00000000deadbeef")
        assert deleted is False


# ---------------------------------------------------------------------------
# Resume support
# ---------------------------------------------------------------------------

class TestSessionResume:

    @pytest.mark.asyncio
    async def test_resume_session(self, tmp_path):
        sessions_dir = tmp_path / "sessions"
        logger = SessionLogger(sessions_dir=str(sessions_dir))
        session_id = await logger.start_session("two-sum", "learning")
        await logger.log_message("user", "Hello")
        await logger.end_session()
        # Resume
        data = await logger.resume_session(session_id)
        assert data is not None
        assert data["ended_at"] is None  # Cleared for active use
        assert logger.current_session is not None

    @pytest.mark.asyncio
    async def test_resume_nonexistent_session(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        data = await logger.resume_session("00000000deadbeef")
        assert data is None

    @pytest.mark.asyncio
    async def test_update_editor_code(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        await logger.start_session("two-sum", "learning")
        await logger.update_editor_code("def twoSum(): return [0, 1]")
        assert logger.current_session["last_editor_code"] == "def twoSum(): return [0, 1]"

    @pytest.mark.asyncio
    async def test_update_time_remaining(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        await logger.start_session("two-sum", "interview")
        await logger.update_time_remaining(1200)
        assert logger.current_session["time_remaining"] == 1200

    @pytest.mark.asyncio
    async def test_update_claude_session_id(self, tmp_path):
        logger = SessionLogger(sessions_dir=str(tmp_path / "sessions"))
        await logger.start_session("two-sum", "learning")
        await logger.update_claude_session_id("claude-abc-123")
        assert logger.current_session["claude_session_id"] == "claude-abc-123"
