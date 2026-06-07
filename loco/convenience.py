"""Convenience API for one-line LOCO integration.

Provides a module-level singleton scheduler with simple configure/wrap/scheduled
functions. For full control, use AsyncLOCOScheduler directly.

Usage:
    import loco

    loco.configure(capacity=3, optimize_for="balanced")
    loco.set_budget("analyst", max_cost=50.0)

    # Wrap any async callable
    response = await loco.wrap(
        client.messages.create,
        agent_id="analyst",
        weight=2.0,
        model="claude-sonnet-4-20250514",
        messages=[...],
    )

    # Or use the decorator
    @loco.scheduled(agent_id="webhook", weight=1.0)
    async def handle_webhook(payload):
        return await client.messages.create(...)
"""

from __future__ import annotations

import functools
from typing import Any, Callable, TypeVar

from loco.async_scheduler import AsyncLOCOScheduler
from loco.budget import BudgetManager
from loco.resource import SharedResource
from loco.task import Task

T = TypeVar("T")

# Module-level singleton state
_scheduler: AsyncLOCOScheduler | None = None
_budget: BudgetManager | None = None


def configure(
    capacity: int = 3,
    *,
    optimize_for: str = "balanced",
    resource_name: str = "llm_api",
    auto_tune: bool = True,
    max_waiters: int = 100,
    budget_mode: str | None = None,
) -> AsyncLOCOScheduler:
    """Configure the global LOCO scheduler.

    Call once at app startup. Creates a singleton scheduler with a shared
    resource pool. Agents auto-register on first use.

    Args:
        capacity: Max concurrent resource slots (e.g., LLM API concurrency).
        optimize_for: "latency", "balanced", or "throughput".
        resource_name: Name for the shared resource.
        auto_tune: Enable adaptive alpha tuning.
        max_waiters: Backpressure limit.
        budget_mode: If set ("reject", "alert", or "downgrade"), enables
            budget enforcement on the global scheduler.

    Returns:
        The configured AsyncLOCOScheduler instance.
    """
    global _scheduler, _budget

    if budget_mode is not None:
        _budget = BudgetManager(on_exceeded=budget_mode)
    else:
        _budget = None

    _scheduler = AsyncLOCOScheduler(
        [],
        SharedResource(name=resource_name, capacity=capacity),
        optimize_for=optimize_for,
        auto_tune=auto_tune,
        max_waiters=max_waiters,
        budget=_budget,
    )
    return _scheduler


def set_budget(agent_id: str, max_cost: float) -> None:
    """Set a budget limit for an agent on the global scheduler.

    Budget units are weight units (same as Task.weight). An opus call
    (weight=5) costs 5 units; a haiku call (weight=1) costs 1 unit.

    Args:
        agent_id: The agent to cap.
        max_cost: Maximum cumulative weight before enforcement kicks in.

    Raises:
        RuntimeError: If configure() hasn't been called with budget_mode.
    """
    if _budget is None:
        raise RuntimeError(
            "No budget manager. Call loco.configure(budget_mode='reject') first."
        )
    _budget.set_limit(agent_id, max_cost)


def get_scheduler() -> AsyncLOCOScheduler:
    """Get the global scheduler. Raises RuntimeError if not configured."""
    if _scheduler is None:
        raise RuntimeError("Call loco.configure() before using loco.wrap() or loco.scheduled().")
    return _scheduler


async def wrap(
    fn: Callable[..., Any],
    *,
    agent_id: str,
    weight: float = 1.0,
    **kwargs: Any,
) -> Any:
    """Wrap an async callable with LOCO scheduling.

    Submits a task, acquires the resource, calls fn(**kwargs), dequeues
    the task, and releases. One line replaces submit_task + acquire + release.

    Args:
        fn: The async callable to wrap (e.g., client.messages.create).
        agent_id: Agent ID for scheduling.
        weight: Task weight (cost proxy). Default 1.0.
        **kwargs: Passed through to fn().

    Returns:
        The return value of fn(**kwargs).

    Raises:
        BudgetExceededError: If budget enforcement rejects the task.
        RuntimeError: If configure() hasn't been called.
    """
    scheduler = get_scheduler()
    task = Task(weight=weight)
    await scheduler.submit_task(agent_id, task)

    async with scheduler.acquire(agent_id):
        try:
            result = await fn(**kwargs)
        finally:
            # Always dequeue, even on error, to prevent task queue buildup
            agent = scheduler.get_agent(agent_id)
            agent.serve_oldest_task()

    return result


def scheduled(
    *,
    agent_id: str,
    weight: float = 1.0,
) -> Callable:
    """Decorator that wraps an async function with LOCO scheduling.

    Usage:
        @loco.scheduled(agent_id="webhook", weight=1.0)
        async def handle_webhook(payload):
            return await client.messages.create(...)

    Args:
        agent_id: Agent ID for scheduling.
        weight: Task weight (cost proxy). Default 1.0.
    """

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            scheduler = get_scheduler()
            task = Task(weight=weight)
            await scheduler.submit_task(agent_id, task)

            async with scheduler.acquire(agent_id):
                try:
                    result = await fn(*args, **kwargs)
                finally:
                    agent = scheduler.get_agent(agent_id)
                    agent.serve_oldest_task()

            return result

        return wrapper

    return decorator


def enable_prometheus(port: int = 9090, addr: str = "0.0.0.0") -> object:
    """Enable Prometheus metrics export for the global scheduler.

    Starts an HTTP server at the given port serving /metrics in
    Prometheus exposition format. Requires: pip install loco-agent[prometheus]

    Args:
        port: Port to serve metrics on. Default 9090.
        addr: Address to bind to. Default 0.0.0.0.

    Returns:
        The PrometheusExporter instance.

    Raises:
        RuntimeError: If configure() hasn't been called.
        ImportError: If prometheus_client is not installed.
    """
    from loco.exporters.prometheus import PrometheusExporter

    scheduler = get_scheduler()
    exporter = PrometheusExporter(scheduler)
    exporter.start(port=port, addr=addr)
    return exporter


def reset() -> None:
    """Reset the global scheduler. Mainly for testing."""
    global _scheduler, _budget
    _scheduler = None
    _budget = None
