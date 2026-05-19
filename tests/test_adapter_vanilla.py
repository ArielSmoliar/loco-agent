"""Tests for VanillaAdapter, dynamic registration, and split acquire/release (Day 8)."""

import asyncio

import pytest

from loco.adapters.vanilla import VanillaAdapter
from loco.agent import Agent
from loco.async_scheduler import AcquireHandle, AsyncLOCOScheduler
from loco.resource import SharedResource
from loco.task import Task


def _make_scheduler(n_agents: int = 0, capacity: int = 1) -> AsyncLOCOScheduler:
    agents = [Agent(agent_id=f"agent-{i}") for i in range(n_agents)]
    resource = SharedResource(name="test", capacity=capacity)
    return AsyncLOCOScheduler(agents, resource, optimize_for="balanced", seed=42)


# ---------------------------------------------------------------------------
# VanillaAdapter — lifecycle tests
# ---------------------------------------------------------------------------


class TestVanillaAdapter:

    @pytest.mark.asyncio
    async def test_register_agent(self):
        sched = _make_scheduler()
        adapter = VanillaAdapter(sched)
        agent = await adapter.register_agent("worker", lambda aid, t: None)
        assert agent.agent_id == "worker"
        assert "worker" in sched.agents

    @pytest.mark.asyncio
    async def test_register_duplicate_raises(self):
        sched = _make_scheduler()
        adapter = VanillaAdapter(sched)
        await adapter.register_agent("worker", lambda aid, t: None)
        with pytest.raises(ValueError, match="already registered"):
            await adapter.register_agent("worker", lambda aid, t: None)

    @pytest.mark.asyncio
    async def test_submit_task(self):
        sched = _make_scheduler()
        adapter = VanillaAdapter(sched)
        await adapter.register_agent("worker", lambda aid, t: None)
        await adapter.submit_task("worker", Task(weight=2.0))
        assert len(sched.get_agent("worker").tasks) == 1

    @pytest.mark.asyncio
    async def test_submit_to_unregistered_raises(self):
        sched = _make_scheduler()
        adapter = VanillaAdapter(sched)
        with pytest.raises(ValueError, match="not registered"):
            await adapter.submit_task("ghost", Task())

    @pytest.mark.asyncio
    async def test_run_next_calls_handler(self):
        sched = _make_scheduler()
        adapter = VanillaAdapter(sched)
        calls = []

        async def handler(agent_id, task):
            calls.append((agent_id, task.weight))
            return "done"

        await adapter.register_agent("worker", handler)
        await adapter.submit_task("worker", Task(weight=3.0))
        result = await adapter.run_next("worker")

        assert result == "done"
        assert calls == [("worker", 3.0)]
        assert len(sched.get_agent("worker").tasks) == 0
        assert len(sched.get_agent("worker").completed_tasks) == 1

    @pytest.mark.asyncio
    async def test_run_next_no_tasks_raises(self):
        sched = _make_scheduler()
        adapter = VanillaAdapter(sched)
        await adapter.register_agent("worker", lambda aid, t: None)
        with pytest.raises(RuntimeError, match="no tasks"):
            await adapter.run_next("worker")

    @pytest.mark.asyncio
    async def test_run_all(self):
        sched = _make_scheduler()
        adapter = VanillaAdapter(sched)

        async def handler(agent_id, task):
            return task.weight * 10

        await adapter.register_agent("worker", handler)
        for w in [1.0, 2.0, 3.0]:
            await adapter.submit_task("worker", Task(weight=w))

        results = await adapter.run_all("worker")
        assert results == [10.0, 20.0, 30.0]
        assert len(sched.get_agent("worker").tasks) == 0

    @pytest.mark.asyncio
    async def test_multiple_agents_contention(self):
        """Two agents compete for capacity=1. Both complete all tasks."""
        sched = _make_scheduler(capacity=1)
        adapter = VanillaAdapter(sched)
        served = []

        async def handler(agent_id, task):
            served.append(agent_id)
            await asyncio.sleep(0)  # yield for contention
            return agent_id

        await adapter.register_agent("fast", handler)
        await adapter.register_agent("slow", handler)
        for _ in range(3):
            await adapter.submit_task("fast", Task(weight=1.0))
            await adapter.submit_task("slow", Task(weight=2.0))

        results = await asyncio.gather(
            adapter.run_all("fast"),
            adapter.run_all("slow"),
        )
        assert len(results[0]) == 3
        assert len(results[1]) == 3


# ---------------------------------------------------------------------------
# Dynamic agent registration
# ---------------------------------------------------------------------------


class TestDynamicRegistration:

    @pytest.mark.asyncio
    async def test_register_agent_at_runtime(self):
        sched = _make_scheduler(n_agents=1)
        new_agent = Agent(agent_id="newcomer")
        sched.register_agent(new_agent)
        assert "newcomer" in sched.agents

    @pytest.mark.asyncio
    async def test_register_duplicate_raises(self):
        sched = _make_scheduler(n_agents=1)
        with pytest.raises(ValueError, match="already registered"):
            sched.register_agent(Agent(agent_id="agent-0"))

    @pytest.mark.asyncio
    async def test_auto_register_on_submit(self):
        """submit_task auto-registers unknown agents."""
        sched = _make_scheduler(n_agents=0)
        await sched.submit_task("auto-agent", Task(weight=1.0))
        assert "auto-agent" in sched.agents
        assert len(sched.get_agent("auto-agent").tasks) == 1

    @pytest.mark.asyncio
    async def test_auto_register_multiple_submits(self):
        """Multiple submits to same auto-registered agent accumulate tasks."""
        sched = _make_scheduler(n_agents=0)
        await sched.submit_task("auto", Task(weight=1.0))
        await sched.submit_task("auto", Task(weight=2.0))
        assert len(sched.get_agent("auto").tasks) == 2

    @pytest.mark.asyncio
    async def test_unregister_agent(self):
        sched = _make_scheduler(n_agents=2)
        removed = sched.unregister_agent("agent-0")
        assert removed.agent_id == "agent-0"
        assert "agent-0" not in sched.agents

    @pytest.mark.asyncio
    async def test_unregister_unknown_raises(self):
        sched = _make_scheduler(n_agents=1)
        with pytest.raises(ValueError, match="Unknown agent"):
            sched.unregister_agent("ghost")

    @pytest.mark.asyncio
    async def test_unregister_holding_raises(self):
        """Cannot unregister an agent that's holding the resource."""
        sched = _make_scheduler(n_agents=1, capacity=1)
        await sched.submit_task("agent-0", Task(weight=1.0))

        async with sched.acquire("agent-0"):
            with pytest.raises(RuntimeError, match="currently holding"):
                sched.unregister_agent("agent-0")

    @pytest.mark.asyncio
    async def test_auto_registered_agent_participates_in_scoring(self):
        """Auto-registered agents are scored alongside pre-registered agents."""
        sched = _make_scheduler(n_agents=1, capacity=1)
        await sched.submit_task("agent-0", Task(weight=1.0))
        await sched.submit_task("newcomer", Task(weight=5.0))

        # newcomer has higher Qi — should be scored
        scores = sched._scorer.compute_load_scores()
        assert "newcomer" in scores


# ---------------------------------------------------------------------------
# Split acquire/release
# ---------------------------------------------------------------------------


class TestSplitAcquireRelease:

    @pytest.mark.asyncio
    async def test_acquire_start_returns_handle(self):
        sched = _make_scheduler(n_agents=1, capacity=1)
        await sched.submit_task("agent-0", Task(weight=1.0))
        handle = await sched.acquire_start("agent-0")
        assert isinstance(handle, AcquireHandle)
        assert handle.agent_id == "agent-0"
        assert not handle._released
        await sched.release_handle(handle)

    @pytest.mark.asyncio
    async def test_release_handle_frees_resource(self):
        sched = _make_scheduler(n_agents=1, capacity=1)
        await sched.submit_task("agent-0", Task(weight=1.0))
        handle = await sched.acquire_start("agent-0")
        assert sched.resource.is_holding("agent-0")
        await sched.release_handle(handle)
        assert not sched.resource.is_holding("agent-0")

    @pytest.mark.asyncio
    async def test_double_release_is_noop(self):
        sched = _make_scheduler(n_agents=1, capacity=1)
        await sched.submit_task("agent-0", Task(weight=1.0))
        handle = await sched.acquire_start("agent-0")
        await sched.release_handle(handle)
        await sched.release_handle(handle)  # should not raise
        assert handle._released

    @pytest.mark.asyncio
    async def test_split_lifecycle_hook_fires(self):
        events = []
        sched = _make_scheduler(n_agents=1, capacity=1)
        sched.on_task_started = lambda aid, t: events.append(("start", aid))
        sched.on_task_completed = lambda aid, t, r: events.append(("end", aid))

        await sched.submit_task("agent-0", Task(weight=1.0))
        handle = await sched.acquire_start("agent-0")
        assert events == [("start", "agent-0")]
        await sched.release_handle(handle)
        assert events == [("start", "agent-0"), ("end", "agent-0")]

    @pytest.mark.asyncio
    async def test_split_contention(self):
        """Two agents using split API compete for capacity=1."""
        sched = _make_scheduler(n_agents=2, capacity=1)
        await sched.submit_task("agent-0", Task(weight=1.0))
        await sched.submit_task("agent-1", Task(weight=3.0))

        # agent-0 acquires first (gets the slot)
        h0 = await sched.acquire_start("agent-0")
        assert sched.resource.is_holding("agent-0")

        # agent-1 must wait — start in background
        acquired = asyncio.Event()

        async def wait_for_1():
            h1 = await sched.acquire_start("agent-1")
            acquired.set()
            return h1

        task = asyncio.create_task(wait_for_1())
        await asyncio.sleep(0.01)
        assert not acquired.is_set()

        # Release agent-0 — agent-1 should get granted
        await sched.release_handle(h0)
        await asyncio.sleep(0.01)
        assert acquired.is_set()

        h1 = await task
        await sched.release_handle(h1)

    @pytest.mark.asyncio
    async def test_split_with_timeout(self):
        """acquire_start with timeout raises TimeoutError."""
        sched = _make_scheduler(n_agents=2, capacity=1)
        await sched.submit_task("agent-0", Task(weight=1.0))
        await sched.submit_task("agent-1", Task(weight=1.0))

        h0 = await sched.acquire_start("agent-0")
        with pytest.raises(TimeoutError):
            await sched.acquire_start("agent-1", timeout=0.05)
        await sched.release_handle(h0)

    @pytest.mark.asyncio
    async def test_callback_pattern_simulation(self):
        """Simulate the before_model / after_model callback pattern.

        This is the pattern ADK, LangChain, and CrewAI adapters will use.
        """
        sched = _make_scheduler(n_agents=0, capacity=1)
        results = []

        # Simulate: before_model callback
        async def before_model(agent_name: str, model: str):
            model_cost = {"opus": 5.0, "haiku": 1.0}
            weight = model_cost.get(model, 1.0)
            await sched.submit_task(agent_name, Task(weight=weight))
            handle = await sched.acquire_start(agent_name)
            return handle

        # Simulate: LLM call
        async def llm_call(prompt: str) -> str:
            await asyncio.sleep(0)
            return f"response to: {prompt}"

        # Simulate: after_model callback
        async def after_model(handle: AcquireHandle, response: str):
            agent = sched.get_agent(handle.agent_id)
            agent.serve_oldest_task()
            results.append(response)
            await sched.release_handle(handle)

        # Run the pattern
        h = await before_model("support-bot", "opus")
        response = await llm_call("Hello")
        await after_model(h, response)

        assert results == ["response to: Hello"]
        assert "support-bot" in sched.agents  # auto-registered
        assert len(sched.get_agent("support-bot").completed_tasks) == 1
