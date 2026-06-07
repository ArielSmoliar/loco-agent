"""Token-to-outcome tracking for LOCO-Agent (v0.4).

Links scheduling decisions to task outcomes. Was the token spend worth it?
Records outcome alongside cost for ROI-style attribution.

Closes the loop that context graphs miss: decision traces capture *why*,
but token-to-outcome attribution captures *was it worth it*.

Usage:
    tracker = OutcomeTracker()

    # After task completes, record the outcome
    tracker.record(
        agent_id="analyst",
        task=task,
        outcome="success",       # or "failure", "partial", "timeout"
        quality_score=0.92,      # optional 0.0-1.0 quality metric
    )

    # Query ROI
    tracker.cost_per_outcome("success")          # avg cost of successful tasks
    tracker.quality_by_model()                   # avg quality score per model
    tracker.outcome_rates()                      # {"success": 0.85, "failure": 0.10, ...}
    tracker.roi_by_agent()                       # cost-effectiveness per agent
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from loco.task import Task


@dataclass
class OutcomeRecord:
    """A single outcome observation."""

    agent_id: str
    task_weight: float
    task_type: str
    team: str | None
    workflow: str | None
    model: str | None
    outcome: str  # "success", "failure", "partial", "timeout"
    quality_score: float | None  # 0.0-1.0 or None if not measured
    wait_ticks: int


class OutcomeTracker:
    """Links token spend to task outcomes for ROI attribution.

    Records each task's outcome alongside its cost, agent, model, and
    quality score. Provides aggregation queries to answer "was it worth it?"
    """

    def __init__(self) -> None:
        self._records: list[OutcomeRecord] = []
        # Pre-aggregated for fast queries
        self._by_outcome: dict[str, list[OutcomeRecord]] = {}
        self._by_agent: dict[str, list[OutcomeRecord]] = {}
        self._by_model: dict[str, list[OutcomeRecord]] = {}

    def record(
        self,
        agent_id: str,
        task: Task,
        outcome: str,
        quality_score: float | None = None,
    ) -> None:
        """Record a task outcome.

        Args:
            agent_id: The agent that executed the task.
            task: The completed task.
            outcome: Outcome label ("success", "failure", "partial", "timeout").
            quality_score: Optional 0.0-1.0 quality metric.
        """
        rec = OutcomeRecord(
            agent_id=agent_id,
            task_weight=task.weight,
            task_type=task.task_type,
            team=task.team,
            workflow=task.workflow,
            model=task.model,
            outcome=outcome,
            quality_score=quality_score,
            wait_ticks=task.age,
        )
        self._records.append(rec)
        self._by_outcome.setdefault(outcome, []).append(rec)
        self._by_agent.setdefault(agent_id, []).append(rec)
        if task.model:
            self._by_model.setdefault(task.model, []).append(rec)

    # --- Outcome rates ---

    def outcome_rates(self) -> dict[str, float]:
        """Fraction of tasks in each outcome category."""
        total = len(self._records)
        if total == 0:
            return {}
        return {
            outcome: len(recs) / total
            for outcome, recs in self._by_outcome.items()
        }

    def outcome_counts(self) -> dict[str, int]:
        """Count of tasks in each outcome category."""
        return {outcome: len(recs) for outcome, recs in self._by_outcome.items()}

    # --- Cost per outcome ---

    def cost_per_outcome(self, outcome: str) -> float:
        """Average cost (weight) of tasks with a given outcome."""
        recs = self._by_outcome.get(outcome, [])
        if not recs:
            return 0.0
        return sum(r.task_weight for r in recs) / len(recs)

    def total_cost_by_outcome(self) -> dict[str, float]:
        """Total cost grouped by outcome."""
        return {
            outcome: sum(r.task_weight for r in recs)
            for outcome, recs in self._by_outcome.items()
        }

    # --- Quality ---

    def avg_quality(self) -> float | None:
        """Average quality score across all tasks with quality data."""
        scored = [r.quality_score for r in self._records if r.quality_score is not None]
        if not scored:
            return None
        return sum(scored) / len(scored)

    def quality_by_model(self) -> dict[str, float]:
        """Average quality score per model (only tasks with quality data)."""
        result: dict[str, tuple[float, int]] = {}
        for model, recs in self._by_model.items():
            scored = [r.quality_score for r in recs if r.quality_score is not None]
            if scored:
                result[model] = (sum(scored) / len(scored), len(scored))
        return {model: avg for model, (avg, _) in result.items()}

    def quality_by_agent(self) -> dict[str, float]:
        """Average quality score per agent."""
        result: dict[str, tuple[float, int]] = {}
        for agent_id, recs in self._by_agent.items():
            scored = [r.quality_score for r in recs if r.quality_score is not None]
            if scored:
                result[agent_id] = (sum(scored) / len(scored), len(scored))
        return {aid: avg for aid, (avg, _) in result.items()}

    # --- ROI (cost-effectiveness) ---

    def roi_by_agent(self) -> dict[str, dict[str, float]]:
        """Cost-effectiveness metrics per agent.

        Returns per-agent:
          - total_cost: cumulative weight
          - success_rate: fraction of successful tasks
          - avg_quality: mean quality score (if available)
          - cost_per_success: average cost of successful tasks
        """
        result = {}
        for agent_id, recs in self._by_agent.items():
            total_cost = sum(r.task_weight for r in recs)
            successes = [r for r in recs if r.outcome == "success"]
            scored = [r.quality_score for r in recs if r.quality_score is not None]
            result[agent_id] = {
                "total_cost": total_cost,
                "task_count": len(recs),
                "success_rate": len(successes) / len(recs) if recs else 0.0,
                "avg_quality": sum(scored) / len(scored) if scored else None,
                "cost_per_success": (
                    sum(r.task_weight for r in successes) / len(successes)
                    if successes else None
                ),
            }
        return result

    def roi_by_model(self) -> dict[str, dict[str, float]]:
        """Cost-effectiveness metrics per model."""
        result = {}
        for model, recs in self._by_model.items():
            total_cost = sum(r.task_weight for r in recs)
            successes = [r for r in recs if r.outcome == "success"]
            scored = [r.quality_score for r in recs if r.quality_score is not None]
            result[model] = {
                "total_cost": total_cost,
                "task_count": len(recs),
                "success_rate": len(successes) / len(recs) if recs else 0.0,
                "avg_quality": sum(scored) / len(scored) if scored else None,
                "cost_per_success": (
                    sum(r.task_weight for r in successes) / len(successes)
                    if successes else None
                ),
            }
        return result

    # --- Summary ---

    def summary(self) -> dict[str, object]:
        """Full outcome summary."""
        return {
            "total_records": len(self._records),
            "outcome_rates": self.outcome_rates(),
            "outcome_counts": self.outcome_counts(),
            "total_cost_by_outcome": self.total_cost_by_outcome(),
            "avg_quality": self.avg_quality(),
        }
