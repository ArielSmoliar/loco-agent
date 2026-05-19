"""Google ADK adapter for LOCO-Agent.

Provides before_model_callback / after_model_callback functions that hook
into ADK's agent lifecycle. Uses split acquire/release to span the callback
boundary.

Usage:
    from loco import AsyncLOCOScheduler, SharedResource
    from loco.adapters.google_adk import ADKAdapter

    scheduler = AsyncLOCOScheduler([], SharedResource("gemini", capacity=3))
    adapter = ADKAdapter(scheduler)

    # Wire into ADK agent:
    # agent = adk.Agent(name="support", model="gemini-2.0-flash",
    #                   before_model_callback=adapter.before_model,
    #                   after_model_callback=adapter.after_model)
"""

from __future__ import annotations

from typing import Any

from loco.async_scheduler import AcquireHandle, AsyncLOCOScheduler
from loco.task import Task

MODEL_WEIGHTS: dict[str, float] = {
    "gemini-2.5-pro": 3.0,
    "gemini-2.5-flash": 1.5,
    "gemini-2.0-flash": 1.0,
    "gemini-1.5-pro": 2.0,
    "gemini-1.5-flash": 1.0,
}

_MODEL_FAMILY_WEIGHTS: dict[str, float] = {
    "pro": 3.0,
    "flash": 1.0,
}


def _estimate_weight(model: str) -> float:
    """Estimate weight from ADK model name."""
    base = MODEL_WEIGHTS.get(model)
    if base is None:
        model_lower = model.lower()
        for family, weight in _MODEL_FAMILY_WEIGHTS.items():
            if family in model_lower:
                base = weight
                break
        else:
            base = 1.5
    return base


class ADKAdapter:
    """Adapter for Google Agent Development Kit (ADK).

    Provides before_model / after_model callbacks that schedule LLM calls
    through LOCO. Reads ctx.model and ctx.agent_name from ADK's callback
    context.

    Handles are stored per agent_name to support ADK's ParallelAgent
    (multiple concurrent sub-agents).

    Args:
        scheduler: The AsyncLOCOScheduler instance.
    """

    def __init__(self, scheduler: AsyncLOCOScheduler) -> None:
        self.scheduler = scheduler
        self._handles: dict[str, AcquireHandle] = {}

    async def before_model(self, ctx: Any, llm_request: Any) -> Any:
        """ADK before_model_callback. Acquires the resource.

        Args:
            ctx: ADK callback context with .model and .agent_name.
            llm_request: The LLM request (passed through unchanged).

        Returns:
            None (proceed with the call).
        """
        model = getattr(ctx, "model", "unknown")
        agent_name = getattr(ctx, "agent_name", "adk-agent")

        weight = _estimate_weight(model)
        task = Task(weight=weight, task_type=f"adk:{model}")
        await self.scheduler.submit_task(agent_name, task)
        handle = await self.scheduler.acquire_start(agent_name)
        self._handles[agent_name] = handle
        return None

    async def after_model(self, ctx: Any, llm_response: Any) -> Any:
        """ADK after_model_callback. Releases the resource.

        Args:
            ctx: ADK callback context.
            llm_response: The LLM response (passed through unchanged).

        Returns:
            The llm_response unchanged.
        """
        agent_name = getattr(ctx, "agent_name", "adk-agent")
        handle = self._handles.pop(agent_name, None)
        if handle:
            agent = self.scheduler.get_agent(agent_name)
            agent.serve_oldest_task()
            await self.scheduler.release_handle(handle)
        return llm_response
