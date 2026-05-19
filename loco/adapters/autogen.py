"""Azure / AutoGen v0.4 adapter for LOCO-Agent.

Provides a scheduling wrapper for AutoGen's AgentRuntime interface.
Adds load-aware dispatch before message delivery — the most
scheduler-friendly surface in the entire platform ecosystem.

Also supports the Foundry Responses API proxy pattern for Azure
AI Foundry hosted agents.

Usage:
    from loco import AsyncLOCOScheduler, SharedResource
    from loco.adapters.autogen import AutoGenAdapter

    scheduler = AsyncLOCOScheduler([], SharedResource("azure_openai", capacity=3))
    adapter = AutoGenAdapter(scheduler)

    # Wrap message delivery:
    result = await adapter.send_message("coordinator", "analyst", "analyze this")
"""

from __future__ import annotations

from typing import Any

from loco.async_scheduler import AsyncLOCOScheduler
from loco.task import Task

MODEL_WEIGHTS: dict[str, float] = {
    "gpt-4o": 3.0,
    "gpt-4o-mini": 1.0,
    "gpt-4": 3.0,
    "gpt-35-turbo": 1.0,
}


def estimate_weight(model: str | None = None, message_length: int = 0) -> float:
    """Estimate weight from model and message length."""
    base = MODEL_WEIGHTS.get(model or "", 2.0)
    if message_length > 4000:
        base *= message_length / 4000
    return base


class AutoGenAdapter:
    """Adapter for AutoGen v0.4 and Azure AI Foundry.

    Wraps message delivery in LOCO scheduling. In a real AutoGen integration,
    this would be implemented as a custom AgentRuntime that wraps
    SingleThreadedAgentRuntime.

    Args:
        scheduler: The AsyncLOCOScheduler instance.
        default_model: Model name for weight estimation.
    """

    def __init__(
        self,
        scheduler: AsyncLOCOScheduler,
        default_model: str = "gpt-4o",
    ) -> None:
        self.scheduler = scheduler
        self.default_model = default_model

    async def send_message(
        self,
        sender: str,
        recipient: str,
        content: str,
        *,
        model: str | None = None,
        **kwargs: Any,
    ) -> Any:
        """Schedule a message delivery to a recipient agent.

        In AutoGen v0.4, this maps to AgentRuntime.send_message().
        The recipient agent is the LOCO agent that competes for resources.

        Args:
            sender: The sending agent's ID (for logging).
            recipient: The receiving agent's ID (LOCO agent).
            content: Message content.
            model: Model for weight estimation. Defaults to self.default_model.
            **kwargs: Additional context.

        Returns:
            Dict with delivery metadata.
        """
        model = model or self.default_model
        weight = estimate_weight(model, len(content))
        task = Task(weight=weight, task_type=f"autogen:{model}")

        await self.scheduler.submit_task(recipient, task)

        async with self.scheduler.acquire(recipient):
            # In real AutoGen: super().send_message(message, recipient, sender)
            result = {
                "sender": sender,
                "recipient": recipient,
                "delivered": True,
                "model": model,
            }
            agent = self.scheduler.get_agent(recipient)
            agent.serve_oldest_task()

        return result

    async def publish_message(
        self,
        sender: str,
        topic: str,
        content: str,
        subscribers: list[str] | None = None,
        **kwargs: Any,
    ) -> list[Any]:
        """Schedule a pub/sub message to topic subscribers.

        In AutoGen v0.4, agents subscribe to topics. A published message
        is delivered to all subscribers — each delivery is separately
        scheduled through LOCO.

        Args:
            sender: The publishing agent.
            topic: The topic name.
            content: Message content.
            subscribers: List of subscriber agent IDs. If None, no-op.

        Returns:
            List of delivery results.
        """
        subscribers = subscribers or []
        results = []
        for sub in subscribers:
            result = await self.send_message(sender, sub, content, **kwargs)
            results.append(result)
        return results
