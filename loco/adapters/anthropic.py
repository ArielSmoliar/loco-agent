"""Anthropic SDK adapter for LOCO-Agent.

Wraps anthropic.AsyncAnthropic client calls in LOCO scheduling.
Computes task weight from model tier and input token count.
Records actual token usage on completion for empirical cost tracking.

Usage:
    from anthropic import AsyncAnthropic
    from loco import AsyncLOCOScheduler, SharedResource, Agent
    from loco.adapters.anthropic import AnthropicAdapter

    client = AsyncAnthropic()
    scheduler = AsyncLOCOScheduler([], SharedResource("claude_api", capacity=3))
    adapter = AnthropicAdapter(scheduler, client)

    response = await adapter.create("analyst", model="claude-sonnet-4-20250514",
                                     messages=[{"role": "user", "content": "Hello"}])
"""

from __future__ import annotations

from typing import Any

from loco.async_scheduler import AsyncLOCOScheduler
from loco.task import Task

# Model tier weights — relative cost for scheduling priority.
# Not dollar amounts; the load function normalizes across agents.
MODEL_WEIGHTS: dict[str, float] = {
    "claude-opus-4-20250514": 5.0,
    "claude-sonnet-4-20250514": 2.0,
    "claude-haiku-4-5-20251001": 1.0,
}

# Fallback patterns for model families
_MODEL_FAMILY_WEIGHTS: dict[str, float] = {
    "opus": 5.0,
    "sonnet": 2.0,
    "haiku": 1.0,
}


def estimate_weight(model: str, input_tokens: int | None = None) -> float:
    """Estimate task weight from model name and optional input token count.

    Uses model tier as the primary signal. If input_tokens is provided,
    scales weight by relative prompt size (1k tokens = 1x base weight).
    """
    # Exact match first
    base = MODEL_WEIGHTS.get(model)
    if base is None:
        # Fall back to family name matching
        model_lower = model.lower()
        for family, weight in _MODEL_FAMILY_WEIGHTS.items():
            if family in model_lower:
                base = weight
                break
        else:
            base = 2.0  # default to sonnet-tier

    if input_tokens is not None and input_tokens > 0:
        # Scale by prompt size: 1k tokens = 1x, 10k = 10x
        token_multiplier = max(input_tokens / 1000, 1.0)
        return base * token_multiplier

    return base


class AnthropicAdapter:
    """Adapter for the Anthropic Python SDK (anthropic.AsyncAnthropic).

    Wraps messages.create() in LOCO scheduling:
    1. Estimates weight from model + prompt
    2. Submits task and acquires resource (blocks until L(i) wins)
    3. Calls the Anthropic API
    4. Records actual token usage for empirical cost tracking
    5. Releases resource — scheduler re-evaluates waiters

    Args:
        scheduler: The AsyncLOCOScheduler instance.
        client: An anthropic.AsyncAnthropic client instance.
        default_agent_id: Agent ID to use when none is specified.
    """

    def __init__(
        self,
        scheduler: AsyncLOCOScheduler,
        client: Any,
        default_agent_id: str = "anthropic",
    ) -> None:
        self.scheduler = scheduler
        self.client = client
        self.default_agent_id = default_agent_id

    async def create(
        self,
        agent_id: str | None = None,
        *,
        model: str = "claude-sonnet-4-20250514",
        messages: list[dict[str, Any]] | None = None,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> Any:
        """Schedule and execute an Anthropic messages.create() call.

        Args:
            agent_id: Which LOCO agent this call belongs to. Auto-registers
                      if unknown. Defaults to self.default_agent_id.
            model: Anthropic model name.
            messages: Message list for the API call.
            max_tokens: Maximum tokens to generate.
            **kwargs: Additional arguments passed to messages.create().

        Returns:
            The Anthropic Message response object.
        """
        aid = agent_id or self.default_agent_id
        messages = messages or []

        # Estimate input tokens from message content
        input_chars = sum(
            len(str(m.get("content", ""))) for m in messages
        )
        input_tokens_est = input_chars // 4  # rough char-to-token

        weight = estimate_weight(model, input_tokens_est or None)
        task = Task(weight=weight, task_type=f"anthropic:{model}")

        await self.scheduler.submit_task(aid, task)

        async with self.scheduler.acquire(aid):
            response = await self.client.messages.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                **kwargs,
            )

            # Record actual token usage if available
            if hasattr(response, "usage") and response.usage:
                actual_input = getattr(response.usage, "input_tokens", 0)
                actual_output = getattr(response.usage, "output_tokens", 0)
                actual_cost = actual_input + actual_output
                self.scheduler.metrics.record_actual_tokens(
                    aid, task, actual_cost
                )

            # Dequeue the served task
            agent = self.scheduler.get_agent(aid)
            agent.serve_oldest_task()

        return response
