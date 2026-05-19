"""CrewAI adapter for LOCO-Agent.

Two integration patterns:
1. Per-step scheduling via step_callback (fine-grained)
2. Per-crew scheduling by wrapping crew.kickoff() (coarse)

Usage (per-step):
    from loco import AsyncLOCOScheduler, SharedResource
    from loco.adapters.crewai import CrewAIAdapter

    scheduler = AsyncLOCOScheduler([], SharedResource("llm", capacity=3))
    adapter = CrewAIAdapter(scheduler)

    # Wire into CrewAI agent:
    # agent = crewai.Agent(role="researcher",
    #                      step_callback=adapter.step_callback)

Usage (coarse):
    result = await adapter.run_crew(crew, inputs={"query": "..."})
"""

from __future__ import annotations

from typing import Any

from loco.async_scheduler import AcquireHandle, AsyncLOCOScheduler
from loco.task import Task

# Default weights by agent role — override via constructor
DEFAULT_ROLE_WEIGHTS: dict[str, float] = {
    "researcher": 3.0,
    "writer": 2.0,
    "reviewer": 2.0,
    "analyst": 3.0,
    "manager": 1.0,
}


class CrewAIAdapter:
    """Adapter for CrewAI framework.

    Per-step scheduling: the step_callback fires on each agent step
    (tool call or LLM call). The adapter acquires the resource before
    the step and releases after.

    Per-crew scheduling: wrap crew.kickoff() in acquire/release for
    coarser but simpler scheduling.

    Args:
        scheduler: The AsyncLOCOScheduler instance.
        role_weights: Optional override for role-to-weight mapping.
        default_weight: Weight for unknown roles.
    """

    def __init__(
        self,
        scheduler: AsyncLOCOScheduler,
        role_weights: dict[str, float] | None = None,
        default_weight: float = 2.0,
    ) -> None:
        self.scheduler = scheduler
        self.role_weights = role_weights or DEFAULT_ROLE_WEIGHTS
        self.default_weight = default_weight
        self._handles: dict[str, AcquireHandle] = {}

    def _weight_for_role(self, role: str) -> float:
        """Get weight for an agent role."""
        return self.role_weights.get(role.lower(), self.default_weight)

    async def before_step(self, agent_role: str) -> None:
        """Called before a CrewAI agent step. Acquires the resource.

        Args:
            agent_role: The CrewAI agent's role (e.g., "researcher").
        """
        weight = self._weight_for_role(agent_role)
        task = Task(weight=weight, task_type=f"crewai:{agent_role}")
        await self.scheduler.submit_task(agent_role, task)
        handle = await self.scheduler.acquire_start(agent_role)
        self._handles[agent_role] = handle

    async def after_step(self, agent_role: str) -> None:
        """Called after a CrewAI agent step completes. Releases the resource.

        Args:
            agent_role: The CrewAI agent's role.
        """
        handle = self._handles.pop(agent_role, None)
        if handle:
            agent = self.scheduler.get_agent(agent_role)
            agent.serve_oldest_task()
            await self.scheduler.release_handle(handle)

    async def run_crew(
        self,
        crew: Any,
        crew_id: str = "crew",
        weight: float = 3.0,
        **kickoff_kwargs: Any,
    ) -> Any:
        """Schedule and run a CrewAI crew.kickoff() call.

        Coarse scheduling: the entire crew run is a single scheduled task.
        For per-step scheduling, use before_step/after_step instead.

        Args:
            crew: A CrewAI Crew instance.
            crew_id: LOCO agent ID for this crew.
            weight: Task weight for the entire crew run.
            **kickoff_kwargs: Arguments passed to crew.kickoff().

        Returns:
            The crew.kickoff() result.
        """
        task = Task(weight=weight, task_type=f"crewai:crew:{crew_id}")
        await self.scheduler.submit_task(crew_id, task)

        async with self.scheduler.acquire(crew_id):
            result = crew.kickoff(**kickoff_kwargs)
            agent = self.scheduler.get_agent(crew_id)
            agent.serve_oldest_task()
        return result
