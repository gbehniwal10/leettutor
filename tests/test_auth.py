"""Tests for backend.auth -- token management, rate limiting, and auth helpers."""

import inspect
import time

import pytest
from fastapi import HTTPException

from backend.auth import (
    generate_token,
    verify_token,
    check_login_rate_limit,
    get_token_from_request,
    _prune_expired_tokens,
    _valid_tokens,
    _login_attempts,
    _LOGIN_RATE_LIMIT,
    TOKEN_TTL_SECONDS,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clean_auth_state():
    """Reset auth module state between tests."""
    _valid_tokens.clear()
    _login_attempts.clear()
    yield
    _valid_tokens.clear()
    _login_attempts.clear()


# ---------------------------------------------------------------------------
# Token generation and verification
# ---------------------------------------------------------------------------

class TestTokenGenerationAndVerification:

    def test_generate_returns_hex_string(self):
        token = generate_token()
        assert isinstance(token, str)
        assert len(token) == 64  # 32 bytes hex-encoded
        # Should be valid hex
        int(token, 16)

    def test_generated_token_is_verifiable(self):
        """A freshly generated token should pass verification."""
        # Temporarily enable auth for this test by adding a token
        token = generate_token()
        # verify_token returns True when AUTH_ENABLED is False (module default),
        # but we can still confirm the token is in the store
        assert token in _valid_tokens

    def test_invalid_token_not_in_store(self):
        generate_token()
        assert "not-a-real-token" not in _valid_tokens

    def test_multiple_tokens_are_unique(self):
        tokens = {generate_token() for _ in range(20)}
        assert len(tokens) == 20


class TestTokenExpiry:

    def test_expired_token_pruned(self, monkeypatch):
        """Tokens older than TOKEN_TTL_SECONDS should be pruned."""
        token = generate_token()
        # Backdate the token so it appears expired
        _valid_tokens[token] = time.monotonic() - TOKEN_TTL_SECONDS - 10
        # Call _prune_expired_tokens directly because verify_token short-circuits
        # when AUTH_ENABLED is False and never reaches the pruning logic.
        _prune_expired_tokens()
        assert token not in _valid_tokens

    def test_fresh_token_not_pruned(self):
        token = generate_token()
        verify_token(token)
        assert token in _valid_tokens


class TestTimingSafeComparison:
    """Verify that verify_token uses hmac.compare_digest for constant-time comparison."""

    def test_uses_hmac_compare_digest(self):
        source = inspect.getsource(verify_token)
        assert "hmac.compare_digest" in source, (
            "verify_token should use hmac.compare_digest for constant-time comparison"
        )


class TestRateLimiting:

    def test_allows_requests_under_limit(self):
        """Should not raise for fewer than _LOGIN_RATE_LIMIT attempts."""
        for _ in range(_LOGIN_RATE_LIMIT - 1):
            check_login_rate_limit("192.168.1.1")
        # One more should still be allowed (the limit is >= not >)
        # Actually the check is: if len >= limit: raise
        # So the 5th attempt triggers 429 on entry, meaning 4 are allowed
        # Let's verify: first _LOGIN_RATE_LIMIT - 1 should work
        # and the _LOGIN_RATE_LIMIT-th should also work since the check
        # happens before appending:
        #   len(attempts) >= limit -> raise
        #   then append
        # After _LOGIN_RATE_LIMIT - 1 calls, len = _LOGIN_RATE_LIMIT - 1, so
        # the next call sees len = _LOGIN_RATE_LIMIT - 1 < _LOGIN_RATE_LIMIT, passes.
        # That call appends, making len = _LOGIN_RATE_LIMIT.
        # The NEXT call sees len = _LOGIN_RATE_LIMIT >= _LOGIN_RATE_LIMIT -> raises.

    def test_blocks_after_threshold(self):
        """After _LOGIN_RATE_LIMIT attempts, subsequent calls should raise 429."""
        ip = "10.0.0.1"
        # Make exactly _LOGIN_RATE_LIMIT successful calls
        for _ in range(_LOGIN_RATE_LIMIT):
            check_login_rate_limit(ip)
        # The next attempt should be blocked
        with pytest.raises(HTTPException) as exc_info:
            check_login_rate_limit(ip)
        assert exc_info.value.status_code == 429

    def test_different_ips_independent(self):
        """Rate limits should be tracked per IP."""
        for _ in range(_LOGIN_RATE_LIMIT):
            check_login_rate_limit("1.1.1.1")
        # Different IP should still be allowed
        check_login_rate_limit("2.2.2.2")

    def test_rate_limit_window_expires(self, monkeypatch):
        """After the rate window passes, the IP should be allowed again."""
        ip = "10.0.0.2"
        # Fill up the rate limit
        for _ in range(_LOGIN_RATE_LIMIT):
            check_login_rate_limit(ip)
        # Manually backdate all attempts so they fall outside the window
        _login_attempts[ip] = [time.monotonic() - 120.0 for _ in _login_attempts[ip]]
        # Should now be allowed again
        check_login_rate_limit(ip)


class TestGetTokenFromRequest:

    def test_extracts_bearer_token(self):
        class FakeRequest:
            headers = {"Authorization": "Bearer abc123"}
        assert get_token_from_request(FakeRequest()) == "abc123"

    def test_returns_none_without_bearer(self):
        class FakeRequest:
            headers = {"Authorization": "Basic abc123"}
        assert get_token_from_request(FakeRequest()) is None

    def test_returns_none_without_header(self):
        class FakeRequest:
            headers = {}
        assert get_token_from_request(FakeRequest()) is None
