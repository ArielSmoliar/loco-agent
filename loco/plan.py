"""Static execution plans for LOCO-Agent.

A Plan is an immutable DAG of Steps. Users compose plans with the scheduler
manually in v0.3; deep scheduler integration (auto-executing plans) is v0.5.

Usage:
    plan = Plan(steps=[
        Step("fetch", agent="reader"),
        Step("analyze", agent="analyst", depends_on=["fetch"]),
        Step("respond", agent="writer", depends_on=["analyze"]),
    ])
    plan.validate()

    completed = set()
    while not plan.is_complete(completed):
        for step in plan.ready_steps(completed):
            # submit and run step via scheduler
            completed.add(step.step_id)
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:
    from loco.labels import SecurityLabel


@dataclass
class Step:
    """A single step in an execution plan.

    Attributes:
        step_id: Unique identifier for this step within the plan.
        agent: The agent_id that should execute this step.
        depends_on: Step IDs that must complete before this step can run.
        weight: Cost weight for the task created from this step.
        labels: Optional security labels for data flowing through this step.
    """

    step_id: str
    agent: str
    depends_on: list[str] = field(default_factory=list)
    weight: float = 1.0
    labels: dict[str, SecurityLabel] | None = None


@dataclass
class Plan:
    """An immutable execution DAG.

    Attributes:
        plan_id: Unique identifier for this plan.
        steps: Ordered list of steps in the plan.
    """

    plan_id: str = field(default_factory=lambda: uuid4().hex[:12])
    steps: list[Step] = field(default_factory=list)

    def _step_map(self) -> dict[str, Step]:
        return {s.step_id: s for s in self.steps}

    def validate(self) -> None:
        """Check for cycles, missing dependencies, and duplicate step IDs.

        Raises ValueError on any structural problem.
        """
        step_map = self._step_map()

        # Check for duplicate step IDs
        ids = [s.step_id for s in self.steps]
        if len(ids) != len(set(ids)):
            dupes = [sid for sid in ids if ids.count(sid) > 1]
            raise ValueError(f"Duplicate step IDs: {sorted(set(dupes))}")

        # Check for missing dependencies
        for step in self.steps:
            for dep in step.depends_on:
                if dep not in step_map:
                    raise ValueError(
                        f"Step {step.step_id!r} depends on unknown step {dep!r}"
                    )

        # Check for cycles via topological sort attempt
        self.topological_sort()  # raises ValueError on cycle

    def topological_sort(self) -> list[str]:
        """Return step IDs in valid execution order (Kahn's algorithm).

        Raises ValueError if the DAG contains a cycle.
        """
        # Build in-degree map
        in_degree: dict[str, int] = {s.step_id: 0 for s in self.steps}
        dependents: dict[str, list[str]] = {s.step_id: [] for s in self.steps}

        for step in self.steps:
            for dep in step.depends_on:
                in_degree[step.step_id] += 1
                dependents[dep].append(step.step_id)

        # Start with zero-degree nodes
        queue: deque[str] = deque(
            sid for sid, deg in in_degree.items() if deg == 0
        )
        result: list[str] = []

        while queue:
            sid = queue.popleft()
            result.append(sid)
            for dependent in dependents[sid]:
                in_degree[dependent] -= 1
                if in_degree[dependent] == 0:
                    queue.append(dependent)

        if len(result) != len(self.steps):
            remaining = set(in_degree) - set(result)
            raise ValueError(f"Cycle detected involving steps: {sorted(remaining)}")

        return result

    def ready_steps(self, completed: set[str]) -> list[Step]:
        """Return steps whose dependencies are all satisfied.

        Args:
            completed: Set of step IDs that have been completed.

        Returns:
            List of Steps ready to execute (dependencies met, not yet completed).
        """
        ready = []
        for step in self.steps:
            if step.step_id in completed:
                continue
            if all(dep in completed for dep in step.depends_on):
                ready.append(step)
        return ready

    def is_complete(self, completed: set[str]) -> bool:
        """True if all steps have been completed."""
        return all(s.step_id in completed for s in self.steps)

    def step(self, step_id: str) -> Step:
        """Get a step by ID. Raises KeyError if not found."""
        for s in self.steps:
            if s.step_id == step_id:
                return s
        raise KeyError(f"Step not found: {step_id!r}")

    def __len__(self) -> int:
        return len(self.steps)
