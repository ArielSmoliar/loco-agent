"""OpenAI SDK adapter for LOCO-Agent.

Wraps openai.AsyncOpenAI client calls in LOCO scheduling.
Computes task weight from model tier and input token count.
Records actual token usage on completion for empirical cost tracking.

Usage:
    from openai import AsyncOpenAI
    from loco import AsyncLOCOScheduler, SharedResource
    from loco.adapters.openai import OpenAIAdapter

    client = AsyncOpenAI()
    scheduler = AsyncLOCOScheduler([], SharedResource("openai_api", capacity=5))
    adapter = OpenAIAdapter(scheduler, client)

    response = await adapter.create("assistant", model="gpt-4o",
                                     messages=[{"role": "user", "content": "Hello"}])
"""

from __future__ import annotations

from typing import Any

from loco.async_scheduler import AsyncLOCOScheduler
from loco.task import Task

MODEL_WEIGHTS: dict[str, float] = {
    "o3": 5.0,
    "o4-mini": 2.0,
    "gpt-4.1": 3.0,
    "gpt-4.1-mini": 1.5,
    "gpt-4.1-nano": 1.0,
    "gpt-4o": 3.0,
    "gpt-4o-mini": 1.0,
}

_MODEL_FAMILY_WEIGHTS: dict[str, float] = {
    "o3": 5.0,
    "o4": 2.0,
    "gpt-4.1": 3.0,
    "gpt-4o": 3.0,
    "gpt-4": 3.0,
    "gpt-3.5": 1.0,
}


def estimate_weight(model: str, input_tokens: int | None = None) -> float:
    """Estimate task weight from model name and optional input token count."""
    base = MODEL_WEIGHTS.get(model)
    if base is None:
        model_lower = model.lower()
        for family, weight in _MODEL_FAMILY_WEIGHTS.items():
            if family in model_lower:
                base = weight
                break
        else:
            base = 2.0

    if input_tokens is not None and input_tokens > 0:
        token_multiplier = max(input_tokens / 1000, 1.0)
        return base * token_multiplier

    return base


class OpenAIAdapter:
    """Adapter for the OpenAI Python SDK (openai.AsyncOpenAI).

    Wraps chat.completions.create() in LOCO scheduling:
    1. Estimates weight from model + prompt
    2. Submits task and acquires resource
    3. Calls the OpenAI API
    4. Records actual token usage from response.usage
    5. Releases resource

    Args:
        scheduler: The AsyncLOCOScheduler instance.
        client: An openai.AsyncOpenAI client instance.
        default_agent_id: Agent ID to use when none is specified.
    """

    def __init__(
        self,
        scheduler: AsyncLOCOScheduler,
        client: Any,
        default_agent_id: str = "openai",
    ) -> None:
        self.scheduler = scheduler
        self.client = client
        self.default_agent_id = default_agent_id

    async def create(
        self,
        agent_id: str | None = None,
        *,
        model: str = "gpt-4o",
        messages: list[dict[str, Any]] | None = None,
        **kwargs: Any,
    ) -> Any:
        """Schedule and execute an OpenAI chat.completions.create() call.

        Args:
            agent_id: Which LOCO agent this call belongs to. Auto-registers
                      if unknown. Defaults to self.default_agent_id.
            model: OpenAI model name.
            messages: Message list for the API call.
            **kwargs: Additional arguments passed to chat.completions.create().

        Returns:
            The OpenAI ChatCompletion response object.
        """
        aid = agent_id or self.default_agent_id
        messages = messages or []

        input_chars = sum(
            len(str(m.get("content", ""))) for m in messages
        )
        input_tokens_est = input_chars // 4

        weight = estimate_weight(model, input_tokens_est or None)
        task = Task(weight=weight, task_type=f"openai:{model}")

        await self.scheduler.submit_task(aid, task)

        async with self.scheduler.acquire(aid):
            response = await self.client.chat.completions.create(
                model=model,
                messages=messages,
                **kwargs,
            )

            # Record actual token usage if available
            if hasattr(response, "usage") and response.usage:
                actual_total = getattr(response.usage, "total_tokens", 0)
                self.scheduler.metrics.record_actual_tokens(
                    aid, task, actual_total
                )

            agent = self.scheduler.get_agent(aid)
            agent.serve_oldest_task()

        return response
