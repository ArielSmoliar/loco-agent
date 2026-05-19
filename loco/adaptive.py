"""Adaptive alpha tuning for LOCO-Agent.

Nudges alpha based on observed system state. The thesis's renormalization
concept adapted for the async scheduler:

- When wait times diverge (some agents waiting much longer than others),
  shift toward latency (lower alpha) to restore fairness.
- When queues grow unboundedly (system is backlogged), shift toward
  throughput (higher alpha) to drain work faster.

Alpha is clamped to [0.0, 0.5] — the safe operating range proven by
Scenario 2 (alpha > 0.5 causes starvation).

Usage:
    tuner = AdaptiveAlphaTuner(scheduler)
    tuner.update()  # call on each release cycle
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from loco.async_scheduler import AsyncLOCOScheduler


class AdaptiveAlphaTuner:
    """Adjusts alpha based on observed wait-time variance and queue growth.

    Monitors two signals:
    1. Wait-time coefficient of variation (CV) across agents — high CV means
       unfair scheduling, nudge alpha down (toward latency/fairness).
    2. Total queue depth trend — growing queues mean system is overloaded,
       nudge alpha up (toward throughput/draining).

    Args:
        scheduler: The AsyncLOCOScheduler to tune.
        step_size: How much to nudge alpha per update (default 0.01).
        min_alpha: Floor for alpha (default 0.0).
        max_alpha: Ceiling for alpha (default 0.5 — safe range).
        cv_threshold: CV above this triggers a fairness correction (default 0.5).
        queue_growth_window: Number of ticks to measure queue trend (default 10).
    """

    def __init__(
        self,
        scheduler: AsyncLOCOScheduler,
        *,
        step_size: float = 0.01,
        min_alpha: float = 0.0,
        max_alpha: float = 0.5,
        cv_threshold: float = 0.5,
        queue_growth_window: int = 10,
    ) -> None:
        self.scheduler = scheduler
        self.step_size = step_size
        self.min_alpha = min_alpha
        self.max_alpha = max_alpha
        self.cv_threshold = cv_threshold
        self.queue_growth_window = queue_growth_window
        self._queue_history: list[float] = []
        self._adjustments: list[tuple[int, float, str]] = []

    @property
    def alpha(self) -> float:
        return self.scheduler._scorer.alpha

    @property
    def adjustments(self) -> list[tuple[int, float, str]]:
        """History of (tick, new_alpha, reason) adjustments."""
        return list(self._adjustments)

    def _wait_time_cv(self) -> float:
        """Coefficient of variation of current Dmax values across active agents."""
        dmax_values = [
            a.dmax for a in self.scheduler.agents.values() if a.tasks
        ]
        if len(dmax_values) < 2:
            return 0.0
        mean = sum(dmax_values) / len(dmax_values)
        if mean == 0:
            return 0.0
        variance = sum((d - mean) ** 2 for d in dmax_values) / len(dmax_values)
        return math.sqrt(variance) / mean

    def _queue_trend(self) -> float:
        """Trend in total queue depth. Positive = growing, negative = draining."""
        total_q = sum(
            a.queue_depth_weighted for a in self.scheduler.agents.values()
        )
        self._queue_history.append(total_q)

        # Keep window bounded
        if len(self._queue_history) > self.queue_growth_window:
            self._queue_history = self._queue_history[-self.queue_growth_window:]

        if len(self._queue_history) < 2:
            return 0.0

        # Simple trend: compare recent average to older average
        mid = len(self._queue_history) // 2
        older = sum(self._queue_history[:mid]) / mid
        newer = sum(self._queue_history[mid:]) / (len(self._queue_history) - mid)

        if older == 0:
            return 0.0
        return (newer - older) / older  # positive = growing

    def update(self) -> float:
        """Evaluate system state and nudge alpha if needed.

        Called on each release cycle (or periodically).

        Returns:
            The new alpha value.
        """
        cv = self._wait_time_cv()
        trend = self._queue_trend()
        current = self.alpha
        new_alpha = current
        reason = ""

        # Signal 1: Fairness — high wait-time CV → lower alpha
        if cv > self.cv_threshold:
            new_alpha = max(current - self.step_size, self.min_alpha)
            reason = f"fairness (CV={cv:.2f} > {self.cv_threshold})"

        # Signal 2: Throughput — queues growing → higher alpha
        elif trend > 0.2:  # 20% growth
            new_alpha = min(current + self.step_size, self.max_alpha)
            reason = f"throughput (queue_trend={trend:.2f})"

        # Apply if changed
        if new_alpha != current:
            self.scheduler._scorer.alpha = new_alpha
            self._adjustments.append(
                (self.scheduler.logical_tick, new_alpha, reason)
            )

        return new_alpha
