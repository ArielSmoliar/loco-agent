"""Developer testing utilities for LOCO-Agent.

Write your first LOCO-Agent test in under 10 lines:

    from loco.testing import SyncTestScheduler, mock_agent

    def test_my_agent_gets_priority():
        agents = [mock_agent("mine", pending_tasks=10),
                  mock_agent("other", pending_tasks=2)]
        scheduler = SyncTestScheduler(agents, alpha=0.5, seed=42)
        result = scheduler.step()
        assert result.selected_agent == "mine"
"""

from __future__ import annotations

from dataclasses import dataclass, field

from loco.agent import Agent
from loco.metrics import jains_fairness
from loco.resource import SharedResource
from loco.scheduler import LOCOScheduler, StepResult
from loco.task import Task


def mock_resource(name: str = "test", capacity: int = 1) -> SharedResource:
    """Create a SharedResource for testing."""
    return SharedResource(name=name, capacity=capacity)


def mock_agent(
    agent_id: str,
    pending_tasks: int = 0,
    task_weight: float = 1.0,
    agent_type: str = "default",
) -> Agent:
    """Create an Agent pre-loaded with tasks for testing."""
    agent = Agent(agent_id=agent_id, agent_type=agent_type)
    for i in range(pending_tasks):
        agent.tasks.append(
            Task(task_id=f"{agent_id}-t{i}", weight=task_weight)
        )
    return agent


@dataclass
class RunResult:
    """Result of running a scheduler until all tasks complete."""

    steps: list[StepResult] = field(default_factory=list)
    total_ticks: int = 0

    @property
    def service_counts(self) -> dict[str, int]:
        """How many tasks each agent was served."""
        counts: dict[str, int] = {}
        for step in self.steps:
            if step.selected_agent:
                aid = step.selected_agent.agent_id
                counts[aid] = counts.get(aid, 0) + 1
        return counts

    @property
    def service_order(self) -> list[str]:
        """Ordered list of agent IDs served, one per tick."""
        return [
            step.selected_agent.agent_id
            for step in self.steps
            if step.selected_agent
        ]


class SyncTestScheduler:
    """Wraps LOCOScheduler with synchronous step() for deterministic testing.

    Uses the sync scoring core directly — no async, no resource, no I/O.
    Same compute_load_scores() / select_agent() as production. Deterministic
    with seed.

    Usage:
        agents = [mock_agent("a", pending_tasks=5),
                  mock_agent("b", pending_tasks=2)]
        scheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)
        result = scheduler.step()
        assert result.selected_agent == "a"
    """

    def __init__(
        self,
        agents: list[Agent],
        *,
        alpha: float | None = None,
        optimize_for: str | None = None,
        seed: int = 42,
    ) -> None:
        self._scheduler = LOCOScheduler(
            agents, alpha=alpha, optimize_for=optimize_for, seed=seed
        )

    @property
    def agents(self) -> dict[str, Agent]:
        return self._scheduler.agents

    @property
    def tick(self) -> int:
        return self._scheduler.tick

    def get_agent(self, agent_id: str) -> Agent:
        return self._scheduler.get_agent(agent_id)

    def add_tasks(self, agent_id: str, tasks: list[Task]) -> None:
        """Add tasks to an agent's queue."""
        agent = self._scheduler.get_agent(agent_id)
        for task in tasks:
            agent.tasks.append(task)

    def step(self, arrivals: dict[str, list[Task]] | None = None) -> StepResult:
        """Run one deterministic tick. Returns StepResult."""
        return self._scheduler._step(arrivals=arrivals)

    def run_all(self) -> RunResult:
        """Run until no tasks remain. Returns RunResult with full history."""
        result = RunResult()
        while self._scheduler.total_tasks_remaining() > 0:
            step = self._scheduler._step()
            result.steps.append(step)
        result.total_ticks = self._scheduler.tick
        return result

    def total_tasks_remaining(self) -> int:
        return self._scheduler.total_tasks_remaining()

    def mean_wait_time(self, agent_id: str) -> float:
        return self._scheduler.mean_wait_time(agent_id)

    def jains_fairness(self) -> float:
        """Jain's fairness index on mean wait times across all agents."""
        waits = [
            self.mean_wait_time(aid)
            for aid in self.agents
        ]
        return jains_fairness(waits)
