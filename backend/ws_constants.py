"""WebSocket protocol constants: message types and error codes.

Pure data module -- no imports, no logic. Safe to import from any backend
module without risk of circular dependencies.
"""

# ── Client -> Server message types ────────────────────────────────────

MSG_AUTH = "auth"
MSG_START_SESSION = "start_session"
MSG_MESSAGE = "message"
MSG_REQUEST_HINT = "request_hint"
MSG_RESUME_SESSION = "resume_session"
MSG_END_SESSION = "end_session"
MSG_TIME_UPDATE = "time_update"
MSG_TIME_UP = "time_up"
MSG_NUDGE_REQUEST = "nudge_request"
MSG_TEST_RESULTS_UPDATE = "test_results_update"
MSG_SAVE_STATE = "save_state"
MSG_APPROACH_RESOLVE = "approach_resolve"

# ── Server -> Client message types ────────────────────────────────────

MSG_SESSION_STARTED = "session_started"
MSG_SESSION_RESUMED = "session_resumed"
MSG_ASSISTANT_CHUNK = "assistant_chunk"
MSG_ASSISTANT_MESSAGE = "assistant_message"
MSG_ERROR = "error"
MSG_REVIEW_PHASE_STARTED = "review_phase_started"
MSG_APPROACH_CLASSIFIED = "approach_classified"
MSG_APPROACH_DUPLICATE = "approach_duplicate"
MSG_SOLUTION_COUNT_UPDATED = "solution_count_updated"

# ── Error codes (machine-readable, included in MSG_ERROR messages) ────

ERR_NO_ACTIVE_SESSION = "NO_ACTIVE_SESSION"
ERR_INVALID_RESOLVE = "INVALID_RESOLVE"
ERR_RESOLVE_FAILED = "RESOLVE_FAILED"
