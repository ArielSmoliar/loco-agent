"""Task ownership for integrations that submit and execute their own work."""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from loco.async_scheduler import AcquireHandle, AsyncLOCOScheduler
from loco.task import Task


@asynccontextmanager
async def scheduled_task(
    scheduler: AsyncLOCOScheduler, agent_id: str, task: Task
) -> AsyncIterator[AcquireHandle]:
    """Submit, acquire the exact task, and clean up on every exit."""
    await scheduler.submit_task(agent_id, task)
    agent = scheduler.get_agent(agent_id)
    try:
        async with scheduler.acquire(agent_id, task=task) as handle:
            try:
                yield handle
            finally:
                # Remove before releasing capacity so a waiter cannot select it.
                agent.remove_task(task, completed=True)
    finally:
        # Admission errors and cancellation while queued never enter the body.
        agent.remove_task(task)
