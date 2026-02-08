# Ticket 08: Fix HTTP Status Codes and Input Validation

**Priority:** HIGH
**Component:** `backend/server.py`
**Estimated Scope:** Small

## Problem

1. **Wrong status codes** (lines 46-48, 60-61, 69-71, 84-87): When a problem or session is not found, the server returns `{"error": "..."}` with HTTP 200 instead of 404. This breaks REST conventions and makes client-side error handling unreliable.

2. **No input size limits** (lines 52-54): The `RunRequest` model has no `max_length` on the `code` field. Arbitrarily large payloads can consume memory and disk.

3. **No CORS configuration** (line 19): No CORS middleware is configured. If the frontend is ever served from a different origin, requests will be blocked.

## Files to Modify

- `backend/server.py`

## Requirements

1. Use FastAPI's `HTTPException` with proper status codes:
   - 404 for missing problems and sessions
   - 400 for malformed requests
   - 422 is already handled by Pydantic for validation errors

2. Add `max_length` constraints to Pydantic models:
   ```python
   class RunRequest(BaseModel):
       code: str = Field(..., max_length=51200)  # 50KB
       problem_id: str = Field(..., max_length=100)
   ```

3. Add CORS middleware with appropriate origin restrictions (at minimum, allow `localhost:8000`).

## Acceptance Criteria

- `GET /api/problems/nonexistent` returns 404, not 200.
- `GET /api/sessions/nonexistent` returns 404, not 200.
- `POST /api/run` with a 100MB code payload is rejected before execution.
- CORS headers are present in responses.
