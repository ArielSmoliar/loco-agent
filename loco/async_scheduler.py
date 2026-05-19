"""AsyncLOCOScheduler: async acquire/release wired to the scoring core."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable
from uuid import uuid4

from loco.agent import Agent
from loco import logging as loco_log
from loco.metrics import SchedulerMetrics
from loco.resource import SharedResource
from loco.scheduler import LOCOScheduler
from loco.task import Task


class BackpressureError(Exception):
    """Raised when acquire() is called and waiters >= max_waiters."""


class ShutdownError(Exception):
    """Raised when submit_task() or acquire() is called after shutdown."""


@dataclass
class AcquireHandle:
    """Opaque handle returned by acquire_start().

    Pass to release_handle() to release the resource. Used by adapters
    that need to split acquire/release across two separate callbacks
    (e.g., on_llm_start / on_llm_end).
    """

    handle_id: str = field(default_factory=lambda: uuid4().hex[:12])
    agent_id: str = ""
    _released: bool = field(default=False, repr=False)


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
        alpha: float | None = None,
        optimize_for: str | None = None,
        max_waiters: int = 100,
        seed: int | None = None,
        on_task_started: Callable[[str, Task], None] | None = None,
        on_task_completed: Callable[[str, Task, Any], None] | None = None,
    ) -> None:
        self.resource = resource
        self.max_waiters = max_waiters
        self._scorer = LOCOScheduler(
            agents, alpha=alpha, optimize_for=optimize_for, seed=seed
        )
        self._lock = asyncio.Lock()
        self._shutting_down = False
        self._logical_tick = 0
        self._active_handles: dict[str, AcquireHandle] = {}
        self.metrics = SchedulerMetrics(self)
        self.on_task_started = on_task_started
        self.on_task_completed = on_task_completed

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

    # --- Dynamic agent registration ---

    def register_agent(self, agent: Agent) -> None:
        """Register a new agent at runtime.

        Raises ValueError if agent_id is already registered.
        """
        if agent.agent_id in self.agents:
            raise ValueError(f"Agent already registered: {agent.agent_id}")
        self._scorer.agents[agent.agent_id] = agent

    def unregister_agent(self, agent_id: str) -> Agent:
        """Remove an agent from the scheduler. Returns the removed agent.

        Raises ValueError if agent_id is not registered.
        Raises RuntimeError if agent is currently holding or waiting for a resource.
        """
        if agent_id not in self.agents:
            raise ValueError(f"Unknown agent: {agent_id}")
        if self.resource.is_holding(agent_id):
            raise RuntimeError(
                f"Cannot unregister {agent_id}: currently holding resource"
            )
        if agent_id in self.resource._waiters:
            raise RuntimeError(
                f"Cannot unregister {agent_id}: waiting for resource"
            )
        return self._scorer.agents.pop(agent_id)

    def _auto_register(self, agent_id: str) -> Agent:
        """Create and register an agent on first contact."""
        agent = Agent(agent_id=agent_id)
        self._scorer.agents[agent_id] = agent
        return agent

    async def submit_task(self, agent_id: str, task: Task) -> None:
        """Enqueue a task to the specified agent.

        Auto-registers the agent if unknown (thesis parallel: slaves
        announce themselves by participating in contention rounds).

        Raises ShutdownError if the scheduler is shutting down.
        """
        if self._shutting_down:
            raise ShutdownError("Scheduler is shutting down")
        if agent_id not in self.agents:
            self._auto_register(agent_id)
        agent = self._scorer.get_agent(agent_id)
        agent.tasks.append(task)
        loco_log.emit_enqueue(
            tick=self._logical_tick,
            agent_id=agent_id,
            task=task,
            queue_depth=agent.queue_depth_weighted,
            resource_name=self.resource.name,
        )

    @asynccontextmanager
    async def acquire(
        self, agent_id: str, *, timeout: float | None = None
    ) -> AsyncIterator[None]:
        """Acquire the shared resource for the given agent.

        Blocks until L(i) wins a slot. Yields inside the context manager
        while the resource is held. Automatically releases on exit.

        Args:
            agent_id: The agent requesting the resource.
            timeout: Max seconds to wait. None = wait forever.

        Raises:
            BackpressureError: if waiters exceed max_waiters.
            ShutdownError: if scheduler is shutting down.
            TimeoutError: if timeout expires while waiting.
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

            # Register as waiter and block (with optional timeout)
            try:
                if timeout is not None:
                    async with asyncio.timeout(timeout):
                        await self.resource.wait_for_slot(agent_id)
                else:
                    await self.resource.wait_for_slot(agent_id)
            except TimeoutError:
                # Clean up: remove from wait queue
                await self.resource.cancel_waiter(agent_id)
                raise

        # Fire lifecycle hook + logging
        agent = self.get_agent(agent_id)
        serving_task = agent.tasks[0] if agent.tasks else None
        if serving_task:
            self.metrics.record_task_cost(agent_id, serving_task.weight)
            scores = self._scorer.compute_load_scores()
            loco_log.emit_grant(
                tick=self._logical_tick,
                agent_id=agent_id,
                task=serving_task,
                score=scores.get(agent_id, 0.0),
                queue_depth=agent.queue_depth_weighted,
                dmax=agent.dmax,
                resource_name=self.resource.name,
                utilization=self.resource.utilization,
                cumulative_cost=self.metrics.agent_cost(agent_id),
            )
        if self.on_task_started and serving_task:
            self.on_task_started(agent_id, serving_task)

        # Resource is held -- yield to caller
        try:
            async with self.resource.held_by(agent_id):
                yield
        finally:
            # Fire completion hook + logging
            if serving_task:
                loco_log.emit_release(
                    tick=self._logical_tick,
                    agent_id=agent_id,
                    task=serving_task,
                    resource_name=self.resource.name,
                    utilization=self.resource.utilization,
                )
            if self.on_task_completed and serving_task:
                self.on_task_completed(agent_id, serving_task, None)

        # After release: age waiting tasks, re-score, grant next waiter
        await self._on_release()

    # --- Split acquire/release for callback-based frameworks ---

    async def acquire_start(
        self, agent_id: str, *, timeout: float | None = None
    ) -> AcquireHandle:
        """Acquire the resource and return a handle. Call release_handle() to release.

        Use this when acquire and release happen in separate callbacks
        (e.g., on_llm_start / on_llm_end). For single-block usage,
        prefer the async with acquire() context manager.

        Args:
            agent_id: The agent requesting the resource.
            timeout: Max seconds to wait. None = wait forever.

        Returns:
            AcquireHandle to pass to release_handle().
        """
        if self._shutting_down:
            raise ShutdownError("Scheduler is shutting down")

        granted = await self.resource.try_acquire(agent_id)

        if not granted:
            if self.resource.waiter_count >= self.max_waiters:
                raise BackpressureError(
                    f"Too many waiters ({self.resource.waiter_count} >= {self.max_waiters})"
                )
            try:
                if timeout is not None:
                    async with asyncio.timeout(timeout):
                        await self.resource.wait_for_slot(agent_id)
                else:
                    await self.resource.wait_for_slot(agent_id)
            except TimeoutError:
                await self.resource.cancel_waiter(agent_id)
                raise

        # Fire lifecycle hook + logging
        agent = self.get_agent(agent_id)
        serving_task = agent.tasks[0] if agent.tasks else None
        if serving_task:
            self.metrics.record_task_cost(agent_id, serving_task.weight)
            scores = self._scorer.compute_load_scores()
            loco_log.emit_grant(
                tick=self._logical_tick,
                agent_id=agent_id,
                task=serving_task,
                score=scores.get(agent_id, 0.0),
                queue_depth=agent.queue_depth_weighted,
                dmax=agent.dmax,
                resource_name=self.resource.name,
                utilization=self.resource.utilization,
                cumulative_cost=self.metrics.agent_cost(agent_id),
            )
        if self.on_task_started and serving_task:
            self.on_task_started(agent_id, serving_task)

        handle = AcquireHandle(agent_id=agent_id)
        self._active_handles[handle.handle_id] = handle
        return handle

    async def release_handle(self, handle: AcquireHandle) -> None:
        """Release the resource using a handle from acquire_start().

        Safe to call multiple times — subsequent calls are no-ops.
        """
        if handle._released:
            return
        handle._released = True
        self._active_handles.pop(handle.handle_id, None)

        # Fire completion hook + logging
        agent = self.get_agent(handle.agent_id)
        serving_task = agent.tasks[0] if agent.tasks else None
        if serving_task:
            loco_log.emit_release(
                tick=self._logical_tick,
                agent_id=handle.agent_id,
                task=serving_task,
                resource_name=self.resource.name,
                utilization=self.resource.utilization,
            )
        if self.on_task_completed and serving_task:
            self.on_task_completed(handle.agent_id, serving_task, None)

        # Release the resource slot
        await self.resource.release(handle.agent_id)

        # Age tasks, re-score, grant next waiter
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
