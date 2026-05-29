"""Tests for session-level cost tracking."""

import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler
from loco.resource import SharedResource
from loco.task import Task


class TestTaskSessionId:
    def test_default_none(self):
        task = Task(task_id="t1")
        assert task.session_id is None

    def test_with_session(self):
        task = Task(task_id="t1", session_id="session-abc")
        assert task.session_id == "session-abc"


class TestSessionCostMetrics:
    async def test_cost_by_session(self):
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource)

        await scheduler.submit_task("a", Task(weight=2.0, session_id="s1"))
        async with scheduler.acquire("a"):
            scheduler.get_agent("a").serve_oldest_task()

        await scheduler.submit_task("a", Task(weight=3.0, session_id="s1"))
        async with scheduler.acquire("a"):
            scheduler.get_agent("a").serve_oldest_task()

        assert scheduler.metrics.session_cost("s1") == 5.0
        assert scheduler.metrics.cost_by_session() == {"s1": 5.0}

    async def test_multiple_sessions(self):
        agents = [Agent(agent_id="a"), Agent(agent_id="b")]
        resource = SharedResource("r", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource)

        await scheduler.submit_task("a", Task(weight=2.0, session_id="s1"))
        async with scheduler.acquire("a"):
            scheduler.get_agent("a").serve_oldest_task()

        await scheduler.submit_task("b", Task(weight=5.0, session_id="s2"))
        async with scheduler.acquire("b"):
            scheduler.get_agent("b").serve_oldest_task()

        assert scheduler.metrics.session_cost("s1") == 2.0
        assert scheduler.metrics.session_cost("s2") == 5.0
        assert scheduler.metrics.cost_by_session() == {"s1": 2.0, "s2": 5.0}

    async def test_session_and_agent_breakdown(self):
        agents = [Agent(agent_id="a"), Agent(agent_id="b")]
        resource = SharedResource("r", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource)

        await scheduler.submit_task("a", Task(weight=2.0, session_id="s1"))
        async with scheduler.acquire("a"):
            scheduler.get_agent("a").serve_oldest_task()

        await scheduler.submit_task("b", Task(weight=3.0, session_id="s1"))
        async with scheduler.acquire("b"):
            scheduler.get_agent("b").serve_oldest_task()

        breakdown = scheduler.metrics.cost_by_session_and_agent("s1")
        assert breakdown == {"a": 2.0, "b": 3.0}

    async def test_no_session_not_tracked(self):
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource)

        await scheduler.submit_task("a", Task(weight=2.0))  # no session_id
        async with scheduler.acquire("a"):
            scheduler.get_agent("a").serve_oldest_task()

        assert scheduler.metrics.cost_by_session() == {}
        assert scheduler.metrics.session_cost("anything") == 0.0

    async def test_mixed_session_and_no_session(self):
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource)

        await scheduler.submit_task("a", Task(weight=1.0, session_id="s1"))
        async with scheduler.acquire("a"):
            scheduler.get_agent("a").serve_oldest_task()

        await scheduler.submit_task("a", Task(weight=2.0))  # no session
        async with scheduler.acquire("a"):
            scheduler.get_agent("a").serve_oldest_task()

        await scheduler.submit_task("a", Task(weight=3.0, session_id="s1"))
        async with scheduler.acquire("a"):
            scheduler.get_agent("a").serve_oldest_task()

        # Session s1 has 1.0 + 3.0 = 4.0
        assert scheduler.metrics.session_cost("s1") == 4.0
        # Total agent cost includes all tasks
        assert scheduler.metrics.agent_cost("a") == 6.0

    async def test_sessions_list(self):
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource)

        await scheduler.submit_task("a", Task(weight=1.0, session_id="s1"))
        async with scheduler.acquire("a"):
            scheduler.get_agent("a").serve_oldest_task()

        await scheduler.submit_task("a", Task(weight=1.0, session_id="s2"))
        async with scheduler.acquire("a"):
            scheduler.get_agent("a").serve_oldest_task()

        assert sorted(scheduler.metrics.sessions()) == ["s1", "s2"]

    async def test_unknown_session_returns_zero(self):
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource)

        assert scheduler.metrics.session_cost("nonexistent") == 0.0
        assert scheduler.metrics.cost_by_session_and_agent("nonexistent") == {}

    async def test_split_acquire_tracks_session(self):
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource)

        await scheduler.submit_task("a", Task(weight=4.0, session_id="s1"))
        handle = await scheduler.acquire_start("a")
        scheduler.get_agent("a").serve_oldest_task()
        await scheduler.release_handle(handle)

        assert scheduler.metrics.session_cost("s1") == 4.0
