"""Trust scoring for LOCO-Agent (v0.4).

Behavioral trust score per agent (0-1000) with time decay. Fast,
reliable agents earn higher scores and get scheduling priority.
Timeout-prone or error-heavy agents get deprioritized.

Signals tracked per agent:
  - Task completion (success vs. error)
  - Wait time relative to SLO target
  - Timeout rate

Scores decay toward a baseline over time, so agents can recover
from temporary issues.

Usage:
    scorer = TrustScorer()
    scorer.record_success("agent_a", wait_ticks=3)
    scorer.record_error("agent_a")
    scorer.score("agent_a")  # -> 720

    # Wire into scheduler for priority adjustment
    scheduler = AsyncLOCOScheduler(..., trust_scorer=scorer)
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field


# Score range
MIN_SCORE = 0
MAX_SCORE = 1000
DEFAULT_SCORE = 500
BASELINE_SCORE = 500

# Signal weights
SUCCESS_REWARD = 15
ERROR_PENALTY = 50
TIMEOUT_PENALTY = 80
FAST_BONUS = 10  # bonus for completing well under SLO target
SLO_VIOLATION_PENALTY = 25

# Time decay
DECAY_HALF_LIFE_SECONDS = 3600.0  # score drifts toward baseline over 1 hour


@dataclass
class _AgentTrustState:
    """Internal trust state for a single agent."""

    score: float = DEFAULT_SCORE
    total_successes: int = 0
    total_errors: int = 0
    total_timeouts: int = 0
    total_slo_violations: int = 0
    last_update: float = field(default_factory=time.monotonic)


class TrustScorer:
    """Behavioral trust scorer for agents.

    Maintains a 0-1000 score per agent based on observed behavior.
    Scores decay toward a baseline (500) over time, allowing agents
    to recover from temporary issues.

    Args:
        slo_target: Wait time threshold (in logical ticks). Tasks
            completing above this count as SLO violations.
        decay_half_life: Seconds for score to decay halfway to baseline.
            Default 3600 (1 hour). Set to None to disable decay.
    """

    def __init__(
        self,
        slo_target: float = 20.0,
        decay_half_life: float | None = DECAY_HALF_LIFE_SECONDS,
    ) -> None:
        self.slo_target = slo_target
        self._decay_half_life = decay_half_life
        self._agents: dict[str, _AgentTrustState] = {}

    def _get_state(self, agent_id: str) -> _AgentTrustState:
        if agent_id not in self._agents:
            self._agents[agent_id] = _AgentTrustState()
        return self._agents[agent_id]

    def _apply_decay(self, state: _AgentTrustState) -> None:
        """Decay the score toward baseline based on elapsed time."""
        if self._decay_half_life is None:
            return
        now = time.monotonic()
        elapsed = now - state.last_update
        if elapsed <= 0:
            return
        # Exponential decay toward baseline
        decay_factor = math.pow(0.5, elapsed / self._decay_half_life)
        state.score = BASELINE_SCORE + (state.score - BASELINE_SCORE) * decay_factor
        state.last_update = now

    def _adjust(self, agent_id: str, delta: float) -> float:
        """Apply a score adjustment and return the new score."""
        state = self._get_state(agent_id)
        self._apply_decay(state)
        state.score = max(MIN_SCORE, min(MAX_SCORE, state.score + delta))
        state.last_update = time.monotonic()
        return state.score

    def record_success(self, agent_id: str, wait_ticks: float = 0) -> float:
        """Record a successful task completion.

        Args:
            agent_id: The agent that completed the task.
            wait_ticks: How many logical ticks the task waited (task.age).

        Returns:
            Updated trust score.
        """
        state = self._get_state(agent_id)
        state.total_successes += 1

        reward = SUCCESS_REWARD
        if wait_ticks < self.slo_target * 0.5:
            reward += FAST_BONUS  # bonus for fast completion

        if wait_ticks > self.slo_target:
            state.total_slo_violations += 1
            reward -= SLO_VIOLATION_PENALTY  # net negative if SLO violated

        return self._adjust(agent_id, reward)

    def record_error(self, agent_id: str) -> float:
        """Record an error during task execution.

        Returns:
            Updated trust score.
        """
        state = self._get_state(agent_id)
        state.total_errors += 1
        return self._adjust(agent_id, -ERROR_PENALTY)

    def record_timeout(self, agent_id: str) -> float:
        """Record a timeout while waiting for the resource.

        Returns:
            Updated trust score.
        """
        state = self._get_state(agent_id)
        state.total_timeouts += 1
        return self._adjust(agent_id, -TIMEOUT_PENALTY)

    def score(self, agent_id: str) -> int:
        """Get the current trust score for an agent (0-1000).

        Applies time decay before returning. Returns DEFAULT_SCORE (500)
        for unknown agents.
        """
        if agent_id not in self._agents:
            return DEFAULT_SCORE
        state = self._get_state(agent_id)
        self._apply_decay(state)
        return round(state.score)

    def scores(self) -> dict[str, int]:
        """Get trust scores for all known agents."""
        return {aid: self.score(aid) for aid in self._agents}

    def stats(self, agent_id: str) -> dict[str, object]:
        """Get detailed trust stats for an agent."""
        state = self._get_state(agent_id)
        self._apply_decay(state)
        total = state.total_successes + state.total_errors + state.total_timeouts
        return {
            "score": round(state.score),
            "total_successes": state.total_successes,
            "total_errors": state.total_errors,
            "total_timeouts": state.total_timeouts,
            "total_slo_violations": state.total_slo_violations,
            "success_rate": state.total_successes / total if total > 0 else 1.0,
            "error_rate": state.total_errors / total if total > 0 else 0.0,
        }

    def priority_multiplier(self, agent_id: str) -> float:
        """Get a scheduling priority multiplier based on trust score.

        Maps score to a multiplier range:
          - 1000 -> 1.2 (20% priority boost)
          - 500  -> 1.0 (neutral)
          - 0    -> 0.8 (20% priority reduction)

        Use this to adjust load scores: L(i) * priority_multiplier(i)
        """
        s = self.score(agent_id)
        # Linear map: 0->0.8, 500->1.0, 1000->1.2
        return 0.8 + 0.4 * (s / MAX_SCORE)

    def reset(self, agent_id: str | None = None) -> None:
        """Reset trust state. If agent_id is None, reset all agents."""
        if agent_id is None:
            self._agents.clear()
        else:
            self._agents.pop(agent_id, None)
