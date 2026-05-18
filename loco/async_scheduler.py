"""AsyncLOCOScheduler: async acquire/release wired to the scoring core."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator

from loco.agent import Agent
from loco.resource import SharedResource
from loco.scheduler import LOCOScheduler
from loco.task import Task


class BackpressureError(Exception):
    """Raised when acquire() is called and waiters >= max_waiters."""


class ShutdownError(Exception):
    """Raised when submit_task() or acquire() is called after shutdown."""


class AsyncLOCOScheduler:
    """Async scheduler that manages resource contention via acquire/release.

    Wraps the sync LOCOScheduler scoring core with async resource management.
    Re-scores waiters at grant time (not request time) to prevent priority
    inversion as Dmax grows while agents wait.

    Logical ticks: each release() increments a global tick counter and ages
    all waiting tasks by 1. This ties aging to system activity, not wall clock.
    """

    def __init__(
        self,
        agents: list[Agent],
        resource: SharedResource,
        *,
        alpha: float = 0.25,
        max_waiters: int = 100,
        seed: int | None = None,
    ) -> None:
        self.resource = resource
        self.max_waiters = max_waiters
        self._scorer = LOCOScheduler(agents, alpha=alpha, seed=seed)
        self._lock = asyncio.Lock()
        self._shutting_down = False
        self._logical_tick = 0

    @property
    def agents(self) -> dict[str, Agent]:
        return self._scorer.agents

    @property
    def alpha(self) -> float:
        return self._scorer.alpha

    @property
    def logical_tick(self) -> int:
        return self._logical_tick

    def get_agent(self, agent_id: str) -> Agent:
        return self._scorer.get_agent(agent_id)

    async def submit_task(self, agent_id: str, task: Task) -> None:
        """Enqueue a task to the specified agent.

        Raises ShutdownError if the scheduler is shutting down.
        Raises ValueError if agent_id is not registered.
        """
        if self._shutting_down:
            raise ShutdownError("Scheduler is shutting down")
        agent = self._scorer.get_agent(agent_id)
        agent.tasks.append(task)

    @asynccontextmanager
    async def acquire(self, agent_id: str) -> AsyncIterator[None]:
        """Acquire the shared resource for the given agent.

        Blocks until L(i) wins a slot. Yields inside the context manager
        while the resource is held. Automatically releases on exit.

        Raises:
            BackpressureError: if waiters exceed max_waiters.
            ShutdownError: if scheduler is shutting down.
        """
        if self._shutting_down:
            raise ShutdownError("Scheduler is shutting down")

        # Try immediate acquire
        granted = await self.resource.try_acquire(agent_id)

        if not granted:
            # Check backpressure
            if self.resource.waiter_count >= self.max_waiters:
                raise BackpressureError(
                    f"Too many waiters ({self.resource.waiter_count} >= {self.max_waiters})"
                )

            # Register as waiter and block
            await self.resource.wait_for_slot(agent_id)

        # Resource is held -- yield to caller
        async with self.resource.held_by(agent_id):
            yield

        # After release: age waiting tasks, re-score, grant next waiter
        await self._on_release()

    async def _on_release(self) -> None:
        """Called after a resource release. Ages tasks, re-scores, grants next waiter."""
        async with self._lock:
            # Logical tick: age all waiting tasks
            self._logical_tick += 1
            for agent in self.agents.values():
                for task in agent.tasks:
                    task.age += 1

            # Re-score and grant to highest-priority waiter
            await self._grant_next_waiter()

    async def _grant_next_waiter(self) -> None:
        """Re-score all waiters and grant resource to the highest-priority one."""
        if not self.resource._waiters or self.resource.available_slots == 0:
            return

        # Only score agents that are actually waiting
        waiting_ids = set(self.resource._waiters.keys())
        scores = self._scorer.compute_load_scores()
        waiter_scores = {aid: s for aid, s in scores.items() if aid in waiting_ids}

        if not waiter_scores:
            return

        # Grant to highest scorer
        best_id = max(waiter_scores, key=waiter_scores.get)
        await self.resource.grant(best_id)

    async def shutdown(self, timeout: float = 30.0) -> dict[str, int]:
        """Graceful shutdown.

        1. Stop accepting new tasks
        2. Cancel all waiters
        3. Wait for in-flight holders to release (up to timeout)

        Returns dict with counts: cancelled_waiters, active_holders.
        """
        self._shutting_down = True

        # Cancel all waiters
        waiter_ids = list(self.resource._waiters.keys())
        for agent_id in waiter_ids:
            await self.resource.cancel_waiter(agent_id)

        # Wait for holders to finish
        remaining = self.resource.holder_count
        if remaining > 0:
            try:
                async with asyncio.timeout(timeout):
                    while self.resource.holder_count > 0:
                        await asyncio.sleep(0.01)
            except TimeoutError:
                pass

        return {
            "cancelled_waiters": len(waiter_ids),
            "active_holders": self.resource.holder_count,
        }
