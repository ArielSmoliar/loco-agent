"""Task: the unit of work in LOCO-Agent."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid4


@dataclass
class Task:
    """A unit of work queued to an agent.

    Attributes:
        task_id: Unique identifier. Auto-generated if not provided.
        weight: Normalized cost (>= 1.0). 1=cheap, 2=medium, 3=expensive.
        arrival_tick: Logical tick when the task was created.
        age: Ticks spent waiting. Incremented by the scheduler on each logical tick.
        task_type: Caller-defined category (e.g. "llm_call", "webhook").
    """

    task_id: str = field(default_factory=lambda: uuid4().hex[:12])
    weight: float = 1.0
    arrival_tick: int = 0
    age: int = 0
    task_type: str = "default"

    def __post_init__(self) -> None:
        if self.weight < 1.0:
            raise ValueError(f"Task weight must be >= 1.0, got {self.weight}")
