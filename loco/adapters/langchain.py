"""LangChain adapter for LOCO-Agent.

Provides a callback handler that hooks into LangChain's on_llm_start / on_llm_end
to schedule LLM calls through LOCO. Uses split acquire/release to span the
callback boundary.

Usage:
    from loco import AsyncLOCOScheduler, SharedResource
    from loco.adapters.langchain import LOCOCallbackHandler

    scheduler = AsyncLOCOScheduler([], SharedResource("llm", capacity=3))
    callback = LOCOCallbackHandler(scheduler, agent_id="rag-pipeline")

    # Attach to any LangChain LLM:
    # llm = ChatOpenAI(callbacks=[callback])
"""

from __future__ import annotations

from typing import Any

from loco.adapters._callbacks import CallbackCalls
from loco.async_scheduler import AsyncLOCOScheduler
from loco.task import Task

MODEL_WEIGHTS: dict[str, float] = {
    "gpt-4o": 3.0,
    "gpt-4o-mini": 1.0,
    "gpt-4": 3.0,
    "gpt-3.5-turbo": 1.0,
    "claude-sonnet-4-20250514": 2.0,
    "claude-opus-4-20250514": 5.0,
    "claude-haiku-4-5-20251001": 1.0,
}


def _extract_model(serialized: dict[str, Any]) -> str:
    """Extract model name from LangChain's serialized dict."""
    kwargs = serialized.get("kwargs", {})
    return kwargs.get("model_name") or kwargs.get("model") or serialized.get("id", ["unknown"])[-1]


def _estimate_prompt_tokens(prompts: list[str]) -> int:
    """Rough char-to-token estimate."""
    return sum(len(p) for p in prompts) // 4


class LOCOCallbackHandler:
    """LangChain callback handler that schedules LLM calls through LOCO.

    Create one instance per agent. Attach it to any LangChain LLM or chain
    via the `callbacks` parameter.

    The handler uses split acquire/release:
    - on_llm_start: compute weight, submit task, acquire resource
    - on_llm_end/on_llm_error: release only the matching run_id and task

    Pass the same run_id at start and completion. Without an ID, only one
    call for this agent may be active or waiting at a time.

    Args:
        scheduler: The AsyncLOCOScheduler instance.
        agent_id: Which LOCO agent this callback represents.
    """

    def __init__(self, scheduler: AsyncLOCOScheduler, agent_id: str) -> None:
        self.scheduler = scheduler
        self.agent_id = agent_id
        self._calls = CallbackCalls(scheduler)

    async def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        **kwargs: Any,
    ) -> None:
        """Called before the LLM call. Acquires the resource."""
        model = _extract_model(serialized)
        base_weight = MODEL_WEIGHTS.get(model, 2.0)

        input_tokens = _estimate_prompt_tokens(prompts)
        if input_tokens > 1000:
            weight = base_weight * (input_tokens / 1000)
        else:
            weight = base_weight

        task = Task(weight=weight, task_type=f"langchain:{model}")
        await self._calls.start(self.agent_id, kwargs.get("run_id"), task)

    async def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        """Called after the LLM call completes. Releases the resource."""
        await self._calls.finish(self.agent_id, kwargs.get("run_id"))

    async def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        """Release the matching call on error, including explicit cancellation."""
        await self._calls.finish(self.agent_id, kwargs.get("run_id"))
