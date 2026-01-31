from claude_code_sdk import ClaudeSDKClient, ClaudeCodeOptions, AssistantMessage, ResultMessage, TextBlock
from pathlib import Path


LEARNING_PROMPT = """You are a supportive coding tutor helping someone practice LeetCode problems. Your goal is to guide them to discover solutions themselves, not to give answers directly.

CURRENT CONTEXT:
- Problem: {problem_title}
- Problem Description: {problem_description}
- User's Current Code: (saved at ./workspace/solution.py, you can read it)
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
- User's Current Code: (saved at ./workspace/solution.py, you can read it)
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


class LeetCodeTutor:
    def __init__(self, mode: str, problem: dict, workspace_path: str):
        self.mode = mode
        self.problem = problem
        self.workspace_path = Path(workspace_path)
        self.workspace_path.mkdir(parents=True, exist_ok=True)
        self.hint_count = 0
        self.client: ClaudeSDKClient | None = None
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

    def _save_code(self, code: str):
        (self.workspace_path / "solution.py").write_text(code)

    async def start_session(self):
        self.client = ClaudeSDKClient(ClaudeCodeOptions(
            system_prompt=self._build_system_prompt(),
            allowed_tools=["Read"],
            cwd=str(self.workspace_path),
        ))
        await self.client.connect()

    async def chat(self, user_message: str, code: str | None = None, test_results: dict | None = None):
        """Send a message and yield text chunks of the response."""
        if not self.client:
            return

        if code:
            self._save_code(code)

        # Build context-enriched message
        parts = []
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
            parts.append(f"[Current code is saved at ./workspace/solution.py]")

        parts.append(user_message)
        full_message = "\n".join(parts)

        await self.client.query(full_message)
        async for msg in self.client.receive_response():
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        yield block.text

    async def request_hint(self, code: str | None = None):
        """Request a hint, advancing the hint ladder."""
        self.hint_count += 1
        hint_msg = f"[User requested hint #{self.hint_count}. Follow the hint ladder - give hint level {min(self.hint_count, 5)}.]"
        if code:
            hint_msg += " Their current code is saved at ./workspace/solution.py."
        async for chunk in self.chat(hint_msg, code=code):
            yield chunk

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

    async def end_session(self):
        if self.client:
            await self.client.disconnect()
            self.client = None
