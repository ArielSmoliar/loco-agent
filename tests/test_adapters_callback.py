"""Tests for callback-based adapters: LangChain, Google ADK, CrewAI (v0.2.1)."""

import asyncio
from dataclasses import dataclass
from typing import Any

import pytest

from loco.adapters.langchain import LOCOCallbackHandler, _extract_model
from loco.adapters.google_adk import ADKAdapter, _estimate_weight as adk_weight
from loco.adapters.crewai import CrewAIAdapter
from loco.async_scheduler import AsyncLOCOScheduler
from loco.resource import SharedResource


def _sched(capacity: int = 1) -> AsyncLOCOScheduler:
    return AsyncLOCOScheduler(
        [], SharedResource(name="test", capacity=capacity),
        optimize_for="balanced",
    )


# ---------------------------------------------------------------------------
# LangChain adapter
# ---------------------------------------------------------------------------

class TestLangChainAdapter:

    @pytest.mark.asyncio
    async def test_on_llm_start_acquires(self):
        sched = _sched()
        cb = LOCOCallbackHandler(sched, "rag")
        await cb.on_llm_start(
            {"kwargs": {"model_name": "gpt-4o"}},
            ["What is the meaning of life?"],
        )
        assert sched.resource.is_holding("rag")
        assert cb._handle is not None
        await cb.on_llm_end("response")

    @pytest.mark.asyncio
    async def test_on_llm_end_releases(self):
        sched = _sched()
        cb = LOCOCallbackHandler(sched, "rag")
        await cb.on_llm_start(
            {"kwargs": {"model_name": "gpt-4o"}},
            ["Hello"],
        )
        await cb.on_llm_end("response")
        assert not sched.resource.is_holding("rag")
        assert cb._handle is None

    @pytest.mark.asyncio
    async def test_auto_registers_agent(self):
        sched = _sched()
        cb = LOCOCallbackHandler(sched, "new-agent")
        await cb.on_llm_start({"kwargs": {"model_name": "gpt-4o"}}, ["Hi"])
        assert "new-agent" in sched.agents
        await cb.on_llm_end("done")

    @pytest.mark.asyncio
    async def test_records_cost(self):
        sched = _sched()
        cb = LOCOCallbackHandler(sched, "rag")
        await cb.on_llm_start({"kwargs": {"model_name": "gpt-4o"}}, ["x"])
        await cb.on_llm_end("done")
        assert sched.metrics.agent_cost("rag") == 3.0  # gpt-4o = 3.0

    @pytest.mark.asyncio
    async def test_dequeues_task(self):
        sched = _sched()
        cb = LOCOCallbackHandler(sched, "rag")
        await cb.on_llm_start({"kwargs": {"model_name": "gpt-4o"}}, ["x"])
        await cb.on_llm_end("done")
        assert len(sched.get_agent("rag").completed_tasks) == 1
        assert len(sched.get_agent("rag").tasks) == 0

    @pytest.mark.asyncio
    async def test_on_llm_error_releases(self):
        sched = _sched()
        cb = LOCOCallbackHandler(sched, "rag")
        await cb.on_llm_start({"kwargs": {"model_name": "gpt-4o"}}, ["x"])
        assert sched.resource.is_holding("rag")
        await cb.on_llm_error(RuntimeError("API error"))
        assert not sched.resource.is_holding("rag")

    @pytest.mark.asyncio
    async def test_concurrent_callbacks(self):
        """Two LangChain agents compete for capacity=1."""
        sched = _sched(capacity=1)
        cb1 = LOCOCallbackHandler(sched, "agent-1")
        cb2 = LOCOCallbackHandler(sched, "agent-2")

        await cb1.on_llm_start({"kwargs": {"model_name": "gpt-4o"}}, ["x"])
        assert sched.resource.is_holding("agent-1")

        # agent-2 must wait
        acquired = asyncio.Event()

        async def agent2_start():
            await cb2.on_llm_start({"kwargs": {"model_name": "gpt-4o"}}, ["y"])
            acquired.set()

        task = asyncio.create_task(agent2_start())
        await asyncio.sleep(0.01)
        assert not acquired.is_set()

        # Release agent-1 → agent-2 gets granted
        await cb1.on_llm_end("done")
        await asyncio.sleep(0.01)
        assert acquired.is_set()

        await cb2.on_llm_end("done")
        await task

    def test_extract_model_from_serialized(self):
        assert _extract_model({"kwargs": {"model_name": "gpt-4o"}}) == "gpt-4o"
        assert _extract_model({"kwargs": {"model": "claude-sonnet-4-20250514"}}) == "claude-sonnet-4-20250514"
        assert _extract_model({"id": ["langchain", "openai", "gpt-4"]}) == "gpt-4"


# ---------------------------------------------------------------------------
# Google ADK adapter
# ---------------------------------------------------------------------------

@dataclass
class MockADKContext:
    agent_name: str = "support"
    model: str = "gemini-2.0-flash"


class TestADKAdapter:

    @pytest.mark.asyncio
    async def test_before_model_acquires(self):
        sched = _sched()
        adapter = ADKAdapter(sched)
        ctx = MockADKContext(agent_name="support", model="gemini-2.0-flash")
        result = await adapter.before_model(ctx, None)
        assert result is None  # proceed with call
        assert sched.resource.is_holding("support")
        await adapter.after_model(ctx, "response")

    @pytest.mark.asyncio
    async def test_after_model_releases(self):
        sched = _sched()
        adapter = ADKAdapter(sched)
        ctx = MockADKContext()
        await adapter.before_model(ctx, None)
        resp = await adapter.after_model(ctx, "the response")
        assert resp == "the response"  # passthrough
        assert not sched.resource.is_holding("support")

    @pytest.mark.asyncio
    async def test_auto_registers(self):
        sched = _sched()
        adapter = ADKAdapter(sched)
        ctx = MockADKContext(agent_name="new-bot")
        await adapter.before_model(ctx, None)
        assert "new-bot" in sched.agents
        await adapter.after_model(ctx, "done")

    @pytest.mark.asyncio
    async def test_model_weight_mapping(self):
        assert adk_weight("gemini-2.5-pro") == 3.0
        assert adk_weight("gemini-2.0-flash") == 1.0
        assert adk_weight("gemini-2.5-flash") == 1.5

    @pytest.mark.asyncio
    async def test_parallel_agents(self):
        """Two ADK sub-agents running in parallel."""
        sched = _sched(capacity=2)
        adapter = ADKAdapter(sched)
        ctx1 = MockADKContext(agent_name="agent-a", model="gemini-2.0-flash")
        ctx2 = MockADKContext(agent_name="agent-b", model="gemini-2.5-pro")

        await adapter.before_model(ctx1, None)
        await adapter.before_model(ctx2, None)
        assert sched.resource.is_holding("agent-a")
        assert sched.resource.is_holding("agent-b")

        await adapter.after_model(ctx1, "resp-a")
        await adapter.after_model(ctx2, "resp-b")
        assert not sched.resource.is_holding("agent-a")
        assert not sched.resource.is_holding("agent-b")

    @pytest.mark.asyncio
    async def test_records_cost(self):
        sched = _sched()
        adapter = ADKAdapter(sched)
        ctx = MockADKContext(model="gemini-2.5-pro")
        await adapter.before_model(ctx, None)
        await adapter.after_model(ctx, "done")
        assert sched.metrics.agent_cost("support") == 3.0


# ---------------------------------------------------------------------------
# CrewAI adapter
# ---------------------------------------------------------------------------

class TestCrewAIAdapter:

    @pytest.mark.asyncio
    async def test_before_step_acquires(self):
        sched = _sched()
        adapter = CrewAIAdapter(sched)
        await adapter.before_step("researcher")
        assert sched.resource.is_holding("researcher")
        await adapter.after_step("researcher")

    @pytest.mark.asyncio
    async def test_after_step_releases(self):
        sched = _sched()
        adapter = CrewAIAdapter(sched)
        await adapter.before_step("researcher")
        await adapter.after_step("researcher")
        assert not sched.resource.is_holding("researcher")

    @pytest.mark.asyncio
    async def test_role_weight_mapping(self):
        sched = _sched()
        adapter = CrewAIAdapter(sched)
        await adapter.before_step("researcher")
        await adapter.after_step("researcher")
        assert sched.metrics.agent_cost("researcher") == 3.0

        await adapter.before_step("manager")
        await adapter.after_step("manager")
        assert sched.metrics.agent_cost("manager") == 1.0

    @pytest.mark.asyncio
    async def test_custom_role_weights(self):
        sched = _sched()
        adapter = CrewAIAdapter(sched, role_weights={"coder": 4.0})
        await adapter.before_step("coder")
        await adapter.after_step("coder")
        assert sched.metrics.agent_cost("coder") == 4.0

    @pytest.mark.asyncio
    async def test_run_crew_coarse(self):
        """Coarse scheduling: wrap crew.kickoff()."""
        sched = _sched()
        adapter = CrewAIAdapter(sched)

        class MockCrew:
            def kickoff(self, **kwargs):
                return "crew result"

        result = await adapter.run_crew(MockCrew(), crew_id="my-crew", weight=5.0)
        assert result == "crew result"
        assert sched.metrics.agent_cost("my-crew") == 5.0
        assert len(sched.get_agent("my-crew").completed_tasks) == 1

    @pytest.mark.asyncio
    async def test_concurrent_roles(self):
        """Two CrewAI roles compete for capacity=1."""
        sched = _sched(capacity=1)
        adapter = CrewAIAdapter(sched)

        await adapter.before_step("researcher")
        assert sched.resource.is_holding("researcher")

        acquired = asyncio.Event()

        async def writer_step():
            await adapter.before_step("writer")
            acquired.set()
            await adapter.after_step("writer")

        task = asyncio.create_task(writer_step())
        await asyncio.sleep(0.01)
        assert not acquired.is_set()

        await adapter.after_step("researcher")
        await asyncio.sleep(0.01)
        assert acquired.is_set()
        await task


# ---------------------------------------------------------------------------
# Cross-framework: all three adapters on one scheduler
# ---------------------------------------------------------------------------

class TestCrossFramework:

    @pytest.mark.asyncio
    async def test_mixed_fleet(self):
        """LangChain, ADK, and CrewAI agents share one scheduler."""
        sched = _sched(capacity=2)

        lc = LOCOCallbackHandler(sched, "lc-rag")
        adk = ADKAdapter(sched)
        crew = CrewAIAdapter(sched)

        # All three start work
        await lc.on_llm_start({"kwargs": {"model_name": "gpt-4o"}}, ["query"])
        await adk.before_model(MockADKContext(agent_name="adk-bot"), None)

        # CrewAI must wait (capacity=2, both slots taken)
        acquired = asyncio.Event()

        async def crew_work():
            await crew.before_step("analyst")
            acquired.set()
            await crew.after_step("analyst")

        task = asyncio.create_task(crew_work())
        await asyncio.sleep(0.01)
        assert not acquired.is_set()

        # Release one → CrewAI gets in
        await lc.on_llm_end("done")
        await asyncio.sleep(0.01)
        assert acquired.is_set()

        await adk.after_model(MockADKContext(agent_name="adk-bot"), "done")
        await task

        # All three served
        assert sched.metrics.total_cost() > 0
        assert "lc-rag" in sched.agents
        assert "adk-bot" in sched.agents
        assert "analyst" in sched.agents
