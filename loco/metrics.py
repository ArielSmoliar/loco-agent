"""Metrics utilities for LOCO-Agent."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from loco.async_scheduler import AsyncLOCOScheduler


def jains_fairness(values: list[float]) -> float:
    """Jain's fairness index. Returns 1.0 when all values are equal.

    Filters out zero/negative values before computing.
    Returns 1.0 if no positive values remain.
    """
    positive = [v for v in values if v > 0]
    if not positive:
        return 1.0
    n = len(positive)
    total = sum(positive)
    sum_sq = sum(v * v for v in positive)
    return (total * total) / (n * sum_sq)


class SchedulerMetrics:
    """Live metrics view over the scheduler state.

    Visibility only in v0.1 — no enforcement. Budget ceilings and
    per-agent spend limits are planned for v0.2.

    Usage:
        scheduler = AsyncLOCOScheduler(agents, resource)
        scheduler.metrics.cost_by_agent()
        scheduler.metrics.total_cost()
    """

    def __init__(self, scheduler: AsyncLOCOScheduler) -> None:
        self._scheduler = scheduler
        self._cumulative_cost: dict[str, float] = {}

    def record_task_cost(self, agent_id: str, cost: float) -> None:
        """Record a task's cost for the given agent. Called internally on grant."""
        self._cumulative_cost[agent_id] = (
            self._cumulative_cost.get(agent_id, 0.0) + cost
        )

    def cost_by_agent(self) -> dict[str, float]:
        """Cumulative task cost per agent. Returns {agent_id: total_weight}."""
        return dict(self._cumulative_cost)

    def total_cost(self) -> float:
        """Total cumulative cost across all agents."""
        return sum(self._cumulative_cost.values())

    def agent_cost(self, agent_id: str) -> float:
        """Cumulative cost for a specific agent."""
        return self._cumulative_cost.get(agent_id, 0.0)

    def wait_time_by_agent(self) -> dict[str, float]:
        """Mean wait time (age at completion) per agent.

        Returns {agent_id: mean_age} for agents that have completed tasks.
        """
        result = {}
        for agent_id, agent in self._scheduler.agents.items():
            if agent.completed_tasks:
                total_age = sum(t.age for t in agent.completed_tasks)
                result[agent_id] = total_age / len(agent.completed_tasks)
        return result

    def resource_utilization(self) -> float:
        """Current resource utilization (holders / capacity)."""
        return self._scheduler.resource.utilization

    def queue_depth_by_agent(self) -> dict[str, float]:
        """Current weighted queue depth per agent."""
        return {
            agent_id: agent.queue_depth_weighted
            for agent_id, agent in self._scheduler.agents.items()
        }

    def completed_by_agent(self) -> dict[str, int]:
        """Number of completed tasks per agent."""
        return {
            agent_id: len(agent.completed_tasks)
            for agent_id, agent in self._scheduler.agents.items()
        }
