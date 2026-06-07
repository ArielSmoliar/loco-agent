"""Tests for cost attribution (v0.4)."""

import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler
from loco.cost_attribution import CostAttribution
from loco.resource import SharedResource
from loco.task import Task

# ---------------------------------------------------------------------------
# Unit tests: CostAttribution standalone
# ---------------------------------------------------------------------------


class TestCostAttributionStandalone:

    def test_empty_attribution(self):
        attr = CostAttribution()
        assert attr.total_cost() == 0.0
        assert attr.cost_by_team() == {}
        assert attr.cost_by_workflow() == {}
        assert attr.cost_by_model() == {}

    def test_single_record(self):
        attr = CostAttribution()
        task = Task(weight=3.0, team="marketing", workflow="report", model="claude-opus-4")
        attr.record("agent-1", task)

        assert attr.total_cost() == 3.0
        assert attr.cost_by_team() == {"marketing": 3.0}
        assert attr.cost_by_workflow() == {"report": 3.0}
        assert attr.cost_by_model() == {"claude-opus-4": 3.0}
        assert attr.cost_by_agent() == {"agent-1": 3.0}

    def test_multiple_teams(self):
        attr = CostAttribution()
        attr.record("a1", Task(weight=5.0, team="marketing", model="opus"))
        attr.record("a2", Task(weight=3.0, team="engineering", model="sonnet"))
        attr.record("a3", Task(weight=2.0, team="marketing", model="sonnet"))

        teams = attr.cost_by_team()
        assert teams["marketing"] == 7.0
        assert teams["engineering"] == 3.0

    def test_multiple_models(self):
        attr = CostAttribution()
        attr.record("a1", Task(weight=10.0, model="claude-opus-4"))
        attr.record("a1", Task(weight=2.0, model="claude-sonnet-4"))
        attr.record("a2", Task(weight=1.0, model="claude-haiku-4"))

        models = attr.cost_by_model()
        assert models["claude-opus-4"] == 10.0
        assert models["claude-sonnet-4"] == 2.0
        assert models["claude-haiku-4"] == 1.0

    def test_multiple_workflows(self):
        attr = CostAttribution()
        attr.record("a1", Task(weight=5.0, workflow="weekly-report"))
        attr.record("a1", Task(weight=3.0, workflow="etl-pipeline"))
        attr.record("a2", Task(weight=4.0, workflow="weekly-report"))

        workflows = attr.cost_by_workflow()
        assert workflows["weekly-report"] == 9.0
        assert workflows["etl-pipeline"] == 3.0

    def test_unattributed_tasks(self):
        """Tasks without team/workflow/model get grouped as __unattributed__."""
        attr = CostAttribution()
        attr.record("a1", Task(weight=5.0))  # no attribution fields

        teams = attr.cost_by_team()
        assert teams["__unattributed__"] == 5.0

    def test_mixed_attributed_and_unattributed(self):
        attr = CostAttribution()
        attr.record("a1", Task(weight=5.0, team="eng"))
        attr.record("a2", Task(weight=3.0))  # no team

        teams = attr.cost_by_team()
        assert teams["eng"] == 5.0
        assert teams["__unattributed__"] == 3.0

    def test_team_breakdown(self):
        attr = CostAttribution()
        attr.record("a1", Task(weight=5.0, team="eng", workflow="build", model="opus"))
        attr.record("a2", Task(weight=3.0, team="eng", workflow="test", model="sonnet"))
        attr.record("a1", Task(weight=2.0, team="eng", workflow="build", model="sonnet"))

        bd = attr.team_breakdown("eng")
        assert bd["total"] == 10.0
        assert bd["by_agent"] == {"a1": 7.0, "a2": 3.0}
        assert bd["by_workflow"] == {"build": 7.0, "test": 3.0}
        assert bd["by_model"] == {"opus": 5.0, "sonnet": 5.0}

    def test_team_breakdown_nonexistent(self):
        attr = CostAttribution()
        bd = attr.team_breakdown("nonexistent")
        assert bd["total"] == 0.0
        assert bd["by_agent"] == {}

    def test_workflow_breakdown(self):
        attr = CostAttribution()
        attr.record("a1", Task(weight=5.0, workflow="etl", model="opus"))
        attr.record("a2", Task(weight=3.0, workflow="etl", model="sonnet"))

        bd = attr.workflow_breakdown("etl")
        assert bd["total"] == 8.0
        assert bd["by_agent"] == {"a1": 5.0, "a2": 3.0}
        assert bd["by_model"] == {"opus": 5.0, "sonnet": 3.0}

    def test_model_breakdown(self):
        attr = CostAttribution()
        attr.record("a1", Task(weight=5.0, model="opus"))
        attr.record("a2", Task(weight=3.0, model="opus"))
        attr.record("a1", Task(weight=1.0, model="opus"))

        bd = attr.model_breakdown("opus")
        assert bd == {"a1": 6.0, "a2": 3.0}

    def test_summary(self):
        attr = CostAttribution()
        attr.record("a1", Task(weight=5.0, team="eng", workflow="build", model="opus"))
        attr.record("a2", Task(weight=3.0, team="mkt", workflow="report", model="sonnet"))

        s = attr.summary()
        assert s["total_cost"] == 8.0
        assert s["record_count"] == 2
        assert "eng" in s["by_team"]
        assert "build" in s["by_workflow"]

    def test_top_costs(self):
        attr = CostAttribution()
        attr.record("a1", Task(weight=10.0, team="eng"))
        attr.record("a2", Task(weight=5.0, team="mkt"))
        attr.record("a3", Task(weight=3.0, team="sales"))
        attr.record("a4", Task(weight=1.0, team="hr"))

        top = attr.top_costs("team", n=2)
        assert top[0] == ("eng", 10.0)
        assert top[1] == ("mkt", 5.0)
        assert len(top) == 2

    def test_top_costs_agents(self):
        attr = CostAttribution()
        attr.record("expensive", Task(weight=50.0))
        attr.record("cheap", Task(weight=2.0))
        attr.record("medium", Task(weight=10.0))

        top = attr.top_costs("agent", n=2)
        assert top[0] == ("expensive", 50.0)
        assert top[1] == ("medium", 10.0)


# ---------------------------------------------------------------------------
# Integration: CostAttribution through AsyncLOCOScheduler
# ---------------------------------------------------------------------------


class TestCostAttributionIntegration:

    @pytest.mark.asyncio
    async def test_attribution_records_through_scheduler(self):
        """Cost attribution is populated when tasks flow through the scheduler."""
        agents = [Agent(agent_id="a1"), Agent(agent_id="a2")]
        resource = SharedResource(name="llm", capacity=2)
        scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        t1 = Task(weight=5.0, team="eng", workflow="build", model="opus")
        t2 = Task(weight=3.0, team="mkt", workflow="report", model="sonnet")

        await scheduler.submit_task("a1", t1)
        await scheduler.submit_task("a2", t2)

        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()
        async with scheduler.acquire("a2"):
            scheduler.get_agent("a2").serve_oldest_task()

        attr = scheduler.metrics.attribution
        assert attr.cost_by_team() == {"eng": 5.0, "mkt": 3.0}
        assert attr.cost_by_model() == {"opus": 5.0, "sonnet": 3.0}
        assert attr.cost_by_workflow() == {"build": 5.0, "report": 3.0}

    @pytest.mark.asyncio
    async def test_attribution_with_split_api(self):
        """Cost attribution works through acquire_start/release_handle path."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        task = Task(weight=7.0, team="data", workflow="etl", model="opus")
        await scheduler.submit_task("a1", task)

        handle = await scheduler.acquire_start("a1")
        scheduler.get_agent("a1").serve_oldest_task()
        await scheduler.release_handle(handle)

        attr = scheduler.metrics.attribution
        assert attr.cost_by_team() == {"data": 7.0}

    @pytest.mark.asyncio
    async def test_attribution_accumulates(self):
        """Multiple tasks from same team/workflow accumulate correctly."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        for w in [1.0, 2.0, 3.0]:
            await scheduler.submit_task("a1", Task(weight=w, team="eng", model="sonnet"))

        for _ in range(3):
            async with scheduler.acquire("a1"):
                scheduler.get_agent("a1").serve_oldest_task()

        attr = scheduler.metrics.attribution
        assert attr.cost_by_team()["eng"] == 6.0
        assert attr.cost_by_model()["sonnet"] == 6.0

    @pytest.mark.asyncio
    async def test_attribution_unset_fields(self):
        """Tasks without attribution fields are grouped as __unattributed__."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        await scheduler.submit_task("a1", Task(weight=5.0))
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        attr = scheduler.metrics.attribution
        assert "__unattributed__" in attr.cost_by_team()


# ---------------------------------------------------------------------------
# Integration: CostAttribution + Prometheus exporter
# ---------------------------------------------------------------------------


prometheus_client = pytest.importorskip("prometheus_client")


class TestCostAttributionPrometheus:

    @pytest.mark.asyncio
    async def test_prometheus_attribution_counters(self):
        """Prometheus exporter records cost attribution labels."""
        from prometheus_client import CollectorRegistry

        from loco.exporters.prometheus import PrometheusExporter

        agents = [Agent(agent_id="a1"), Agent(agent_id="a2")]
        resource = SharedResource(name="llm", capacity=2)
        scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")
        registry = CollectorRegistry()
        exporter = PrometheusExporter(scheduler, registry=registry)

        await scheduler.submit_task(
            "a1", Task(weight=5.0, team="eng", workflow="build", model="opus")
        )
        await scheduler.submit_task(
            "a2", Task(weight=3.0, team="mkt", workflow="report", model="sonnet")
        )

        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()
        async with scheduler.acquire("a2"):
            scheduler.get_agent("a2").serve_oldest_task()

        # Check team counters
        eng_cost = exporter.collector.cost_by_team.labels(team="eng")._value.get()
        mkt_cost = exporter.collector.cost_by_team.labels(team="mkt")._value.get()
        assert eng_cost == 5.0
        assert mkt_cost == 3.0

        # Check model counters
        opus_cost = exporter.collector.cost_by_model.labels(model="opus")._value.get()
        sonnet_cost = exporter.collector.cost_by_model.labels(model="sonnet")._value.get()
        assert opus_cost == 5.0
        assert sonnet_cost == 3.0

        # Check workflow counters
        build_cost = exporter.collector.cost_by_workflow.labels(workflow="build")._value.get()
        assert build_cost == 5.0

        # Check fully attributed counter
        full = exporter.collector.cost_attributed.labels(
            agent_id="a1", team="eng", workflow="build", model="opus"
        )._value.get()
        assert full == 5.0

    @pytest.mark.asyncio
    async def test_prometheus_unattributed_tasks(self):
        """Tasks without attribution fields use __unattributed__ label."""
        from prometheus_client import CollectorRegistry

        from loco.exporters.prometheus import PrometheusExporter

        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")
        registry = CollectorRegistry()
        exporter = PrometheusExporter(scheduler, registry=registry)

        await scheduler.submit_task("a1", Task(weight=4.0))
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        unattr = exporter.collector.cost_by_team.labels(
            team="__unattributed__"
        )._value.get()
        assert unattr == 4.0
