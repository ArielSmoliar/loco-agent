"""AsyncLOCOScheduler: async acquire/release wired to the scoring core."""

from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable
from uuid import uuid4

# asyncio.timeout was added in 3.11; provide a minimal fallback for 3.10.
if sys.version_info >= (3, 11):
    _timeout = asyncio.timeout
else:

    @asynccontextmanager
    async def _timeout(delay):
        """Minimal asyncio.timeout substitute for Python 3.10."""
        loop = asyncio.get_running_loop()
        task = asyncio.current_task()
        timed_out = False

        def _on_timeout():
            nonlocal timed_out
            timed_out = True
            task.cancel()

        handle = loop.call_at(loop.time() + delay, _on_timeout)
        try:
            yield
        except asyncio.CancelledError:
            if timed_out:
                raise TimeoutError
            raise
        finally:
            handle.cancel()


from loco import logging as loco_log
from loco.adaptive import AdaptiveAlphaTuner
from loco.agent import Agent
from loco.budget import BudgetExceededError, BudgetManager, validate_cost
from loco.metrics import SchedulerMetrics
from loco.policy import PolicyEnforcer
from loco.resource import SharedResource
from loco.scheduler import LOCOScheduler
from loco.task import Task
from loco.trust import TrustScorer


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
    _serving_task: Task | None = field(default=None, repr=False)
    _reservations: list = field(default_factory=list, repr=False)
    _owner: Any = field(default=None, repr=False)
    _actual_cost: float | None = field(default=None, repr=False)
    _failed: bool = field(default=False, repr=False)
    _track_trust: bool = field(default=False, repr=False)

    def set_actual_cost(self, cost: float) -> None:
        """Set a verified charge in the same units as the budget before release."""
        if self._released:
            raise RuntimeError("Handle has already been released")
        self._actual_cost = validate_cost(cost)


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
        auto_tune: bool = False,
        budget: BudgetManager | None = None,
        enforcer: PolicyEnforcer | None = None,
        trust_scorer: TrustScorer | None = None,
    ) -> None:
        self.resource = resource
        self.max_waiters = max_waiters
        self.budget = budget

        # Build the internal enforcer from budget and/or explicit enforcer.
        # Legacy budget= users get their BudgetManager wrapped automatically.
        if budget and enforcer:
            if all(policy is not budget for policy in enforcer.policies):
                enforcer.add_policy(budget)
            self._enforcer = enforcer
        elif budget and not enforcer:
            self._enforcer = PolicyEnforcer([budget])
        elif enforcer:
            self._enforcer = enforcer
        else:
            self._enforcer = None

        self._scorer = LOCOScheduler(agents, alpha=alpha, optimize_for=optimize_for, seed=seed)
        self._lock = asyncio.Lock()
        self._shutting_down = False
        self._logical_tick = 0
        self._active_handles: dict[str, AcquireHandle] = {}
        self._task_claims: set[int] = set()
        self.metrics = SchedulerMetrics(self)
        self.on_task_started = on_task_started
        self.on_task_completed = on_task_completed
        self.trust_scorer = trust_scorer
        self._tuner: AdaptiveAlphaTuner | None = AdaptiveAlphaTuner(self) if auto_tune else None

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
            raise RuntimeError(f"Cannot unregister {agent_id}: currently holding resource")
        if agent_id in self.resource._waiters:
            raise RuntimeError(f"Cannot unregister {agent_id}: waiting for resource")
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
        self, agent_id: str, *, timeout: float | None = None, task: Task | None = None
    ) -> AsyncIterator[AcquireHandle]:
        """Acquire a slot and reserve budget; settle and release on every exit.

        Existing ``async with acquire(aid):`` callers remain supported. For known
        billing, use ``as handle`` and ``handle.set_actual_cost(cost)``. If execution
        fails/cancels without a verified charge, settle the reserved estimate rather
        than silently refunding potentially billable work.
        """
        handle = await self.acquire_start(agent_id, timeout=timeout, task=task)
        handle._track_trust = True
        try:
            yield handle
        except BaseException:
            handle._failed = True
            raise
        finally:
            await self.release_handle(handle)

    async def acquire_start(
        self, agent_id: str, *, timeout: float | None = None, task: Task | None = None
    ) -> AcquireHandle:
        """Admit a call and atomically reserve each budget before returning a handle.

        A failed admission rolls back reservations. Split-API callers must always
        release returned handles in a finally block, including after cancellation.
        Pass task= to bind an acquisition to an exact submitted task. Without it,
        the next unclaimed queued task is selected for backward compatibility.
        """
        if self._shutting_down:
            raise ShutdownError("Scheduler is shutting down")
        agent = self.get_agent(agent_id)
        if task is not None:
            if not any(pending is task for pending in agent.tasks):
                raise ValueError("Task is not queued for this agent")
            if id(task) in self._task_claims:
                raise ValueError("Task already has an acquisition")
            serving_task = task
        else:
            serving_task = next((t for t in agent.tasks if id(t) not in self._task_claims), None)
        if agent.tasks and serving_task is None:
            raise ValueError("Every queued task already has an acquisition; submit a new task")
        handle = AcquireHandle(agent_id=agent_id, _owner=self, _serving_task=serving_task)
        if serving_task is not None:
            self._task_claims.add(id(serving_task))
        granted = False
        try:
            granted = await self.resource.try_acquire(agent_id)
            if not granted:
                if self.resource.waiter_count >= self.max_waiters:
                    raise BackpressureError(
                        f"Too many waiters ({self.resource.waiter_count} >= {self.max_waiters})"
                    )
                if timeout is not None:
                    async with _timeout(timeout):
                        await self.resource.wait_for_slot(agent_id)
                else:
                    await self.resource.wait_for_slot(agent_id)
                granted = True
            if self._shutting_down:
                raise ShutdownError("Scheduler is shutting down")
            if self._enforcer and serving_task:
                handle._reservations = self._enforcer.reserve_all(agent_id, serving_task)
            if self.on_task_started and serving_task:
                self.on_task_started(agent_id, serving_task)
            if serving_task:
                self.metrics.record_task_cost(agent_id, serving_task.weight, serving_task)
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
                    budget_remaining=self.budget.remaining(agent_id) if self.budget else None,
                )
            self._active_handles[handle.handle_id] = handle
            return handle
        except BaseException as exc:
            try:
                PolicyEnforcer.cancel_all(agent_id, handle._serving_task, handle._reservations)
                if isinstance(exc, BudgetExceededError) and self.budget:
                    loco_log.emit_budget_exceeded(
                        tick=self._logical_tick,
                        agent_id=agent_id,
                        task=handle._serving_task,
                        current=exc.current,
                        limit=exc.limit,
                        action=self.budget.on_exceeded,
                        resource_name=self.resource.name,
                    )
            finally:
                try:
                    if granted:
                        await self._release_slot(agent_id)
                    else:
                        # wait_for_slot returns a raced grant on cancellation. Wake
                        # another waiter without cancelling anyone else's request.
                        async with self._lock:
                            await self._grant_next_waiter()
                finally:
                    if serving_task is not None:
                        self._task_claims.discard(id(serving_task))
            raise

    async def release_handle(
        self, handle: AcquireHandle, *, actual_cost: float | None = None
    ) -> None:
        """Settle once and free the slot, even if a policy or completion hook fails.

        ``actual_cost`` must use the budget's units; raw token counts are not dollars
        or task weights. Omit to settle the reservation's original estimate. An
        actual charge above the reservation is recorded, not hidden; it can cause
        overspend and blocks future admissions. No automatic currency conversion.
        """
        if handle._owner is not self:
            raise ValueError("Handle belongs to another scheduler")
        if handle._released:
            return
        if self._active_handles.get(handle.handle_id) is not handle:
            raise ValueError("Unknown handle")
        if actual_cost is not None:
            handle.set_actual_cost(actual_cost)  # validate before consuming the handle
        handle._released = True
        self._active_handles.pop(handle.handle_id)
        task = handle._serving_task
        try:
            PolicyEnforcer.settle_all(
                handle.agent_id, task, handle._reservations, handle._actual_cost
            )
            if self.trust_scorer and task and handle._track_trust:
                if handle._failed:
                    self.trust_scorer.record_error(handle.agent_id)
                else:
                    self.trust_scorer.record_success(handle.agent_id, wait_ticks=task.age)
            if task:
                loco_log.emit_release(
                    tick=self._logical_tick,
                    agent_id=handle.agent_id,
                    task=task,
                    resource_name=self.resource.name,
                    utilization=self.resource.utilization,
                )
            if self.on_task_completed and task:
                self.on_task_completed(handle.agent_id, task, None)
        finally:
            try:
                await self._release_slot(handle.agent_id)
            finally:
                if task is not None:
                    self._task_claims.discard(id(task))

    async def _release_slot(self, agent_id: str) -> None:
        """Finish cleanup despite cancellation, then propagate cancellation to caller."""

        async def finish():
            await self.resource.release(agent_id)
            await self._on_release()

        cleanup = asyncio.create_task(finish())
        cancelled = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
        cleanup.result()
        if cancelled:
            raise asyncio.CancelledError

    async def _on_release(self) -> None:
        """Called after a resource release. Ages tasks, re-scores, grants next waiter."""
        async with self._lock:
            # Logical tick: age all waiting tasks
            self._logical_tick += 1
            for agent in self.agents.values():
                for task in agent.tasks:
                    task.age += 1

            # Adaptive alpha tuning (if enabled)
            if self._tuner:
                self._tuner.update()

            # Re-score and grant to highest-priority waiter
            await self._grant_next_waiter()

    async def _grant_next_waiter(self) -> None:
        """Re-score all waiters and grant resource to the highest-priority one."""
        if self._shutting_down or not self.resource._waiters or self.resource.available_slots == 0:
            return

        # Only score agents that are actually waiting
        waiting_ids = set(self.resource._waiters.keys())
        scores = self._scorer.compute_load_scores()
        waiter_scores = {aid: s for aid, s in scores.items() if aid in waiting_ids}

        if not waiter_scores:
            return

        # Apply trust multiplier if trust scoring is enabled
        if self.trust_scorer:
            waiter_scores = {
                aid: s * self.trust_scorer.priority_multiplier(aid)
                for aid, s in waiter_scores.items()
            }

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
        cancelled_waiters = self.resource.waiter_count
        waiter_ids = list(self.resource._waiters.keys())
        for agent_id in waiter_ids:
            while agent_id in self.resource._waiters:
                await self.resource.cancel_waiter(agent_id)

        # Wait for holders to finish
        remaining = self.resource.holder_count
        if remaining > 0:
            try:
                async with _timeout(timeout):
                    while self.resource.holder_count > 0:
                        await asyncio.sleep(0.01)
            except TimeoutError:
                pass

        return {
            "cancelled_waiters": cancelled_waiters,
            "active_holders": self.resource.holder_count,
        }
