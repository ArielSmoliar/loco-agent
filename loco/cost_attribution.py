"""Cost attribution for LOCO-Agent (v0.4).

Aggregates scheduling costs across multiple dimensions: team, workflow,
model, and agent. Enables platform engineers to answer "where are my
tokens going?" with per-team, per-workflow, and per-model breakdowns.

Usage:
    attribution = CostAttribution()

    # Wire into scheduler (done automatically by AsyncLOCOScheduler)
    attribution.record(agent_id="analyst", task=task)

    # Query
    attribution.cost_by_team()           # {"marketing": 47.5, "eng": 23.1}
    attribution.cost_by_workflow()       # {"weekly-report": 31.2, "etl": 39.4}
    attribution.cost_by_model()          # {"claude-opus-4": 68.0, "claude-sonnet-4": 2.6}
    attribution.breakdown("marketing")   # per-workflow, per-model, per-agent within team
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from loco.task import Task


_UNSET = "__unattributed__"


@dataclass
class CostRecord:
    """A single cost observation for aggregation."""

    agent_id: str
    weight: float
    team: str
    workflow: str
    model: str


class CostAttribution:
    """Multi-dimensional cost aggregator.

    Records cost per task and provides rollups by team, workflow, model,
    agent, and cross-dimensional breakdowns.
    """

    def __init__(self) -> None:
        self._records: list[CostRecord] = []
        # Pre-aggregated totals for fast queries
        self._by_team: dict[str, float] = {}
        self._by_workflow: dict[str, float] = {}
        self._by_model: dict[str, float] = {}
        self._by_agent: dict[str, float] = {}
        # Two-dimensional rollups
        self._by_team_agent: dict[str, dict[str, float]] = {}
        self._by_team_model: dict[str, dict[str, float]] = {}
        self._by_team_workflow: dict[str, dict[str, float]] = {}
        self._by_workflow_model: dict[str, dict[str, float]] = {}
        self._by_workflow_agent: dict[str, dict[str, float]] = {}

    def record(self, agent_id: str, task: Task) -> None:
        """Record a task's cost across all attribution dimensions.

        Called on each grant event. Uses task.team, task.workflow, and
        task.model fields; falls back to "__unattributed__" if unset.
        """
        team = task.team or _UNSET
        workflow = task.workflow or _UNSET
        model = task.model or _UNSET
        weight = task.weight

        rec = CostRecord(
            agent_id=agent_id,
            weight=weight,
            team=team,
            workflow=workflow,
            model=model,
        )
        self._records.append(rec)

        # Single-dimension rollups
        self._by_team[team] = self._by_team.get(team, 0.0) + weight
        self._by_workflow[workflow] = self._by_workflow.get(workflow, 0.0) + weight
        self._by_model[model] = self._by_model.get(model, 0.0) + weight
        self._by_agent[agent_id] = self._by_agent.get(agent_id, 0.0) + weight

        # Two-dimension rollups
        _add_nested(self._by_team_agent, team, agent_id, weight)
        _add_nested(self._by_team_model, team, model, weight)
        _add_nested(self._by_team_workflow, team, workflow, weight)
        _add_nested(self._by_workflow_model, workflow, model, weight)
        _add_nested(self._by_workflow_agent, workflow, agent_id, weight)

    # --- Single-dimension queries ---

    def cost_by_team(self) -> dict[str, float]:
        """Total cost per team. Returns {team: total_weight}."""
        return dict(self._by_team)

    def cost_by_workflow(self) -> dict[str, float]:
        """Total cost per workflow. Returns {workflow: total_weight}."""
        return dict(self._by_workflow)

    def cost_by_model(self) -> dict[str, float]:
        """Total cost per model. Returns {model: total_weight}."""
        return dict(self._by_model)

    def cost_by_agent(self) -> dict[str, float]:
        """Total cost per agent. Returns {agent_id: total_weight}."""
        return dict(self._by_agent)

    def total_cost(self) -> float:
        """Total cost across all dimensions."""
        return sum(self._by_agent.values())

    # --- Two-dimension queries ---

    def team_breakdown(self, team: str) -> dict[str, dict[str, float]]:
        """Breakdown within a team: by agent, by model, by workflow.

        Returns {"by_agent": {...}, "by_model": {...}, "by_workflow": {...}}.
        """
        return {
            "by_agent": dict(self._by_team_agent.get(team, {})),
            "by_model": dict(self._by_team_model.get(team, {})),
            "by_workflow": dict(self._by_team_workflow.get(team, {})),
            "total": self._by_team.get(team, 0.0),
        }

    def workflow_breakdown(self, workflow: str) -> dict[str, dict[str, float]]:
        """Breakdown within a workflow: by agent, by model.

        Returns {"by_agent": {...}, "by_model": {...}}.
        """
        return {
            "by_agent": dict(self._by_workflow_agent.get(workflow, {})),
            "by_model": dict(self._by_workflow_model.get(workflow, {})),
            "total": self._by_workflow.get(workflow, 0.0),
        }

    def model_breakdown(self, model: str) -> dict[str, float]:
        """Cost for a specific model, broken down by agent."""
        result = {}
        for rec in self._records:
            if rec.model == model:
                result[rec.agent_id] = result.get(rec.agent_id, 0.0) + rec.weight
        return result

    # --- Summary ---

    def summary(self) -> dict[str, object]:
        """Full cost summary across all dimensions.

        Returns a dict suitable for JSON serialization or dashboard display.
        """
        return {
            "total_cost": self.total_cost(),
            "record_count": len(self._records),
            "by_team": self.cost_by_team(),
            "by_workflow": self.cost_by_workflow(),
            "by_model": self.cost_by_model(),
            "by_agent": self.cost_by_agent(),
        }

    def top_costs(self, dimension: str = "agent", n: int = 5) -> list[tuple[str, float]]:
        """Top N cost contributors for a given dimension.

        Args:
            dimension: One of "agent", "team", "workflow", "model".
            n: Number of results to return.

        Returns:
            List of (name, cost) tuples sorted by cost descending.
        """
        sources = {
            "agent": self._by_agent,
            "team": self._by_team,
            "workflow": self._by_workflow,
            "model": self._by_model,
        }
        data = sources.get(dimension, {})
        return sorted(data.items(), key=lambda x: x[1], reverse=True)[:n]


def _add_nested(d: dict[str, dict[str, float]], key1: str, key2: str, value: float) -> None:
    """Increment a nested dict counter."""
    inner = d.setdefault(key1, {})
    inner[key2] = inner.get(key2, 0.0) + value
