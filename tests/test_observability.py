"""Tests for observability (logging, metrics) and testing utilities (Day 9)."""

import json
import logging

import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler
from loco.resource import SharedResource
from loco.task import Task
from loco.testing import (
    SyncTestScheduler,
    mock_agent,
    mock_resource,
)

# ---------------------------------------------------------------------------
# Structured JSON logging
# ---------------------------------------------------------------------------


class TestStructuredLogging:

    @pytest.mark.asyncio
    async def test_logging_emits_json_on_grant(self, caplog):
        """Grant events are emitted as parseable JSON."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")
        await sched.submit_task("a1", Task(weight=2.0))

        with caplog.at_level(logging.INFO, logger="loco.scheduler"):
            async with sched.acquire("a1"):
                pass

        json_lines = [r.message for r in caplog.records if "grant" in r.message]
        assert len(json_lines) >= 1
        event = json.loads(json_lines[0])
        assert event["event"] == "grant"
        assert event["agent"] == "a1"
        assert event["task_cost"] == 2.0
        assert "score" in event
        assert "utilization" in event

    @pytest.mark.asyncio
    async def test_logging_emits_enqueue(self, caplog):
        """Enqueue events are emitted when tasks are submitted."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        with caplog.at_level(logging.INFO, logger="loco.scheduler"):
            await sched.submit_task("a1", Task(weight=3.0))

        json_lines = [r.message for r in caplog.records if "enqueue" in r.message]
        assert len(json_lines) == 1
        event = json.loads(json_lines[0])
        assert event["event"] == "enqueue"
        assert event["agent"] == "a1"
        assert event["task_cost"] == 3.0

    @pytest.mark.asyncio
    async def test_logging_emits_release(self, caplog):
        """Release events are emitted when resource is freed."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")
        await sched.submit_task("a1", Task(weight=1.0))

        with caplog.at_level(logging.INFO, logger="loco.scheduler"):
            async with sched.acquire("a1"):
                pass

        json_lines = [r.message for r in caplog.records if "release" in r.message]
        assert len(json_lines) >= 1
        event = json.loads(json_lines[0])
        assert event["event"] == "release"
        assert event["agent"] == "a1"

    @pytest.mark.asyncio
    async def test_logging_disabled_is_silent(self, caplog):
        """No log output when logger level is above INFO."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")
        await sched.submit_task("a1", Task(weight=1.0))

        with caplog.at_level(logging.CRITICAL, logger="loco.scheduler"):
            async with sched.acquire("a1"):
                pass

        assert len(caplog.records) == 0

    @pytest.mark.asyncio
    async def test_all_events_in_full_lifecycle(self, caplog):
        """A full lifecycle produces enqueue, grant, and release events."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        with caplog.at_level(logging.INFO, logger="loco.scheduler"):
            await sched.submit_task("a1", Task(weight=1.0))
            async with sched.acquire("a1"):
                pass

        event_types = set()
        for record in caplog.records:
            event = json.loads(record.message)
            event_types.add(event["event"])
        assert {"enqueue", "grant", "release"} <= event_types


# ---------------------------------------------------------------------------
# Metrics API
# ---------------------------------------------------------------------------


class TestMetrics:

    @pytest.mark.asyncio
    async def test_cost_by_agent(self):
        agents = [Agent(agent_id="a1"), Agent(agent_id="a2")]
        resource = SharedResource(name="llm", capacity=1)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        await sched.submit_task("a1", Task(weight=3.0))
        await sched.submit_task("a1", Task(weight=2.0))
        await sched.submit_task("a2", Task(weight=5.0))

        async with sched.acquire("a1"):
            sched.get_agent("a1").serve_oldest_task()
        async with sched.acquire("a2"):
            sched.get_agent("a2").serve_oldest_task()
        async with sched.acquire("a1"):
            sched.get_agent("a1").serve_oldest_task()

        costs = sched.metrics.cost_by_agent()
        assert costs["a1"] == 5.0  # 3.0 + 2.0
        assert costs["a2"] == 5.0

    @pytest.mark.asyncio
    async def test_total_cost(self):
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        await sched.submit_task("a1", Task(weight=3.0))
        await sched.submit_task("a1", Task(weight=7.0))

        async with sched.acquire("a1"):
            sched.get_agent("a1").serve_oldest_task()
        async with sched.acquire("a1"):
            sched.get_agent("a1").serve_oldest_task()

        assert sched.metrics.total_cost() == 10.0

    @pytest.mark.asyncio
    async def test_resource_utilization(self):
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=2)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        assert sched.metrics.resource_utilization() == 0.0
        await sched.submit_task("a1", Task(weight=1.0))
        async with sched.acquire("a1"):
            assert sched.metrics.resource_utilization() == 0.5

    @pytest.mark.asyncio
    async def test_wait_time_by_agent(self):
        agents = [Agent(agent_id="a1"), Agent(agent_id="a2")]
        resource = SharedResource(name="llm", capacity=1)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        # Only a1 has completed tasks
        await sched.submit_task("a1", Task(weight=1.0))
        async with sched.acquire("a1"):
            sched.get_agent("a1").serve_oldest_task()

        waits = sched.metrics.wait_time_by_agent()
        assert "a1" in waits
        assert "a2" not in waits  # no completed tasks

    @pytest.mark.asyncio
    async def test_queue_depth_by_agent(self):
        agents = [Agent(agent_id="a1"), Agent(agent_id="a2")]
        resource = SharedResource(name="llm", capacity=1)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        await sched.submit_task("a1", Task(weight=3.0))
        await sched.submit_task("a1", Task(weight=2.0))
        await sched.submit_task("a2", Task(weight=1.0))

        depths = sched.metrics.queue_depth_by_agent()
        assert depths["a1"] == 5.0
        assert depths["a2"] == 1.0

    @pytest.mark.asyncio
    async def test_split_api_records_cost(self):
        """Metrics track costs for split acquire/release path too."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        await sched.submit_task("a1", Task(weight=4.0))
        handle = await sched.acquire_start("a1")
        await sched.release_handle(handle)

        assert sched.metrics.agent_cost("a1") == 4.0


# ---------------------------------------------------------------------------
# Testing utilities
# ---------------------------------------------------------------------------


class TestMockFactories:

    def test_mock_resource(self):
        resource = mock_resource("gpu", capacity=4)
        assert resource.name == "gpu"
        assert resource.capacity == 4

    def test_mock_agent_empty(self):
        agent = mock_agent("worker")
        assert agent.agent_id == "worker"
        assert len(agent.tasks) == 0

    def test_mock_agent_with_tasks(self):
        agent = mock_agent("worker", pending_tasks=5, task_weight=3.0)
        assert len(agent.tasks) == 5
        assert agent.queue_depth_weighted == 15.0

    def test_mock_agent_custom_type(self):
        agent = mock_agent("wh", agent_type="webhook")
        assert agent.agent_type == "webhook"


class TestSyncTestScheduler:

    def test_step_returns_step_result(self):
        agents = [mock_agent("a", pending_tasks=3), mock_agent("b", pending_tasks=1)]
        sched = SyncTestScheduler(agents, alpha=0.5, seed=42)
        result = sched.step()
        assert result.selected_agent is not None
        assert result.served_task is not None

    def test_high_queue_wins_at_high_alpha(self):
        agents = [mock_agent("big", pending_tasks=10), mock_agent("small", pending_tasks=1)]
        sched = SyncTestScheduler(agents, alpha=0.5, seed=42)
        result = sched.step()
        assert result.selected_agent.agent_id == "big"

    def test_deterministic_with_seed(self):
        """Same seed produces same results."""
        def run_once():
            agents = [mock_agent("a", pending_tasks=5), mock_agent("b", pending_tasks=5)]
            sched = SyncTestScheduler(agents, alpha=0.25, seed=99)
            return [sched.step().selected_agent.agent_id for _ in range(5)]

        assert run_once() == run_once()

    def test_run_all_drains_tasks(self):
        agents = [mock_agent("a", pending_tasks=3), mock_agent("b", pending_tasks=2)]
        sched = SyncTestScheduler(agents, alpha=0.25, seed=42)
        result = sched.run_all()

        assert sched.total_tasks_remaining() == 0
        assert result.total_ticks == 5
        assert sum(result.service_counts.values()) == 5

    def test_run_all_service_counts(self):
        agents = [mock_agent("a", pending_tasks=4), mock_agent("b", pending_tasks=1)]
        sched = SyncTestScheduler(agents, alpha=0.25, seed=42)
        result = sched.run_all()
        assert result.service_counts["a"] == 4
        assert result.service_counts["b"] == 1

    def test_service_order(self):
        agents = [mock_agent("a", pending_tasks=3), mock_agent("b", pending_tasks=2)]
        sched = SyncTestScheduler(agents, alpha=0.25, seed=42)
        result = sched.run_all()
        assert len(result.service_order) == 5

    def test_jains_fairness(self):
        agents = [mock_agent("a", pending_tasks=5), mock_agent("b", pending_tasks=5)]
        sched = SyncTestScheduler(agents, alpha=0.0, seed=42)
        sched.run_all()
        fairness = sched.jains_fairness()
        assert fairness >= 0.8

    def test_add_tasks(self):
        agents = [mock_agent("a", pending_tasks=0)]
        sched = SyncTestScheduler(agents, alpha=0.25, seed=42)
        sched.add_tasks("a", [Task(weight=2.0), Task(weight=3.0)])
        assert sched.total_tasks_remaining() == 2

    def test_optimize_for_param(self):
        agents = [mock_agent("a", pending_tasks=1)]
        sched = SyncTestScheduler(agents, optimize_for="latency", seed=42)
        assert sched._scheduler.alpha == 0.0
