"""Metrics utilities for LOCO-Agent."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from loco.async_scheduler import AsyncLOCOScheduler
    from loco.task import Task


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

    def __init__(self, scheduler: AsyncLOCOScheduler, ema_alpha: float = 0.3) -> None:
        self._scheduler = scheduler
        self._cumulative_cost: dict[str, float] = {}
        self._session_costs: dict[str, dict[str, float]] = {}  # {session_id: {agent_id: cost}}
        self._actual_tokens: dict[str, list[int]] = {}
        self._ema_weights: dict[str, float] = {}
        self._ema_alpha = ema_alpha  # EMA smoothing factor (higher = more recent)

    def record_task_cost(self, agent_id: str, cost: float, task: "Task | None" = None) -> None:
        """Record a task's cost for the given agent. Called internally on grant."""
        self._cumulative_cost[agent_id] = (
            self._cumulative_cost.get(agent_id, 0.0) + cost
        )
        if task and task.session_id is not None:
            session = self._session_costs.setdefault(task.session_id, {})
            session[agent_id] = session.get(agent_id, 0.0) + cost

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

    # --- Session cost tracking ---

    def cost_by_session(self) -> dict[str, float]:
        """Total cost per session. Returns {session_id: total_cost}."""
        return {
            sid: sum(agents.values())
            for sid, agents in self._session_costs.items()
        }

    def session_cost(self, session_id: str) -> float:
        """Total cost for a specific session."""
        agents = self._session_costs.get(session_id, {})
        return sum(agents.values())

    def cost_by_session_and_agent(self, session_id: str) -> dict[str, float]:
        """Per-agent cost breakdown within a session."""
        return dict(self._session_costs.get(session_id, {}))

    def sessions(self) -> list[str]:
        """List of all session IDs that have recorded costs."""
        return list(self._session_costs.keys())

    # --- Empirical cost tracking ---

    def record_actual_tokens(
        self, agent_id: str, task: "Task", actual_tokens: int
    ) -> None:
        """Record actual token usage after a call completes.

        Updates the EMA weight estimate for the task's type. Future calls
        with the same task_type will use the adjusted weight instead of
        the static model tier.

        Args:
            agent_id: The agent that executed the task.
            task: The task that was completed.
            actual_tokens: Actual total tokens consumed (input + output).
        """
        self._actual_tokens.setdefault(agent_id, []).append(actual_tokens)

        # Update EMA for this task type
        task_type = task.task_type
        if task_type in self._ema_weights:
            prev = self._ema_weights[task_type]
            self._ema_weights[task_type] = (
                self._ema_alpha * actual_tokens
                + (1 - self._ema_alpha) * prev
            )
        else:
            self._ema_weights[task_type] = float(actual_tokens)

    def empirical_weight(self, task_type: str) -> float | None:
        """Get the EMA-adjusted weight for a task type.

        Returns None if no empirical data exists yet (use static tier).
        """
        return self._ema_weights.get(task_type)

    def actual_tokens_by_agent(self) -> dict[str, list[int]]:
        """Raw actual token counts per agent, in order of recording."""
        return dict(self._actual_tokens)

    def total_actual_tokens(self) -> int:
        """Total actual tokens consumed across all agents."""
        return sum(
            sum(tokens) for tokens in self._actual_tokens.values()
        )
