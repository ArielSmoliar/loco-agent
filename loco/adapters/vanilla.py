"""VanillaAdapter: reference adapter for plain Python async callables."""

from __future__ import annotations

from typing import Any, Callable

from loco.adapters.base import BaseAdapter
from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler
from loco.task import Task


class VanillaAdapter(BaseAdapter):
    """Wraps plain async Python functions as LOCO-scheduled agents.

    This is the reference adapter — any async callable can be registered
    as an agent. The adapter handles the full lifecycle:
      register → submit → acquire → call handler → release

    Usage:
        adapter = VanillaAdapter(scheduler)
        await adapter.register_agent("summarizer", my_summarize_fn)
        await adapter.submit_task("summarizer", Task(weight=2.0))
        result = await adapter.run_next("summarizer")
    """

    def __init__(self, scheduler: AsyncLOCOScheduler) -> None:
        self.scheduler = scheduler
        self._handlers: dict[str, Callable[..., Any]] = {}

    async def register_agent(
        self, agent_id: str, handler: Callable[..., Any]
    ) -> Agent:
        """Register an async callable as a LOCO agent.

        Args:
            agent_id: Unique identifier for the agent.
            handler: Async function called when the agent is granted the resource.
                     Receives (agent_id, task) as arguments. Return value is
                     passed to on_completed.

        Returns:
            The created Agent object.

        Raises:
            ValueError: if agent_id is already registered.
        """
        if agent_id in self._handlers:
            raise ValueError(f"Agent already registered: {agent_id}")
        agent = Agent(agent_id=agent_id)
        self.scheduler.register_agent(agent)
        self._handlers[agent_id] = handler
        return agent

    async def submit_task(self, agent_id: str, task: Task) -> None:
        """Enqueue a task to the specified agent.

        Raises ValueError if agent_id is not registered with this adapter.
        """
        if agent_id not in self._handlers:
            raise ValueError(
                f"Agent {agent_id!r} not registered with this adapter"
            )
        await self.scheduler.submit_task(agent_id, task)

    async def on_scheduled(self, agent_id: str, task: Task) -> Any:
        """Call the agent's handler. Returns the handler's result."""
        handler = self._handlers[agent_id]
        return await handler(agent_id, task)

    async def on_completed(
        self, agent_id: str, task: Task, result: Any
    ) -> None:
        """Called after task execution completes. Dequeues the served task."""
        agent = self.scheduler.get_agent(agent_id)
        agent.serve_oldest_task()

    async def run_next(self, agent_id: str, *, timeout: float | None = None) -> Any:
        """Run the next task for an agent through the full lifecycle.

        Acquires the resource (blocks until L(i) wins), calls the handler,
        releases, and returns the result.

        This is the high-level convenience method. For callback-based
        frameworks, use acquire_start/release_handle directly.
        """
        agent = self.scheduler.get_agent(agent_id)
        if not agent.tasks:
            raise RuntimeError(f"Agent {agent_id!r} has no tasks to run")

        task = agent.tasks[0]
        async with self.scheduler.acquire(agent_id, timeout=timeout):
            result = await self.on_scheduled(agent_id, task)
            await self.on_completed(agent_id, task, result)
        return result

    async def run_all(self, agent_id: str) -> list[Any]:
        """Run all queued tasks for an agent sequentially. Returns list of results."""
        results = []
        agent = self.scheduler.get_agent(agent_id)
        while agent.tasks:
            result = await self.run_next(agent_id)
            results.append(result)
        return results
