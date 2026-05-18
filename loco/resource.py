"""SharedResource: async acquire/release with priority ordering."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class SharedResource:
    """A shared resource with bounded capacity.

    Agents compete for slots via acquire/release. The scheduler
    re-scores waiters at grant time (not request time) to prevent
    priority inversion as Dmax grows while agents wait.

    Attributes:
        name: Human-readable resource name (e.g. "llm_api").
        capacity: Maximum concurrent holders.
    """

    name: str
    capacity: int = 1
    _holders: set[str] = field(default_factory=set, repr=False)
    _waiters: dict[str, asyncio.Event] = field(default_factory=dict, repr=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    def __post_init__(self) -> None:
        if self.capacity < 1:
            raise ValueError(f"Capacity must be >= 1, got {self.capacity}")

    @property
    def utilization(self) -> float:
        """Current holders / capacity. Range [0.0, 1.0]."""
        return len(self._holders) / self.capacity

    @property
    def available_slots(self) -> int:
        """Number of free slots."""
        return self.capacity - len(self._holders)

    @property
    def holder_count(self) -> int:
        """Number of agents currently holding the resource."""
        return len(self._holders)

    @property
    def waiter_count(self) -> int:
        """Number of agents waiting to acquire."""
        return len(self._waiters)

    def is_holding(self, agent_id: str) -> bool:
        """Check if an agent currently holds the resource."""
        return agent_id in self._holders

    async def try_acquire(self, agent_id: str) -> bool:
        """Try to acquire a slot immediately. Returns True if granted."""
        async with self._lock:
            if len(self._holders) < self.capacity:
                self._holders.add(agent_id)
                return True
            return False

    async def wait_for_slot(self, agent_id: str) -> None:
        """Register as a waiter and block until granted.

        The caller (scheduler) is responsible for calling grant() to
        wake the highest-priority waiter.
        """
        event = asyncio.Event()
        self._waiters[agent_id] = event
        await event.wait()

    async def grant(self, agent_id: str) -> None:
        """Grant a slot to a waiting agent. Called by the scheduler after re-scoring."""
        async with self._lock:
            if agent_id in self._waiters:
                self._holders.add(agent_id)
                event = self._waiters.pop(agent_id)
                event.set()

    async def release(self, agent_id: str) -> None:
        """Release a slot. Returns silently if agent wasn't holding."""
        async with self._lock:
            self._holders.discard(agent_id)

    async def cancel_waiter(self, agent_id: str) -> None:
        """Remove an agent from the wait queue without granting."""
        if agent_id in self._waiters:
            event = self._waiters.pop(agent_id)
            event.set()  # unblock the waiter so it can exit

    @asynccontextmanager
    async def held_by(self, agent_id: str) -> AsyncIterator[None]:
        """Context manager that ensures release on exit, including exceptions."""
        try:
            yield
        finally:
            await self.release(agent_id)
