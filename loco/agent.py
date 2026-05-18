"""Agent: a task-holding entity that competes for shared resources."""

from __future__ import annotations

from dataclasses import dataclass, field

from loco.task import Task


@dataclass
class Agent:
    """An agent with a task queue that competes for shared resources.

    The scheduler uses queue_depth_weighted (Qi) and dmax (Dmax_i) to compute
    the agent's load score L(i).

    Attributes:
        agent_id: Unique identifier.
        name: Human-readable name (optional).
        agent_type: Caller-defined category (e.g. "scheduled", "webhook").
        tasks: Pending task queue.
        completed_tasks: Tasks that have been served.
    """

    agent_id: str
    name: str = ""
    agent_type: str = "default"
    tasks: list[Task] = field(default_factory=list)
    completed_tasks: list[Task] = field(default_factory=list)

    @property
    def queue_depth_weighted(self) -> float:
        """Qi: sum of task weights in queue."""
        return sum(t.weight for t in self.tasks)

    @property
    def dmax(self) -> float:
        """Dmax_i: age of the oldest waiting task. Returns 0.0 if queue is empty."""
        if not self.tasks:
            return 0.0
        return float(max(t.age for t in self.tasks))

    def serve_oldest_task(self) -> Task | None:
        """Remove and return the task with the highest age.

        The served task is appended to completed_tasks.
        Returns None if the queue is empty.
        """
        if not self.tasks:
            return None
        oldest = max(self.tasks, key=lambda t: t.age)
        self.tasks.remove(oldest)
        self.completed_tasks.append(oldest)
        return oldest
