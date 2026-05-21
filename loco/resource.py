"""SharedResource: async acquire/release with priority ordering."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class SharedResource:
    """A shared resource with bounded capacity.

    Agents compete for slots via acquire/release. The scheduler
    re-scores waiters at grant time (not request time) to prevent
    priority inversion as Dmax grows while agents wait.

    Supports multiple concurrent holds and waiters per agent_id,
    so the same agent can have several in-flight requests.

    Attributes:
        name: Human-readable resource name (e.g. "llm_api").
        capacity: Maximum concurrent holders.
    """

    name: str
    capacity: int = 1
    _hold_counts: dict[str, int] = field(default_factory=lambda: defaultdict(int), repr=False)
    _total_holds: int = field(default=0, repr=False)
    _waiters: dict[str, list[asyncio.Event]] = field(default_factory=dict, repr=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    def __post_init__(self) -> None:
        if self.capacity < 1:
            raise ValueError(f"Capacity must be >= 1, got {self.capacity}")

    @property
    def utilization(self) -> float:
        """Current holders / capacity. Range [0.0, 1.0]."""
        return self._total_holds / self.capacity

    @property
    def available_slots(self) -> int:
        """Number of free slots."""
        return self.capacity - self._total_holds

    @property
    def holder_count(self) -> int:
        """Number of active holds (including multiple per agent)."""
        return self._total_holds

    @property
    def waiter_count(self) -> int:
        """Number of agents waiting to acquire."""
        return sum(len(events) for events in self._waiters.values())

    def is_holding(self, agent_id: str) -> bool:
        """Check if an agent currently holds the resource."""
        return self._hold_counts.get(agent_id, 0) > 0

    async def try_acquire(self, agent_id: str) -> bool:
        """Try to acquire a slot immediately. Returns True if granted."""
        async with self._lock:
            if self._total_holds < self.capacity:
                self._hold_counts[agent_id] += 1
                self._total_holds += 1
                return True
            return False

    async def wait_for_slot(self, agent_id: str) -> None:
        """Register as a waiter and block until granted.

        The caller (scheduler) is responsible for calling grant() to
        wake the highest-priority waiter. Supports multiple concurrent
        waiters per agent_id.
        """
        event = asyncio.Event()
        self._waiters.setdefault(agent_id, []).append(event)
        try:
            await event.wait()
        except (asyncio.CancelledError, Exception):
            # Clean up our event on cancellation/timeout
            events = self._waiters.get(agent_id, [])
            try:
                events.remove(event)
            except ValueError:
                pass  # already removed by grant()
            if agent_id in self._waiters and not self._waiters[agent_id]:
                del self._waiters[agent_id]
            raise

    async def grant(self, agent_id: str) -> None:
        """Grant a slot to a waiting agent. Called by the scheduler after re-scoring."""
        async with self._lock:
            events = self._waiters.get(agent_id, [])
            if events:
                self._hold_counts[agent_id] += 1
                self._total_holds += 1
                event = events.pop(0)
                if not events:
                    del self._waiters[agent_id]
                event.set()

    async def release(self, agent_id: str) -> None:
        """Release a slot. Returns silently if agent wasn't holding."""
        async with self._lock:
            count = self._hold_counts.get(agent_id, 0)
            if count > 0:
                self._hold_counts[agent_id] = count - 1
                self._total_holds -= 1
                if self._hold_counts[agent_id] == 0:
                    del self._hold_counts[agent_id]

    async def cancel_waiter(self, agent_id: str) -> None:
        """Remove an agent from the wait queue without granting."""
        events = self._waiters.get(agent_id, [])
        if events:
            event = events.pop(0)
            if not events:
                del self._waiters[agent_id]
            event.set()  # unblock the waiter so it can exit

    @asynccontextmanager
    async def held_by(self, agent_id: str) -> AsyncIterator[None]:
        """Context manager that ensures release on exit, including exceptions."""
        try:
            yield
        finally:
            await self.release(agent_id)
