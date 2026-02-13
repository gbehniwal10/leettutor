"""Authentication module: token management, rate limiting, and auth dependencies."""

import hmac
import os
import secrets
import time
from collections import defaultdict

from fastapi import HTTPException
from pydantic import BaseModel
from starlette.requests import Request

# --- Configuration ---

LEETTUTOR_PASSWORD = os.environ.get("LEETTUTOR_PASSWORD")
AUTH_ENABLED = LEETTUTOR_PASSWORD is not None and LEETTUTOR_PASSWORD != ""

# Token storage: token -> creation timestamp (monotonic)
_valid_tokens: dict[str, float] = {}
TOKEN_TTL_SECONDS = int(os.environ.get("LEETTUTOR_TOKEN_TTL", str(24 * 60 * 60)))

# Login rate limiting: IP -> list of attempt timestamps
_login_attempts: dict[str, list[float]] = defaultdict(list)
_LOGIN_RATE_LIMIT = 5        # max attempts
_LOGIN_RATE_WINDOW = 60.0    # per this many seconds


# --- Token Management ---

def generate_token() -> str:
    """Create a new auth token and store it."""
    token = secrets.token_hex(32)
    _valid_tokens[token] = time.monotonic()
    return token


def _prune_expired_tokens() -> None:
    """Remove tokens older than TOKEN_TTL_SECONDS and stale rate-limit entries."""
    now = time.monotonic()
    expired = [t for t, created_at in _valid_tokens.items()
               if now - created_at > TOKEN_TTL_SECONDS]
    for t in expired:
        del _valid_tokens[t]

    # Prune stale rate-limit entries (last attempt older than the window)
    stale_ips = [
        ip for ip, attempts in _login_attempts.items()
        if attempts and attempts[-1] < now - _LOGIN_RATE_WINDOW
    ]
    for ip in stale_ips:
        del _login_attempts[ip]


def verify_token(token: str | None) -> bool:
    """Check if a token is valid. Uses constant-time comparison."""
    if not AUTH_ENABLED:
        return True
    if token is None:
        return False
    _prune_expired_tokens()
    # Use constant-time comparison to prevent timing attacks
    for stored_token in _valid_tokens:
        if hmac.compare_digest(token, stored_token):
            return True
    return False


# --- Rate Limiting ---

def check_login_rate_limit(client_ip: str) -> None:
    """Raise 429 if the IP has exceeded the login rate limit."""
    now = time.monotonic()
    attempts = _login_attempts[client_ip]
    cutoff = now - _LOGIN_RATE_WINDOW
    _login_attempts[client_ip] = [t for t in attempts if t > cutoff]
    if len(_login_attempts[client_ip]) >= _LOGIN_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")
    _login_attempts[client_ip].append(now)


# --- Request Helpers ---

class LoginRequest(BaseModel):
    password: str


def get_token_from_request(request: Request) -> str | None:
    """Extract Bearer token from Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


async def require_auth(request: Request):
    """FastAPI dependency that enforces authentication on protected endpoints."""
    if not AUTH_ENABLED:
        return
    token = get_token_from_request(request)
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")
