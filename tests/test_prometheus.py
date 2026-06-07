"""Tests for Prometheus metrics exporter (v0.4)."""

import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler
from loco.resource import SharedResource
from loco.task import Task

# Skip entire module if prometheus_client is not installed
prometheus_client = pytest.importorskip("prometheus_client")

from prometheus_client import CollectorRegistry  # noqa: E402

from loco.exporters.prometheus import _HAS_PROMETHEUS, PrometheusExporter  # noqa: E402

# ---------------------------------------------------------------------------
# Fixture: fresh scheduler + exporter per test (isolated registry)
# ---------------------------------------------------------------------------


@pytest.fixture
def setup():
    """Create a scheduler and exporter with an isolated registry."""
    agents = [Agent(agent_id="a1"), Agent(agent_id="a2")]
    resource = SharedResource(name="llm_api", capacity=2)
    scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")
    registry = CollectorRegistry()
    exporter = PrometheusExporter(scheduler, registry=registry)
    return scheduler, exporter, registry


# ---------------------------------------------------------------------------
# Basic construction
# ---------------------------------------------------------------------------


class TestConstruction:

    def test_prometheus_available(self):
        assert _HAS_PROMETHEUS is True

    def test_exporter_creates_with_scheduler(self, setup):
        scheduler, exporter, _ = setup
        assert exporter._scheduler is scheduler

    def test_exporter_uses_custom_registry(self, setup):
        _, exporter, registry = setup
        assert exporter.registry is registry

    def test_exporter_hooks_on_task_completed(self, setup):
        scheduler, exporter, _ = setup
        # The exporter should have replaced the callback (compare underlying function)
        assert scheduler.on_task_completed.__func__ is PrometheusExporter._on_task_completed


# ---------------------------------------------------------------------------
# Gauge metrics (point-in-time state)
# ---------------------------------------------------------------------------


class TestGaugeMetrics:

    @pytest.mark.asyncio
    async def test_queue_depth_gauge_updates(self, setup):
        scheduler, exporter, _ = setup
        await scheduler.submit_task("a1", Task(weight=3.0))
        await scheduler.submit_task("a1", Task(weight=2.0))
        await scheduler.submit_task("a2", Task(weight=5.0))

        exporter.collector.update_gauges()

        a1_depth = exporter.collector.queue_depth.labels(agent_id="a1")._value.get()
        a2_depth = exporter.collector.queue_depth.labels(agent_id="a2")._value.get()
        assert a1_depth == 5.0
        assert a2_depth == 5.0

    @pytest.mark.asyncio
    async def test_resource_utilization_gauge(self, setup):
        scheduler, exporter, _ = setup
        await scheduler.submit_task("a1", Task(weight=1.0))

        exporter.collector.update_gauges()
        assert exporter.collector.resource_utilization._value.get() == 0.0

        async with scheduler.acquire("a1"):
            exporter.collector.update_gauges()
            # capacity=2, 1 holder -> 0.5
            assert exporter.collector.resource_utilization._value.get() == 0.5

    @pytest.mark.asyncio
    async def test_alpha_gauge(self, setup):
        scheduler, exporter, _ = setup
        exporter.collector.update_gauges()
        assert exporter.collector.alpha._value.get() == 0.25  # "balanced"

    @pytest.mark.asyncio
    async def test_logical_tick_gauge(self, setup):
        scheduler, exporter, _ = setup
        assert scheduler.logical_tick == 0

        # Do a full acquire/release to increment tick
        await scheduler.submit_task("a1", Task(weight=1.0))
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        exporter.collector.update_gauges()
        assert exporter.collector.logical_tick._value.get() >= 1


# ---------------------------------------------------------------------------
# Counter metrics (monotonic, event-driven)
# ---------------------------------------------------------------------------


class TestCounterMetrics:

    @pytest.mark.asyncio
    async def test_tasks_completed_counter(self, setup):
        scheduler, exporter, _ = setup

        await scheduler.submit_task("a1", Task(weight=1.0))
        await scheduler.submit_task("a1", Task(weight=2.0))

        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        count = exporter.collector.tasks_completed.labels(agent_id="a1")._value.get()
        assert count == 2.0

    @pytest.mark.asyncio
    async def test_cost_total_counter(self, setup):
        scheduler, exporter, _ = setup

        await scheduler.submit_task("a1", Task(weight=3.0))
        await scheduler.submit_task("a2", Task(weight=5.0))

        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()
        async with scheduler.acquire("a2"):
            scheduler.get_agent("a2").serve_oldest_task()

        a1_cost = exporter.collector.cost_total.labels(agent_id="a1")._value.get()
        a2_cost = exporter.collector.cost_total.labels(agent_id="a2")._value.get()
        assert a1_cost == 3.0
        assert a2_cost == 5.0

    def test_policy_violation_counter(self, setup):
        _, exporter, _ = setup

        exporter.record_policy_violation("a1", "BudgetPolicy")
        exporter.record_policy_violation("a1", "BudgetPolicy")
        exporter.record_policy_violation("a2", "RatePolicy")

        a1_budget = exporter.collector.policy_violations.labels(
            agent_id="a1", policy="BudgetPolicy"
        )._value.get()
        a2_rate = exporter.collector.policy_violations.labels(
            agent_id="a2", policy="RatePolicy"
        )._value.get()
        assert a1_budget == 2.0
        assert a2_rate == 1.0


# ---------------------------------------------------------------------------
# Histogram metrics (distribution)
# ---------------------------------------------------------------------------


class TestHistogramMetrics:

    @pytest.mark.asyncio
    async def test_wait_time_histogram(self, setup):
        scheduler, exporter, _ = setup

        await scheduler.submit_task("a1", Task(weight=1.0))
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        # Should have observed at least one value
        sample = exporter.collector.wait_time.labels(agent_id="a1")
        assert sample._sum.get() >= 0  # age starts at 0

    @pytest.mark.asyncio
    async def test_task_cost_histogram(self, setup):
        scheduler, exporter, _ = setup

        await scheduler.submit_task("a1", Task(weight=7.0))
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        sample = exporter.collector.task_cost.labels(agent_id="a1")
        assert sample._sum.get() == 7.0


# ---------------------------------------------------------------------------
# Snapshot API
# ---------------------------------------------------------------------------


class TestSnapshot:

    @pytest.mark.asyncio
    async def test_snapshot_returns_dict(self, setup):
        scheduler, exporter, _ = setup

        await scheduler.submit_task("a1", Task(weight=2.0))
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        snap = exporter.snapshot()
        assert "resource_utilization" in snap
        assert "alpha" in snap
        assert "logical_tick" in snap
        assert "cost_by_agent" in snap
        assert snap["cost_by_agent"]["a1"] == 2.0

    @pytest.mark.asyncio
    async def test_snapshot_reflects_current_state(self, setup):
        scheduler, exporter, _ = setup

        snap1 = exporter.snapshot()
        assert snap1["logical_tick"] == 0

        await scheduler.submit_task("a1", Task(weight=1.0))
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        snap2 = exporter.snapshot()
        assert snap2["logical_tick"] >= 1


# ---------------------------------------------------------------------------
# Lifecycle hooks chaining
# ---------------------------------------------------------------------------


class TestHookChaining:

    @pytest.mark.asyncio
    async def test_original_hook_still_called(self):
        """Exporter chains to the original on_task_completed callback."""
        called_with = []

        def my_hook(agent_id, task, result):
            called_with.append((agent_id, task.weight))

        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(
            agents, resource, optimize_for="balanced",
            on_task_completed=my_hook,
        )
        registry = CollectorRegistry()
        PrometheusExporter(scheduler, registry=registry)  # hooks into scheduler

        await scheduler.submit_task("a1", Task(weight=4.0))
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        assert len(called_with) == 1
        assert called_with[0] == ("a1", 4.0)

    @pytest.mark.asyncio
    async def test_stop_restores_original_hook(self):
        """Stopping the exporter restores the original callback."""
        def my_hook(agent_id, task, result):
            pass

        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(
            agents, resource, optimize_for="balanced",
            on_task_completed=my_hook,
        )
        registry = CollectorRegistry()
        exporter = PrometheusExporter(scheduler, registry=registry)

        assert scheduler.on_task_completed.__func__ is PrometheusExporter._on_task_completed
        exporter.stop()
        assert scheduler.on_task_completed is my_hook


# ---------------------------------------------------------------------------
# Multi-agent full lifecycle
# ---------------------------------------------------------------------------


class TestFullLifecycle:

    @pytest.mark.asyncio
    async def test_multi_agent_lifecycle(self):
        """Full lifecycle with multiple agents produces correct metrics."""
        agents = [Agent(agent_id=f"agent_{i}") for i in range(5)]
        resource = SharedResource(name="llm_api", capacity=2)
        scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")
        registry = CollectorRegistry()
        exporter = PrometheusExporter(scheduler, registry=registry)

        # Submit 3 tasks per agent
        for agent in agents:
            for w in [1.0, 2.0, 3.0]:
                await scheduler.submit_task(agent.agent_id, Task(weight=w))

        # Process all tasks
        for agent in agents:
            for _ in range(3):
                async with scheduler.acquire(agent.agent_id):
                    scheduler.get_agent(agent.agent_id).serve_oldest_task()

        snap = exporter.snapshot()

        # Each agent should have cost 6.0 (1+2+3)
        for agent in agents:
            assert snap["cost_by_agent"][agent.agent_id] == 6.0
            count = exporter.collector.tasks_completed.labels(
                agent_id=agent.agent_id
            )._value.get()
            assert count == 3.0

        # All queues should be empty
        for depth in snap["queue_depth_by_agent"].values():
            assert depth == 0.0

        # Resource should be idle
        assert snap["resource_utilization"] == 0.0
