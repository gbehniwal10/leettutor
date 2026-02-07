# Ticket 14: Fix Missing Dependencies in requirements.txt

**Priority:** CRITICAL
**Component:** `requirements.txt`
**Estimated Scope:** Small

## Problem

1. `claude-code-sdk` is imported in `backend/tutor.py` but not listed in `requirements.txt`. A fresh `pip install -r requirements.txt` will fail to start the app.

2. `pydantic` is used directly in `backend/server.py` (`from pydantic import BaseModel, Field`) but not explicitly listed. It's a transitive dep of FastAPI but should be pinned.

## Files to Modify

- `requirements.txt`

## Requirements

1. Add `claude-code-sdk` to requirements.txt.
2. Add `pydantic` to requirements.txt with a minimum version.

## Acceptance Criteria

- `pip install -r requirements.txt` in a fresh venv installs everything needed.
- `python -c "from backend.server import app"` succeeds.
