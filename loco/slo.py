"""SLO error budgets for LOCO-Agent.

Tracks wait-time SLO violations with a state machine. This is an
observability primitive, not a scheduling policy -- it monitors post-hoc
(after task completion), not pre-grant.

Usage:
    slo = SLOBudget(target_wait=20.0, window=100)
    state = slo.record("agent_a", completed_task)
    if state == SLOState.CRITICAL:
        # trigger alert
"""

from __future__ import annotations

from collections import deque
from enum import Enum

from loco.task import Task


class SLOState(str, Enum):
    """SLO error budget state machine states."""

    HEALTHY = "healthy"
    WARNING = "warning"
    CRITICAL = "critical"
    EXHAUSTED = "exhausted"


class SLOBudget:
    """Tracks SLO violations with state machine transitions.

    Monitors whether completed tasks meet their wait-time SLO target.
    Uses a rolling window to compute violation rate and transitions
    between states:

        HEALTHY -> WARNING at ``warn`` threshold
        WARNING -> CRITICAL at ``critical`` threshold
        CRITICAL -> EXHAUSTED at 100%

    States can also improve (CRITICAL -> WARNING -> HEALTHY) as the
    violation rate drops.

    Args:
        target_wait: Maximum acceptable wait time (in logical ticks).
            Tasks with age > target_wait are violations.
        window: Size of the rolling observation window.
        warn: Violation rate threshold for WARNING (default 0.75 = 75% of budget consumed).
        critical: Violation rate threshold for CRITICAL (default 0.90).
    """

    def __init__(
        self,
        target_wait: float,
        window: int = 100,
        warn: float = 0.75,
        critical: float = 0.90,
    ) -> None:
        self.target_wait = target_wait
        self.window = window
        self._warn_threshold = warn
        self._critical_threshold = critical
        self._observations: deque[bool] = deque(maxlen=window)  # True = violation
        self._total_violations = 0
        self._total_observations = 0

    @property
    def state(self) -> SLOState:
        """Current SLO state based on violation rate."""
        rate = self.violation_rate
        if rate >= 1.0:
            return SLOState.EXHAUSTED
        if rate >= self._critical_threshold:
            return SLOState.CRITICAL
        if rate >= self._warn_threshold:
            return SLOState.WARNING
        return SLOState.HEALTHY

    @property
    def violation_rate(self) -> float:
        """Fraction of observations in the window that violated the SLO."""
        if not self._observations:
            return 0.0
        return sum(self._observations) / len(self._observations)

    @property
    def budget_remaining(self) -> float:
        """Fraction of error budget remaining (1.0 = fully healthy, 0.0 = exhausted)."""
        return max(0.0, 1.0 - self.violation_rate)

    @property
    def total_violations(self) -> int:
        """Total violations observed (not just in window)."""
        return self._total_violations

    @property
    def total_observations(self) -> int:
        """Total observations recorded."""
        return self._total_observations

    def record(self, agent_id: str, task: Task) -> SLOState:
        """Record a completed task and return the new SLO state.

        Args:
            agent_id: The agent that completed the task (for future per-agent tracking).
            task: The completed task. Uses task.age to determine if SLO was met.

        Returns:
            The SLO state after recording this observation.
        """
        violated = task.age > self.target_wait
        self._observations.append(violated)
        self._total_observations += 1
        if violated:
            self._total_violations += 1
        return self.state

    def reset(self) -> None:
        """Reset all observations."""
        self._observations.clear()
        self._total_violations = 0
        self._total_observations = 0
