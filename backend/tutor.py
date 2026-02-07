import asyncio
import logging
import multiprocessing
import os
import signal
from claude_code_sdk import ClaudeSDKClient, ClaudeCodeOptions, AssistantMessage, ResultMessage, TextBlock
from pathlib import Path

logger = logging.getLogger(__name__)


MAX_MESSAGE_SIZE = 10 * 1024  # 10KB
CONNECT_TIMEOUT = 15  # seconds
RESPONSE_TIMEOUT = 60  # seconds
CHUNK_TIMEOUT = 15  # seconds – max wait between consecutive chunks
MAX_RETRIES = 2
RETRY_BACKOFF = 1.0  # seconds

LEARNING_PROMPT = """You are a supportive coding tutor helping someone practice LeetCode problems. Your goal is to guide them to discover solutions themselves, not to give answers directly.

CURRENT CONTEXT:
- Problem: {problem_title}
- Problem Description: {problem_description}
- User's Current Code: (saved at ./solution.py, you can read it)
- Hints Given So Far: {hint_count}

HINT LADDER (only advance when truly stuck):
1. Ask clarifying questions: "What approach are you considering?" "What's blocking you?"
2. Suggest the pattern category: "This is a classic [hash map / two pointers / sliding window] problem"
3. Name the key data structure: "A hash map would help here because..."
4. Explain the core insight abstractly: "The key insight is that for each element, we need to..."
5. Provide pseudocode outline (last resort): "The general structure would be: 1) Initialize... 2) Loop through..."

GUIDELINES:
- Celebrate partial progress! "Nice, that's the right direction!"
- If their code passes some tests, acknowledge what's working before addressing failures
- Ask them to explain their time/space complexity after they solve it
- Suggest edge cases they might have missed
- Never give the complete solution code
- Be encouraging but not patronizing
- If they seem frustrated, offer to take a step back and review the problem together"""

INTERVIEW_PROMPT = """You are a technical interviewer conducting a mock coding interview. Be professional, supportive, but maintain the pressure of a real interview.

CURRENT CONTEXT:
- Problem: {problem_title}
- Problem Description: {problem_description}
- User's Current Code: (saved at ./solution.py, you can read it)
- Time Remaining: {time_remaining}
- Current Phase: {interview_phase}

INTERVIEW PROTOCOL:
1. CLARIFICATION PHASE: If they haven't asked clarifying questions, prompt: "Before you start coding, do you have any questions about the problem?"

2. CODING PHASE:
   - Let them think and struggle a bit (this is normal in interviews)
   - If stuck for >2 minutes with no progress, give a small nudge: "What data structure might help here?"
   - Watch for: edge case handling, variable naming, code organization

3. REVIEW PHASE (after they submit or time runs out):
   - "Walk me through your solution"
   - "What's the time complexity? Space complexity?"
   - "How would you test this?"
   - "What if the input was 10^9 elements?"
   - If suboptimal: "Is there a way to improve this?"

GUIDELINES:
- Keep responses concise (interviewers don't give speeches)
- Note when they explain their thinking out loud (good interview practice)
- If they go silent, prompt: "Talk me through what you're thinking"
- Be encouraging when they make progress, but don't over-praise"""


NUDGE_INACTIVITY_TEMPLATE = (
    "[SYSTEM: The student has been inactive for {idle_seconds}s. They may be stuck or distracted. "
    "Offer a gentle, specific nudge related to where they likely are in the problem. "
    "Do NOT say \"are you still there?\" — instead, offer a concrete next step or ask a "
    "targeted question about their approach. Keep it to 1-2 sentences.]"
)

NUDGE_FLAILING_TEMPLATE = (
    "[SYSTEM: The student has hit the same error {consecutive_errors} times: \"{last_error}\". "
    "They appear frustrated. Offer a specific, empathetic hint about this error. "
    "Explain what typically causes this error in the context of this problem. "
    "Keep it supportive and concise.]"
)


def build_nudge_message(trigger: str, context: dict) -> str:
    """Build a nudge prompt from trigger type and context dict."""
    if trigger == "flailing":
        return NUDGE_FLAILING_TEMPLATE.format(
            consecutive_errors=context.get("consecutive_errors", 3),
            last_error=context.get("last_error", "unknown error"),
        )
    # Default: inactivity
    return NUDGE_INACTIVITY_TEMPLATE.format(
        idle_seconds=context.get("idle_seconds", 120),
    )


class LeetCodeTutor:
    def __init__(self, mode: str, problem: dict, workspace_path: str):
        self.mode = mode
        self.problem = problem
        self.workspace_path = Path(workspace_path)
        self.workspace_path.mkdir(parents=True, exist_ok=True)
        self.hint_count = 0
        self.client: ClaudeSDKClient | None = None
        self.claude_session_id: str | None = None
        self._sdk_child_pids: set[int] = set()
        self._sdk_subprocess_pid: int | None = None
        # Interview mode state
        self.interview_phase = "clarification" if mode == "interview" else None
        self.time_remaining: int | None = 45 * 60 if mode == "interview" else None

    def _format_time(self) -> str:
        if self.time_remaining is None:
            return "N/A"
        m, s = divmod(self.time_remaining, 60)
        return f"{m}:{s:02d}"

    def _build_system_prompt(self) -> str:
        if self.mode == "interview":
            return INTERVIEW_PROMPT.format(
                problem_title=self.problem["title"],
                problem_description=self.problem["description"],
                hint_count=self.hint_count,
                time_remaining=self._format_time(),
                interview_phase=self.interview_phase or "N/A",
            )
        return LEARNING_PROMPT.format(
            problem_title=self.problem["title"],
            problem_description=self.problem["description"],
            hint_count=self.hint_count,
        )

    def _build_state_context(self) -> str:
        """Build a context string with current session state for the model."""
        parts = [f"[Session State: hints_given={self.hint_count}"]
        if self.time_remaining is not None:
            parts.append(f", time_remaining={self._format_time()}")
        if self.interview_phase is not None:
            parts.append(f", phase={self.interview_phase}")
        parts.append("]")
        return "".join(parts)

    def _save_code(self, code: str):
        (self.workspace_path / "solution.py").write_text(code)

    def _snapshot_child_pids(self) -> set[int]:
        """Return PIDs of current multiprocessing children."""
        return {p.pid for p in multiprocessing.active_children()}

    def _capture_sdk_subprocess_pid(self):
        """Try to capture the SDK subprocess PID at connect time as a kill fallback.

        This accesses private SDK internals and may break on SDK updates.
        Tested against claude-code-sdk (see force_kill() for version note).
        """
        try:
            transport = getattr(self.client, '_transport', None)
            if transport is None:
                return
            proc = getattr(transport, '_process', None)
            if proc is not None and hasattr(proc, 'pid') and proc.pid is not None:
                self._sdk_subprocess_pid = proc.pid
        except Exception:
            logger.debug("Could not capture SDK subprocess PID at connect time")

    async def start_session(self):
        pre = self._snapshot_child_pids()
        client = ClaudeSDKClient(ClaudeCodeOptions(
            system_prompt=self._build_system_prompt(),
            allowed_tools=["Read"],
            cwd=str(self.workspace_path),
        ))
        try:
            await asyncio.wait_for(client.connect(), timeout=CONNECT_TIMEOUT)
            self.client = client
            self._sdk_child_pids = self._snapshot_child_pids() - pre
            self._capture_sdk_subprocess_pid()
        except (asyncio.TimeoutError, Exception):
            await client.disconnect()
            self.client = None
            raise

    async def _send_and_receive(self, message: str):
        """Send a query and yield response chunks, with timeout and retries.

        Retries only happen before the first chunk is yielded. Once any chunk
        has been sent to the caller, errors are propagated immediately to avoid
        duplicate output.
        """
        last_exc = None
        for attempt in range(1 + MAX_RETRIES):
            if attempt > 0:
                await asyncio.sleep(RETRY_BACKOFF * attempt)
            chunk_yielded = False
            try:
                await asyncio.wait_for(
                    self.client.query(message), timeout=RESPONSE_TIMEOUT
                )
                response_iter = self.client.receive_response().__aiter__()
                while True:
                    try:
                        msg = await asyncio.wait_for(
                            response_iter.__anext__(), timeout=CHUNK_TIMEOUT
                        )
                    except StopAsyncIteration:
                        break
                    if isinstance(msg, ResultMessage):
                        if msg.session_id:
                            self.claude_session_id = msg.session_id
                    elif isinstance(msg, AssistantMessage):
                        for block in msg.content:
                            if isinstance(block, TextBlock):
                                chunk_yielded = True
                                yield block.text
                return  # success
            except asyncio.TimeoutError as exc:
                if chunk_yielded:
                    raise  # don't retry after partial output
                last_exc = exc
                continue
            except Exception as exc:
                if chunk_yielded:
                    raise  # don't retry after partial output
                last_exc = exc
                if attempt < MAX_RETRIES:
                    continue
                raise
        # All retries exhausted
        raise last_exc  # type: ignore[misc]

    async def chat(self, user_message: str, code: str | None = None, test_results: dict | None = None):
        """Send a message and yield text chunks of the response."""
        if not self.client:
            yield "Error: Tutor session is not connected. Please start a new session."
            return

        # Input length validation
        if len(user_message.encode("utf-8")) > MAX_MESSAGE_SIZE:
            raise ValueError(
                f"Message too large ({len(user_message.encode('utf-8'))} bytes). "
                f"Maximum allowed size is {MAX_MESSAGE_SIZE} bytes (10KB)."
            )

        if code:
            self._save_code(code)

        # Build context-enriched message
        parts = []

        # Include current state so the model sees updates
        parts.append(self._build_state_context())

        if test_results:
            passed = test_results.get("passed", 0)
            failed = test_results.get("failed", 0)
            parts.append(f"[Test Results: {passed} passed, {failed} failed]")
            for r in test_results.get("results", []):
                if r.get("passed"):
                    parts.append(f"  Test {r['test_num']}: PASSED ({r.get('runtime_ms', '?')}ms)")
                else:
                    err = r.get("error") or f"Expected {r.get('expected')}, got {r.get('actual')}"
                    parts.append(f"  Test {r['test_num']}: FAILED - {err}")

        if code:
            parts.append(f"[Current code is saved at ./solution.py]")

        parts.append(user_message)
        full_message = "\n".join(parts)

        async for chunk in self._send_and_receive(full_message):
            yield chunk

    async def request_hint(self, code: str | None = None):
        """Request a hint, advancing the hint ladder."""
        next_hint = self.hint_count + 1
        hint_msg = f"[User requested hint #{next_hint}. Follow the hint ladder - give hint level {min(next_hint, 5)}.]"
        if code:
            hint_msg += " Their current code is saved at ./solution.py."

        responded = False
        async for chunk in self.chat(hint_msg, code=code):
            responded = True
            yield chunk

        # Only increment after successful response
        if responded:
            self.hint_count = next_hint

    def update_time(self, time_remaining: int):
        self.time_remaining = time_remaining

    async def enter_review_phase(self, code: str | None = None):
        """Explicitly trigger the review phase."""
        self.interview_phase = "review"
        review_msg = (
            "[The interview coding phase is over. Begin the REVIEW PHASE now. "
            "Ask the candidate to walk through their solution, discuss time/space complexity, "
            "how they would test it, and whether there's a way to optimize.]"
        )
        async for chunk in self.chat(review_msg, code=code):
            yield chunk

    async def start_session_with_resume(self, claude_session_id: str):
        """Start a session that resumes a previous Claude conversation."""
        pre = self._snapshot_child_pids()
        client = ClaudeSDKClient(ClaudeCodeOptions(
            system_prompt=self._build_system_prompt(),
            allowed_tools=["Read"],
            cwd=str(self.workspace_path),
            resume=claude_session_id,
        ))
        try:
            await asyncio.wait_for(client.connect(), timeout=CONNECT_TIMEOUT)
            self.client = client
            self.claude_session_id = claude_session_id
            self._sdk_child_pids = self._snapshot_child_pids() - pre
            self._capture_sdk_subprocess_pid()
        except (asyncio.TimeoutError, Exception):
            await client.disconnect()
            self.client = None
            raise

    async def replay_history(self, chat_history: list[dict]):
        """Replay chat history into a fresh Claude session for context restoration.

        Yields chunks of the welcome-back response.
        """
        if not self.client:
            yield "Error: Tutor session is not connected."
            return

        # Build context restoration prompt
        lines = ["[CONTEXT RESTORATION: This is a resumed session. Previous conversation:]"]
        for msg in chat_history:
            role = msg.get("role", "unknown").capitalize()
            content = msg.get("content", "")
            # Truncate very long messages to keep context manageable
            if len(content) > 500:
                content = content[:500] + "..."
            lines.append(f"{role}: {content}")
        lines.append("[END OF PREVIOUS CONVERSATION. Welcome the user back in 1 sentence and ask where they'd like to pick up.]")

        full_prompt = "\n".join(lines)
        async for chunk in self._send_and_receive(full_prompt):
            yield chunk

    async def end_session(self):
        if self.client:
            try:
                await self.client.disconnect()
                self.client = None
            except (RuntimeError, AttributeError):
                # anyio TaskGroup can raise if disconnect is called from a
                # different task than the one that created the connection.
                # Fall back to force-killing the subprocess directly.
                await self.force_kill()

    async def force_kill(self):
        """Kill the Claude subprocess from any asyncio task.

        Unlike end_session(), this is safe to call from a different task than
        the one that called start_session(). The SDK's disconnect() uses anyio
        task groups that enforce same-task exit, so we bypass it and terminate
        the subprocess directly. Also kills any multiprocessing children the
        SDK spawned in our process for IPC.

        NOTE: This method accesses private SDK internals (_query, _transport,
        _process, _closed). These were tested against claude-code-sdk 0.1.x.
        Review this method when upgrading the claude-code-sdk package.
        The SDK does not currently expose a public cancel/terminate API;
        only connect(), disconnect(), query(), and receive_response() are public.
        """
        if not self.client:
            return

        proc = None

        # --- Attempt 1: reach into SDK internals (may break on SDK updates) ---
        try:
            # Mark the query as closed so its read loop stops
            query_obj = getattr(self.client, '_query', None)
            if query_obj is not None:
                if hasattr(query_obj, '_closed'):
                    query_obj._closed = True
                else:
                    logger.warning(
                        "force_kill: SDK client._query has no '_closed' attr; "
                        "query read-loop may not stop cleanly"
                    )
        except Exception:
            logger.warning("force_kill: failed to mark SDK query as closed", exc_info=True)

        try:
            # Terminate the subprocess directly via SDK transport
            transport = getattr(self.client, '_transport', None)
            if transport is not None:
                proc = getattr(transport, '_process', None)
                if proc is None:
                    logger.warning(
                        "force_kill: SDK transport has no '_process' attr; "
                        "falling back to tracked PID"
                    )
            else:
                logger.warning(
                    "force_kill: SDK client has no '_transport' attr; "
                    "falling back to tracked PID"
                )
        except Exception:
            logger.warning("force_kill: failed to access SDK transport", exc_info=True)

        # --- Attempt 2: terminate the subprocess we found (or fall back to tracked PID) ---
        if proc is not None and proc.returncode is None:
            try:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    proc.kill()
            except Exception:
                logger.warning("force_kill: error terminating SDK subprocess via transport", exc_info=True)
        elif self._sdk_subprocess_pid is not None:
            # Fallback: use the PID we captured at connect time
            try:
                os.kill(self._sdk_subprocess_pid, signal.SIGTERM)
                # Give it a moment, then escalate
                await asyncio.sleep(1.0)
                try:
                    os.kill(self._sdk_subprocess_pid, 0)  # check if still alive
                    os.kill(self._sdk_subprocess_pid, signal.SIGKILL)
                except OSError:
                    pass  # already dead
            except (OSError, ProcessLookupError):
                pass  # already dead
            except Exception:
                logger.warning("force_kill: error killing SDK subprocess via tracked PID", exc_info=True)

        # Kill multiprocessing children the SDK spawned in our process
        for pid in getattr(self, '_sdk_child_pids', set()):
            try:
                os.kill(pid, signal.SIGKILL)
            except (OSError, ProcessLookupError):
                pass
        self._sdk_child_pids = set()
        self._sdk_subprocess_pid = None
        self.client = None
