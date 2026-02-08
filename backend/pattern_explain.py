"""Pattern explanation module: Claude SDK client pool for explaining algorithmic patterns."""

import asyncio
import logging

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class PatternExplainPool:
    """Reuses a single Claude Code SDK client across pattern-explain requests."""

    def __init__(self):
        self._client = None
        self._lock = asyncio.Lock()
        self._request_count = 0
        self._max_requests = 20  # reconnect after N requests to stay fresh

    async def _get_client(self):
        if self._client and self._request_count < self._max_requests:
            return self._client
        # Tear down old client if cycling
        if self._client:
            try:
                await self._client.disconnect()
            except Exception:
                pass
            self._client = None
            self._request_count = 0
        from .tutor import ClaudeSDKClient, ClaudeCodeOptions
        client = ClaudeSDKClient(ClaudeCodeOptions(
            system_prompt=(
                "You explain algorithmic patterns in EXACTLY 2-3 short sentences. "
                "Never exceed 3 sentences. No emojis. No code. No hints about implementation. "
                "Use markdown: **bold** for pattern names, *italics* for emphasis."
            ),
            allowed_tools=[],
            max_turns=1,
        ))
        await asyncio.wait_for(client.connect(), timeout=15)
        self._client = client
        self._request_count = 0
        return client

    async def query(self, prompt: str) -> str:
        from .tutor import AssistantMessage, TextBlock
        async with self._lock:
            try:
                client = await self._get_client()
                await client.query(prompt)
                explanation = ""
                async for msg in client.receive_response():
                    if isinstance(msg, AssistantMessage):
                        for block in msg.content:
                            if isinstance(block, TextBlock):
                                explanation += block.text
                self._request_count += 1
                return explanation
            except Exception:
                # Force reconnect on next call
                if self._client:
                    try:
                        await self._client.disconnect()
                    except Exception:
                        pass
                    self._client = None
                    self._request_count = 0
                raise

    async def shutdown(self):
        if self._client:
            try:
                await self._client.disconnect()
            except Exception:
                pass
            self._client = None


class PatternExplainRequest(BaseModel):
    problem_id: str = Field(..., max_length=100)
    guessed_pattern: str = Field(..., max_length=100)
    correct_pattern: str = Field(..., max_length=100)
    was_correct: bool


# Module-level singleton
pattern_explain_pool = PatternExplainPool()
