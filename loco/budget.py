"""Budget ceilings for LOCO-Agent.

Per-agent spend limits with enforcement. When an agent's cumulative cost
exceeds its budget, new acquire() calls are rejected with BudgetExceededError.

Usage:
    budget = BudgetManager()
    budget.set_limit("expensive-agent", max_cost=100.0)

    # Wire into scheduler:
    scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)

    # Or check manually:
    budget.check("expensive-agent", task_cost=5.0)  # raises if over limit
"""

from __future__ import annotations

from typing import Any


class BudgetExceededError(Exception):
    """Raised when an agent exceeds its budget ceiling."""

    def __init__(self, agent_id: str, current: float, limit: float, task_cost: float):
        self.agent_id = agent_id
        self.current = current
        self.limit = limit
        self.task_cost = task_cost
        super().__init__(
            f"Agent {agent_id!r} would exceed budget: "
            f"current={current:.1f} + task={task_cost:.1f} > limit={limit:.1f}"
        )


class BudgetManager:
    """Per-agent budget ceilings.

    Set limits per agent. Check before granting resources. Three modes:
    - "reject": raise BudgetExceededError (default)
    - "alert": log warning but allow
    - "downgrade": allow but flag for weight reduction

    Args:
        default_limit: Default budget for agents without explicit limits.
                       None = no limit.
        on_exceeded: Action when budget is exceeded: "reject", "alert", "downgrade".
    """

    def __init__(
        self,
        default_limit: float | None = None,
        on_exceeded: str = "reject",
    ) -> None:
        self._limits: dict[str, float] = {}
        self._spent: dict[str, float] = {}
        self.default_limit = default_limit
        self.on_exceeded = on_exceeded
        self._alerts: list[dict[str, Any]] = []

    def set_limit(self, agent_id: str, max_cost: float) -> None:
        """Set a budget ceiling for an agent."""
        self._limits[agent_id] = max_cost

    def remove_limit(self, agent_id: str) -> None:
        """Remove a budget ceiling for an agent."""
        self._limits.pop(agent_id, None)

    def get_limit(self, agent_id: str) -> float | None:
        """Get the budget ceiling for an agent. None = no limit."""
        return self._limits.get(agent_id, self.default_limit)

    def spent(self, agent_id: str) -> float:
        """Get cumulative spend for an agent."""
        return self._spent.get(agent_id, 0.0)

    def remaining(self, agent_id: str) -> float | None:
        """Get remaining budget for an agent. None = unlimited."""
        limit = self.get_limit(agent_id)
        if limit is None:
            return None
        return max(limit - self.spent(agent_id), 0.0)

    def record_spend(self, agent_id: str, cost: float) -> None:
        """Record a spend event. Called internally on task grant."""
        self._spent[agent_id] = self._spent.get(agent_id, 0.0) + cost

    def reset(self, agent_id: str) -> None:
        """Reset an agent's spend counter."""
        self._spent.pop(agent_id, None)

    def reset_all(self) -> None:
        """Reset all spend counters."""
        self._spent.clear()

    def check(self, agent_id: str, task_cost: float) -> bool:
        """Check if a task would exceed the agent's budget.

        Returns True if within budget. Raises or logs depending on on_exceeded.
        """
        limit = self.get_limit(agent_id)
        if limit is None:
            return True

        current = self.spent(agent_id)
        if current + task_cost > limit:
            alert = {
                "agent_id": agent_id,
                "current": current,
                "task_cost": task_cost,
                "limit": limit,
                "action": self.on_exceeded,
            }
            self._alerts.append(alert)

            if self.on_exceeded == "reject":
                raise BudgetExceededError(agent_id, current, limit, task_cost)
            # "alert" and "downgrade" modes: allow but record
            return False
        return True

    @property
    def alerts(self) -> list[dict[str, Any]]:
        """List of budget exceeded events."""
        return list(self._alerts)

    def summary(self) -> dict[str, dict[str, float | None]]:
        """Budget summary for all agents with limits."""
        result = {}
        all_agents = set(self._limits) | set(self._spent)
        for agent_id in sorted(all_agents):
            result[agent_id] = {
                "limit": self.get_limit(agent_id),
                "spent": self.spent(agent_id),
                "remaining": self.remaining(agent_id),
            }
        return result
