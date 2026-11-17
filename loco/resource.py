"""SharedResource: async acquire/release with priority ordering."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import AsyncIterator

from loco._cleanup import finish_cleanup


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
    _granted_waiters: set[asyncio.Event] = field(default_factory=set, repr=False)

    _wait_order: dict[asyncio.Event, str] = field(default_factory=dict, repr=False)
    _fifo_waiters: set[asyncio.Event] = field(default_factory=set, repr=False)

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
        """Number of queued calls, including multiple calls for the same agent."""
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

    def _enqueue(self, agent_id: str, *, fifo: bool = False) -> asyncio.Event:
        event = asyncio.Event()
        self._waiters.setdefault(agent_id, []).append(event)
        self._wait_order[event] = agent_id
        if fifo:
            self._fifo_waiters.add(event)
        return event

    def _remove_waiter(self, agent_id: str, event: asyncio.Event) -> None:
        events = self._waiters.get(agent_id, [])
        if event in events:
            events.remove(event)
        if agent_id in self._waiters and not events:
            del self._waiters[agent_id]
        self._wait_order.pop(event, None)
        self._fifo_waiters.discard(event)

    def _grant_event(self, agent_id: str, event: asyncio.Event) -> None:
        self._remove_waiter(agent_id, event)
        self._hold_counts[agent_id] += 1
        self._total_holds += 1
        self._granted_waiters.add(event)
        event.set()

    def _drain(self, *, include_scored: bool = False) -> None:
        # Called under the lock. The core scheduler still selects its own
        # scored waiters; FIFO owners also wake scored callers when they release.
        for event, agent_id in list(self._wait_order.items()):
            if self.available_slots <= 0:
                break
            if include_scored or event in self._fifo_waiters:
                self._grant_event(agent_id, event)

    def _release_hold(self, agent_id: str) -> None:
        count = self._hold_counts.get(agent_id, 0)
        if count:
            self._total_holds -= 1
            if count == 1:
                del self._hold_counts[agent_id]
            else:
                self._hold_counts[agent_id] = count - 1

    async def _cancel_event(self, agent_id, event, *, fifo=False):
        async with self._lock:
            if event in self._granted_waiters:
                self._granted_waiters.remove(event)
                self._release_hold(agent_id)
            self._remove_waiter(agent_id, event)
            self._drain(include_scored=fifo)

    async def _await_event(self, agent_id, event, *, timeout=None, fifo=False):
        try:
            if not event.is_set():
                if timeout is None:
                    await event.wait()
                else:
                    try:
                        await asyncio.wait_for(event.wait(), timeout)
                    except asyncio.TimeoutError:
                        raise TimeoutError("Resource acquisition timed out") from None
            if event not in self._granted_waiters:
                raise asyncio.CancelledError
            self._granted_waiters.remove(event)
        except BaseException:
            await finish_cleanup(self._cancel_event(agent_id, event, fifo=fifo))
            raise

    async def wait_for_slot(self, agent_id: str) -> None:
        """Wait for a scheduler-selected grant; cancellation removes only this call."""
        async with self._lock:
            event = self._enqueue(agent_id)
        await self._await_event(agent_id, event)

    @asynccontextmanager
    async def acquire_fifo(
        self, agent_id: str, *, timeout: float | None = None
    ) -> AsyncIterator[None]:
        """Acquire with FIFO wakeups and cancellation-safe release.

        Timeout bounds a queued wait, not execution. Slots granted just before
        cancellation are returned before propagating it. FIFO releases also
        wake scored waiters when sharing capacity with AsyncLOCOScheduler.
        """
        async with self._lock:
            event = self._enqueue(agent_id, fifo=True)
            self._drain(include_scored=True)
        await self._await_event(agent_id, event, timeout=timeout, fifo=True)
        try:
            yield
        finally:
            await finish_cleanup(self.release(agent_id, wake_waiters=True))

    async def grant(self, agent_id: str) -> None:
        """Grant a queued call if capacity remains. A raced grant cannot overfill."""
        async with self._lock:
            events = self._waiters.get(agent_id, [])
            if events and self.available_slots > 0:
                self._grant_event(agent_id, events[0])

    async def release(self, agent_id: str, *, wake_waiters: bool = False) -> None:
        """Release a hold and wake FIFO callers; optionally wake scored callers too."""
        async with self._lock:
            self._release_hold(agent_id)
            self._drain(include_scored=wake_waiters)

    async def cancel_waiter(self, agent_id: str) -> None:
        """Cancel the first queued call for an agent without granting a slot."""
        async with self._lock:
            events = self._waiters.get(agent_id, [])
            if events:
                event = events[0]
                self._remove_waiter(agent_id, event)
                event.set()

    @asynccontextmanager
    async def held_by(self, agent_id: str) -> AsyncIterator[None]:
        """Context manager that ensures release on exit, including exceptions."""
        try:
            yield
        finally:
            await self.release(agent_id)
