import asyncio
import logging
import time
from dataclasses import dataclass, field

from .tutor import LeetCodeTutor
from .session_logger import SessionLogger

logger = logging.getLogger(__name__)

TTL_SECONDS = 5 * 60  # 5 minutes
CLEANUP_INTERVAL = 30  # seconds
MAX_PARKED = 5


@dataclass
class ParkedTutor:
    tutor: LeetCodeTutor
    session_logger: SessionLogger
    workspace_path: str
    problem_id: str
    mode: str
    parked_at: float = field(default_factory=time.monotonic)
    claude_session_id: str | None = None
    last_editor_code: str | None = None
    hint_count: int = 0
    interview_phase: str | None = None
    time_remaining: int | None = None


def _kill_task_done_callback(task: asyncio.Task):
    """Log exceptions from background kill tasks instead of silently swallowing."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Background kill task failed: %s", exc, exc_info=exc)


class TutorRegistry:
    def __init__(self):
        self._parked: dict[str, ParkedTutor] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task | None = None

    async def park(self, session_id: str, parked: ParkedTutor):
        """Store a tutor for possible later resume."""
        evicted_list: list[tuple[str, ParkedTutor]] = []

        async with self._lock:
            # Evict oldest if over limit
            while len(self._parked) >= MAX_PARKED:
                oldest_id = min(self._parked, key=lambda k: self._parked[k].parked_at)
                evicted = self._parked.pop(oldest_id)
                evicted_list.append((oldest_id, evicted))
            self._parked[session_id] = parked

        # Kill evicted tutors outside the lock
        for evicted_id, evicted_tutor in evicted_list:
            logger.info("Evicting parked tutor %s (over limit)", evicted_id)
            task = asyncio.ensure_future(self._kill(evicted_tutor))
            task.add_done_callback(_kill_task_done_callback)

        logger.info("Parked tutor for session %s", session_id)

    async def reclaim(self, session_id: str) -> ParkedTutor | None:
        """Pop and return a parked tutor, or None if expired/missing."""
        async with self._lock:
            parked = self._parked.pop(session_id, None)

        if parked is None:
            return None

        age = time.monotonic() - parked.parked_at
        if age > TTL_SECONDS:
            logger.info("Parked tutor %s expired (%.0fs old)", session_id, age)
            task = asyncio.ensure_future(self._kill(parked))
            task.add_done_callback(_kill_task_done_callback)
            return None

        logger.info("Reclaimed parked tutor for session %s (%.0fs old)", session_id, age)
        return parked

    async def is_alive(self, session_id: str) -> bool:
        async with self._lock:
            parked = self._parked.get(session_id)
        if parked is None:
            return False
        return (time.monotonic() - parked.parked_at) <= TTL_SECONDS

    async def _kill(self, parked: ParkedTutor):
        try:
            # Use force_kill() because we're likely in a different task
            # than the one that created the client (cleanup loop / shutdown).
            await parked.tutor.force_kill()
        except Exception:
            logger.exception("Error killing parked tutor")
        try:
            await parked.session_logger.end_session()
        except Exception:
            logger.exception("Error ending parked session logger")

    async def _cleanup_loop(self):
        while True:
            await asyncio.sleep(CLEANUP_INTERVAL)
            try:
                now = time.monotonic()

                # Collect expired entries under the lock
                async with self._lock:
                    expired_items: list[tuple[str, ParkedTutor]] = []
                    for sid, p in self._parked.items():
                        if (now - p.parked_at) > TTL_SECONDS:
                            expired_items.append((sid, p))
                    for sid, _ in expired_items:
                        del self._parked[sid]

                # Kill expired tutors outside the lock
                for sid, parked in expired_items:
                    logger.info("Cleanup: expiring parked tutor %s", sid)
                    try:
                        await self._kill(parked)
                    except Exception:
                        logger.exception(
                            "Cleanup: failed to kill parked tutor %s", sid
                        )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Cleanup loop iteration failed")

    def start(self):
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.ensure_future(self._cleanup_loop())

    async def stop(self):
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None
        # Kill all remaining parked tutors
        async with self._lock:
            remaining = list(self._parked.items())
            self._parked.clear()
        for sid, parked in remaining:
            await self._kill(parked)
