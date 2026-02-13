"""Tests for backend.server -- REST API endpoints.

These tests use httpx.AsyncClient with ASGITransport to call the FastAPI app
directly (no real server needed). Heavy dependencies (TutorRegistry,
PatternExplainPool, Claude SDK) are mocked via the `app` fixture in conftest.
"""

from unittest.mock import patch, AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient


# ---------------------------------------------------------------------------
# Health check endpoint
# ---------------------------------------------------------------------------

class TestHealthCheckEndpoint:

    @pytest.mark.asyncio
    async def test_health_check_returns_ok(self, client):
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"status": "ok"}


# ---------------------------------------------------------------------------
# Auth status endpoint
# ---------------------------------------------------------------------------

class TestAuthStatusEndpoint:

    @pytest.mark.asyncio
    async def test_auth_status_returns_flag(self, client):
        resp = await client.get("/api/auth/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "auth_required" in data
        assert isinstance(data["auth_required"], bool)


# ---------------------------------------------------------------------------
# Problems endpoint
# ---------------------------------------------------------------------------

class TestProblemsEndpoint:

    @pytest.mark.asyncio
    async def test_list_problems_returns_list(self, client, sample_problem):
        resp = await client.get("/api/problems")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        # Our sample problem should appear
        ids = [p["id"] for p in data]
        assert sample_problem["id"] in ids

    @pytest.mark.asyncio
    async def test_get_problem_found(self, client, sample_problem):
        resp = await client.get(f"/api/problems/{sample_problem['id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == sample_problem["id"]
        assert data["title"] == sample_problem["title"]
        # hidden_test_cases should be excluded
        assert "hidden_test_cases" not in data

    @pytest.mark.asyncio
    async def test_get_problem_includes_approaches(self, client, sample_problem):
        """Problem detail should include the approaches field."""
        resp = await client.get(f"/api/problems/{sample_problem['id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert "approaches" in data
        assert isinstance(data["approaches"], list)
        assert len(data["approaches"]) >= 1

    @pytest.mark.asyncio
    async def test_get_problem_not_found(self, client):
        resp = await client.get("/api/problems/nonexistent-xyz")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Review queue endpoint
# ---------------------------------------------------------------------------

class TestReviewQueueEndpoint:

    @pytest.mark.asyncio
    async def test_review_queue_returns_structure(self, client):
        resp = await client.get("/api/review-queue")
        assert resp.status_code == 200
        data = resp.json()
        assert "due_problems" in data
        assert "due_topics" in data
        assert "topic_summaries" in data
        assert isinstance(data["due_problems"], list)
        assert isinstance(data["due_topics"], list)


# ---------------------------------------------------------------------------
# Run endpoint
# ---------------------------------------------------------------------------

class TestRunEndpoint:

    @pytest.mark.asyncio
    async def test_run_with_valid_code(self, client, sample_problem):
        """POST /api/run with correct code should return passing results."""
        resp = await client.post("/api/run", json={
            "code": "def add(a, b):\n    return a + b\n",
            "problem_id": sample_problem["id"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["passed"] == len(sample_problem["test_cases"])
        assert data["failed"] == 0

    @pytest.mark.asyncio
    async def test_run_with_wrong_code(self, client, sample_problem):
        """POST /api/run with incorrect code should return failures."""
        resp = await client.post("/api/run", json={
            "code": "def add(a, b):\n    return 0\n",
            "problem_id": sample_problem["id"],
        })
        assert resp.status_code == 200
        data = resp.json()
        # At least one test should fail (since add(1,2) != 0 for expected=3)
        assert data["failed"] > 0

    @pytest.mark.asyncio
    async def test_run_nonexistent_problem(self, client):
        """POST /api/run with invalid problem_id should return 404."""
        resp = await client.post("/api/run", json={
            "code": "def add(a, b): return a + b",
            "problem_id": "nonexistent-xyz",
        })
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_run_missing_code_field(self, client, sample_problem):
        """POST /api/run without code field should return 422 validation error."""
        resp = await client.post("/api/run", json={
            "problem_id": sample_problem["id"],
        })
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Root endpoint (serves HTML)
# ---------------------------------------------------------------------------

class TestRootEndpoint:

    @pytest.mark.asyncio
    async def test_root_returns_html(self, client):
        resp = await client.get("/")
        assert resp.status_code == 200
        assert "text/html" in resp.headers.get("content-type", "")


# ---------------------------------------------------------------------------
# Login endpoint
# ---------------------------------------------------------------------------

class TestLoginEndpoint:

    @pytest.mark.asyncio
    async def test_login_when_auth_disabled(self, client):
        """When auth is disabled, login should succeed with any password."""
        resp = await client.post("/api/login", json={"password": "anything"})
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data

    @pytest.mark.asyncio
    async def test_login_missing_password(self, client):
        """POST /api/login without password should return 422."""
        resp = await client.post("/api/login", json={})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Sessions endpoint
# ---------------------------------------------------------------------------

class TestSessionsEndpoint:

    @pytest.mark.asyncio
    async def test_list_sessions(self, client):
        resp = await client.get("/api/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_get_session_invalid_id(self, client):
        """Invalid session ID format should return 400."""
        resp = await client.get("/api/sessions/bad!")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_get_session_not_found(self, client):
        resp = await client.get("/api/sessions/00000000deadbeef")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_session_not_found(self, client):
        resp = await client.delete("/api/sessions/00000000deadbeef")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Random problem endpoint
# ---------------------------------------------------------------------------

class TestRandomProblemEndpoint:

    @pytest.mark.asyncio
    async def test_random_returns_id(self, client, sample_problem):
        """GET /api/problems/random should return a problem id."""
        resp = await client.get("/api/problems/random")
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert data["id"] == sample_problem["id"]

    @pytest.mark.asyncio
    async def test_random_with_difficulty(self, client, sample_problem):
        """GET /api/problems/random?difficulty=easy should filter by difficulty."""
        resp = await client.get(f"/api/problems/random?difficulty={sample_problem['difficulty']}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == sample_problem["id"]

    @pytest.mark.asyncio
    async def test_random_with_tag(self, client, sample_problem):
        """GET /api/problems/random?tag=array should filter by tag."""
        resp = await client.get(f"/api/problems/random?tag={sample_problem['tags'][0]}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == sample_problem["id"]

    @pytest.mark.asyncio
    async def test_random_no_match_404(self, client):
        """GET /api/problems/random with non-matching difficulty returns 404."""
        resp = await client.get("/api/problems/random?difficulty=impossible")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_random_nonexistent_tag_404(self, client):
        """GET /api/problems/random with non-matching tag returns 404."""
        resp = await client.get("/api/problems/random?tag=nonexistent-xyz")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Skill-tree endpoint
# ---------------------------------------------------------------------------

class TestSkillTreeEndpoint:

    @pytest.mark.asyncio
    async def test_skill_tree_returns_categories(self, client):
        """GET /api/skill-tree returns 200 with a categories list."""
        resp = await client.get("/api/skill-tree")
        assert resp.status_code == 200
        data = resp.json()
        assert "categories" in data
        assert isinstance(data["categories"], list)
        assert len(data["categories"]) >= 1
        # Each category should have expected keys
        cat = data["categories"][0]
        assert "id" in cat
        assert "title" in cat
        assert "problems" in cat
        assert "prerequisites" in cat

    @pytest.mark.asyncio
    async def test_skill_tree_requires_auth(self, app, auth_token):
        """GET /api/skill-tree without token returns 401 when auth is enabled."""
        from httpx import ASGITransport, AsyncClient

        with patch("backend.auth.AUTH_ENABLED", True):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
                resp = await ac.get("/api/skill-tree")
                assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Solution endpoints
# ---------------------------------------------------------------------------

class TestSolutionEndpoints:

    @pytest.mark.asyncio
    async def test_solution_counts_returns_dict(self, client):
        resp = await client.get("/api/solution-counts")
        assert resp.status_code == 200
        assert isinstance(resp.json(), dict)

    @pytest.mark.asyncio
    async def test_list_solutions_returns_list(self, client, sample_problem):
        resp = await client.get(f"/api/solutions/{sample_problem['id']}")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    @pytest.mark.asyncio
    async def test_get_solution_not_found(self, client, sample_problem):
        resp = await client.get(f"/api/solutions/{sample_problem['id']}/deadbeef00000000")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_solution_not_found(self, client, sample_problem):
        resp = await client.delete(f"/api/solutions/{sample_problem['id']}/deadbeef00000000")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_patch_solution_not_found(self, client, sample_problem):
        resp = await client.patch(
            f"/api/solutions/{sample_problem['id']}/deadbeef00000000",
            json={"label": "test"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Submit with auto-save
# ---------------------------------------------------------------------------

class TestSubmitAutoSave:

    @pytest.mark.asyncio
    async def test_submit_includes_saved_solution_id(self, client, sample_problem):
        """POST /api/submit with correct code should include saved_solution_id."""
        resp = await client.post("/api/submit", json={
            "code": "def add(a, b):\n    return a + b\n",
            "problem_id": sample_problem["id"],
            "mode": "learning",
            "session_id": "abc123",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["failed"] == 0
        assert "saved_solution_id" in data

    @pytest.mark.asyncio
    async def test_submit_wrong_code_no_save(self, client, sample_problem):
        """POST /api/submit with wrong code should not include saved_solution_id."""
        resp = await client.post("/api/submit", json={
            "code": "def add(a, b):\n    return 0\n",
            "problem_id": sample_problem["id"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["failed"] > 0
        assert "saved_solution_id" not in data

    @pytest.mark.asyncio
    async def test_submit_accepts_mode_and_session_id(self, client, sample_problem):
        """POST /api/submit should accept optional mode and session_id fields."""
        resp = await client.post("/api/submit", json={
            "code": "def add(a, b):\n    return a + b\n",
            "problem_id": sample_problem["id"],
            "mode": "interview",
            "session_id": "test_session_123",
        })
        assert resp.status_code == 200
