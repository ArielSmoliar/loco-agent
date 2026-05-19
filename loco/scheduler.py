"""LOCOScheduler: the scoring core of LOCO-Agent."""

from __future__ import annotations

import random
from collections import deque
from dataclasses import dataclass
from typing import Any

from loco.agent import Agent
from loco.task import Task

OPTIMIZE_FOR_ALPHA = {
    "latency": 0.0,
    "balanced": 0.25,
    "throughput": 0.5,
}


@dataclass
class StepResult:
    """Result of a single scheduler tick."""

    selected_agent: Agent | None
    served_task: Task | None
    scores: dict[str, float]


class LOCOScheduler:
    """Load-Conscious Orchestration scheduler.

    Sync scoring core that implements the load function from the 2011 thesis.
    Used directly for testing and scenario replay. The async resource layer
    (Day 4-5) wraps this with acquire/release.

    Each _step():
      1. Accept new task arrivals
      2. Compute L(i) for all agents with non-empty queues
      3. Grant resource to highest L(i) -- random tie-break
      4. Serve one task from the selected agent
      5. Age all remaining waiting tasks
    """

    def __init__(
        self,
        agents: list[Agent],
        *,
        alpha: float | None = None,
        optimize_for: str | None = None,
        max_history: int = 10_000,
        seed: int | None = None,
    ) -> None:
        if alpha is not None and optimize_for is not None:
            raise ValueError(
                "Pass alpha or optimize_for, not both"
            )

        if optimize_for is not None:
            if optimize_for not in OPTIMIZE_FOR_ALPHA:
                raise ValueError(
                    f"optimize_for must be one of {list(OPTIMIZE_FOR_ALPHA)}, "
                    f"got {optimize_for!r}"
                )
            resolved_alpha = OPTIMIZE_FOR_ALPHA[optimize_for]
        elif alpha is not None:
            if not 0.0 <= alpha <= 1.0:
                raise ValueError(f"alpha must be in [0.0, 1.0], got {alpha}")
            resolved_alpha = alpha
        else:
            resolved_alpha = OPTIMIZE_FOR_ALPHA["balanced"]

        self.agents = {a.agent_id: a for a in agents}
        self.alpha = resolved_alpha
        self.max_history = max_history
        self.rng = random.Random(seed)
        self.tick = 0
        self.history: deque[dict[str, Any]] = deque(maxlen=max_history)
        self._task_counter = 0

    def get_agent(self, agent_id: str) -> Agent:
        """Look up an agent by ID. Raises ValueError if not found."""
        if agent_id not in self.agents:
            raise ValueError(f"Unknown agent: {agent_id}")
        return self.agents[agent_id]

    def new_task(self, weight: float = 1.0, task_type: str = "default") -> Task:
        """Create a task with an auto-incremented ID and current tick as arrival."""
        t = Task(
            task_id=str(self._task_counter),
            weight=weight,
            arrival_tick=self.tick,
            task_type=task_type,
        )
        self._task_counter += 1
        return t

    def compute_load_scores(self) -> dict[str, float]:
        """L(i) = alpha * (Qi / max Qj) + (1 - alpha) * (Dmax_i / max Dmax_j)

        Returns scores for all agents with non-empty queues.
        Returns empty dict if no agents have tasks.
        """
        active = [a for a in self.agents.values() if a.tasks]
        if not active:
            return {}

        q_vals = {a.agent_id: a.queue_depth_weighted for a in active}
        d_vals = {a.agent_id: a.dmax for a in active}

        max_q = max(q_vals.values()) or 1.0
        max_d = max(d_vals.values()) or 1.0

        return {
            aid: self.alpha * (q_vals[aid] / max_q) + (1 - self.alpha) * (d_vals[aid] / max_d)
            for aid in q_vals
        }

    def select_agent(self, scores: dict[str, float]) -> Agent | None:
        """Highest score wins. Random tie-break (seeded for determinism).

        Returns None if scores is empty.
        """
        if not scores:
            return None
        max_score = max(scores.values())
        candidates = [
            self.agents[aid] for aid, s in scores.items() if s == max_score
        ]
        return self.rng.choice(candidates)

    def total_tasks_remaining(self) -> int:
        """Count unserved tasks across all agents."""
        return sum(len(a.tasks) for a in self.agents.values())

    def mean_wait_time(self, agent_id: str) -> float:
        """Average age of completed tasks for the given agent."""
        agent = self.get_agent(agent_id)
        if not agent.completed_tasks:
            return 0.0
        return sum(t.age for t in agent.completed_tasks) / len(agent.completed_tasks)

    def _step(self, arrivals: dict[str, list[Task]] | None = None) -> StepResult:
        """Run one simulation tick.

        1. Accept arrivals
        2. Score all agents
        3. Select winner
        4. Serve one task from winner
        5. Age all remaining tasks by 1

        Returns StepResult with the selected agent, served task, and scores.
        """
        if arrivals:
            for agent_id, tasks in arrivals.items():
                agent = self.get_agent(agent_id)
                for task in tasks:
                    agent.tasks.append(task)

        scores = self.compute_load_scores()
        selected = self.select_agent(scores)
        served = selected.serve_oldest_task() if selected else None

        # Age all remaining waiting tasks
        for agent in self.agents.values():
            for task in agent.tasks:
                task.age += 1

        self.history.append({
            "tick": self.tick,
            "scores": dict(scores),
            "served_agent_id": selected.agent_id if selected else None,
            "served_task_id": served.task_id if served else None,
            "served_task_age": served.age if served else None,
            "queue_depths": {aid: len(a.tasks) for aid, a in self.agents.items()},
            "dmax_vals": {aid: a.dmax for aid, a in self.agents.items()},
        })

        self.tick += 1
        return StepResult(selected_agent=selected, served_task=served, scores=scores)
