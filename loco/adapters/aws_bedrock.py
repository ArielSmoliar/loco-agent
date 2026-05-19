"""AWS Bedrock Agents adapter for LOCO-Agent.

Wraps Bedrock agent invocations in LOCO scheduling using the
RETURN_CONTROL action group pattern: pause the orchestration loop,
let LOCO decide when to resume.

Usage:
    from loco import AsyncLOCOScheduler, SharedResource
    from loco.adapters.aws_bedrock import BedrockAdapter

    scheduler = AsyncLOCOScheduler([], SharedResource("bedrock", capacity=5))
    adapter = BedrockAdapter(scheduler)

    response = await adapter.invoke("auditor-1", model_id="anthropic.claude-3-sonnet")
"""

from __future__ import annotations

from typing import Any

from loco.async_scheduler import AsyncLOCOScheduler
from loco.task import Task

MODEL_WEIGHTS: dict[str, float] = {
    "anthropic.claude-sonnet-4-20250514-v1:0": 2.0,
    "anthropic.claude-opus-4-20250514-v1:0": 5.0,
    "anthropic.claude-haiku-4-5-20251001-v1:0": 1.0,
    "amazon.titan-text-express-v1": 1.0,
    "amazon.titan-text-premier-v1:0": 2.0,
    "meta.llama3-70b-instruct-v1:0": 3.0,
}

_MODEL_FAMILY_WEIGHTS: dict[str, float] = {
    "opus": 5.0,
    "sonnet": 2.0,
    "haiku": 1.0,
    "titan": 1.5,
    "llama": 2.0,
}


def estimate_weight(model_id: str) -> float:
    """Estimate weight from Bedrock model ID."""
    base = MODEL_WEIGHTS.get(model_id)
    if base is None:
        model_lower = model_id.lower()
        for family, weight in _MODEL_FAMILY_WEIGHTS.items():
            if family in model_lower:
                base = weight
                break
        else:
            base = 2.0
    return base


class BedrockAdapter:
    """Adapter for AWS Bedrock Agents.

    Models the RETURN_CONTROL pattern: when a Bedrock agent hits a
    scheduling gate (action group), control returns to the caller.
    LOCO-Agent decides when to resume based on load scores.

    For real AWS usage, the invoke method would call bedrock-agent-runtime
    InvokeAgent API. This adapter wraps that call in acquire/release.

    Args:
        scheduler: The AsyncLOCOScheduler instance.
        client: Optional boto3 bedrock-agent-runtime client.
    """

    def __init__(
        self,
        scheduler: AsyncLOCOScheduler,
        client: Any = None,
    ) -> None:
        self.scheduler = scheduler
        self.client = client

    async def invoke(
        self,
        agent_id: str,
        *,
        model_id: str = "anthropic.claude-sonnet-4-20250514-v1:0",
        input_text: str = "",
        **kwargs: Any,
    ) -> Any:
        """Schedule and invoke a Bedrock agent.

        Args:
            agent_id: LOCO agent ID for this Bedrock agent.
            model_id: Bedrock model identifier.
            input_text: Input to the agent.
            **kwargs: Additional arguments for the Bedrock API.

        Returns:
            The API response (or mock result if no client).
        """
        weight = estimate_weight(model_id)
        task = Task(weight=weight, task_type=f"bedrock:{model_id}")
        await self.scheduler.submit_task(agent_id, task)

        async with self.scheduler.acquire(agent_id):
            if self.client:
                response = self.client.invoke_agent(
                    agentId=agent_id,
                    inputText=input_text,
                    **kwargs,
                )
            else:
                response = {"agent_id": agent_id, "model_id": model_id, "status": "completed"}

            agent = self.scheduler.get_agent(agent_id)
            agent.serve_oldest_task()

        return response
