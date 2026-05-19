"""BaseAdapter: abstract interface for framework-specific adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Callable

from loco.agent import Agent
from loco.task import Task


class BaseAdapter(ABC):
    """Abstract adapter that translates framework-specific agent patterns
    into the LOCO acquire/release lifecycle.

    Adapters handle two directions:
      Slave → Master: framework context (model, prompt) → Task(weight)
      Master → Slave: grant/wait decisions → proceed/block

    v0.1 ships with VanillaAdapter only. Framework adapters (LangChain,
    Google ADK, CrewAI, OpenAI, AWS, Azure) are v0.2.
    """

    @abstractmethod
    async def register_agent(self, agent_id: str, handler: Callable[..., Any]) -> Agent:
        """Register a callable as a LOCO agent.

        Raises ValueError on duplicate agent_id.
        """

    @abstractmethod
    async def submit_task(self, agent_id: str, task: Task) -> None:
        """Enqueue a task to the specified agent."""

    @abstractmethod
    async def on_scheduled(self, agent_id: str, task: Task) -> Any:
        """Called when the scheduler grants a resource to this agent's task."""

    @abstractmethod
    async def on_completed(self, agent_id: str, task: Task, result: Any) -> None:
        """Called when task execution completes."""
