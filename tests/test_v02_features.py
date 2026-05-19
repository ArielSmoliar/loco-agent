"""Tests for v0.2.2 features: adaptive alpha, AWS/Azure adapters,
multi-resource, budget ceilings, A2A protocol."""

import asyncio

import pytest

from loco.a2a import A2ASchedulerAgent
from loco.adapters.autogen import AutoGenAdapter
from loco.adapters.aws_bedrock import BedrockAdapter
from loco.adapters.aws_bedrock import estimate_weight as bedrock_weight
from loco.async_scheduler import AsyncLOCOScheduler
from loco.budget import BudgetExceededError, BudgetManager
from loco.multi_resource import ResourcePool
from loco.resource import SharedResource
from loco.task import Task


def _sched(capacity: int = 1, auto_tune: bool = False) -> AsyncLOCOScheduler:
    return AsyncLOCOScheduler(
        [], SharedResource(name="test", capacity=capacity),
        optimize_for="balanced", auto_tune=auto_tune,
    )


# ---------------------------------------------------------------------------
# Adaptive alpha tuning
# ---------------------------------------------------------------------------

class TestAdaptiveAlpha:

    @pytest.mark.asyncio
    async def test_auto_tune_enabled(self):
        sched = _sched(auto_tune=True)
        assert sched._tuner is not None

    @pytest.mark.asyncio
    async def test_auto_tune_disabled_by_default(self):
        sched = _sched()
        assert sched._tuner is None

    def test_tuner_initial_alpha(self):
        sched = _sched(auto_tune=True)
        assert sched._tuner.alpha == 0.25  # balanced default

    def test_cv_with_no_agents(self):
        sched = _sched(auto_tune=True)
        assert sched._tuner._wait_time_cv() == 0.0

    @pytest.mark.asyncio
    async def test_tuner_nudges_down_on_high_cv(self):
        """High wait-time variance → alpha decreases (toward fairness)."""
        sched = _sched(auto_tune=True)
        # Create agents with very different Dmax values
        await sched.submit_task("fast", Task(weight=1.0))
        await sched.submit_task("slow", Task(weight=1.0))
        # Artificially set divergent ages
        sched.get_agent("fast").tasks[0].age = 1
        sched.get_agent("slow").tasks[0].age = 100

        initial = sched.alpha
        sched._tuner.update()
        assert sched.alpha <= initial  # nudged down or unchanged

    @pytest.mark.asyncio
    async def test_tuner_stays_in_bounds(self):
        """Alpha never goes below min or above max."""
        sched = _sched(auto_tune=True)
        tuner = sched._tuner
        # Force many downward nudges
        for _ in range(100):
            tuner.scheduler._scorer.alpha = tuner.min_alpha
            tuner.update()
        assert sched.alpha >= tuner.min_alpha
        assert sched.alpha <= tuner.max_alpha

    def test_adjustments_logged(self):
        sched = _sched(auto_tune=True)
        tuner = sched._tuner
        # Before any adjustment
        assert len(tuner.adjustments) == 0


# ---------------------------------------------------------------------------
# AWS Bedrock adapter
# ---------------------------------------------------------------------------

class TestBedrockAdapter:

    @pytest.mark.asyncio
    async def test_invoke_without_client(self):
        sched = _sched()
        adapter = BedrockAdapter(sched)
        result = await adapter.invoke("auditor-1")
        assert result["agent_id"] == "auditor-1"
        assert result["status"] == "completed"
        assert "auditor-1" in sched.agents

    @pytest.mark.asyncio
    async def test_records_cost(self):
        sched = _sched()
        adapter = BedrockAdapter(sched)
        await adapter.invoke("agent-1", model_id="anthropic.claude-opus-4-20250514-v1:0")
        assert sched.metrics.agent_cost("agent-1") == 5.0

    @pytest.mark.asyncio
    async def test_dequeues_task(self):
        sched = _sched()
        adapter = BedrockAdapter(sched)
        await adapter.invoke("agent-1")
        assert len(sched.get_agent("agent-1").completed_tasks) == 1

    def test_weight_estimation(self):
        assert bedrock_weight("anthropic.claude-opus-4-20250514-v1:0") == 5.0
        assert bedrock_weight("anthropic.claude-haiku-4-5-20251001-v1:0") == 1.0
        assert bedrock_weight("unknown.model") == 2.0

    @pytest.mark.asyncio
    async def test_concurrent_bedrock_agents(self):
        sched = _sched(capacity=2)
        adapter = BedrockAdapter(sched)
        results = await asyncio.gather(
            adapter.invoke("aud-1"),
            adapter.invoke("aud-2"),
            adapter.invoke("aud-3"),
        )
        assert len(results) == 3


# ---------------------------------------------------------------------------
# AutoGen adapter
# ---------------------------------------------------------------------------

class TestAutoGenAdapter:

    @pytest.mark.asyncio
    async def test_send_message(self):
        sched = _sched()
        adapter = AutoGenAdapter(sched)
        result = await adapter.send_message("coordinator", "analyst", "analyze this")
        assert result["delivered"] is True
        assert result["recipient"] == "analyst"
        assert "analyst" in sched.agents

    @pytest.mark.asyncio
    async def test_records_cost(self):
        sched = _sched()
        adapter = AutoGenAdapter(sched, default_model="gpt-4o")
        await adapter.send_message("coord", "analyst", "x")
        assert sched.metrics.agent_cost("analyst") == 3.0

    @pytest.mark.asyncio
    async def test_publish_message(self):
        sched = _sched(capacity=3)
        adapter = AutoGenAdapter(sched)
        results = await adapter.publish_message(
            "coordinator", "updates",
            "new data available",
            subscribers=["analyst", "writer", "reviewer"],
        )
        assert len(results) == 3
        assert all(r["delivered"] for r in results)

    @pytest.mark.asyncio
    async def test_long_message_weight_scaling(self):
        sched = _sched()
        adapter = AutoGenAdapter(sched, default_model="gpt-4o")
        long_content = "x" * 20000  # 20k chars ≈ 5k tokens
        await adapter.send_message("coord", "analyst", long_content)
        # gpt-4o base=3.0, scaled by 20000/4000 = 5x → 15.0
        assert sched.metrics.agent_cost("analyst") == 15.0


# ---------------------------------------------------------------------------
# Multi-resource contention
# ---------------------------------------------------------------------------

class TestMultiResource:

    def test_add_and_get(self):
        pool = ResourcePool()
        pool.add(SharedResource("llm", capacity=3))
        pool.add(SharedResource("db", capacity=10))
        assert pool.get("llm").capacity == 3
        assert pool.get("db").capacity == 10

    def test_duplicate_raises(self):
        pool = ResourcePool()
        pool.add(SharedResource("llm", capacity=1))
        with pytest.raises(ValueError, match="already in pool"):
            pool.add(SharedResource("llm", capacity=2))

    def test_unknown_raises(self):
        pool = ResourcePool()
        with pytest.raises(ValueError, match="Unknown resource"):
            pool.get("nope")

    def test_primary(self):
        pool = ResourcePool()
        pool.add(SharedResource("llm", capacity=1))
        pool.add(SharedResource("db", capacity=5))
        assert pool.primary.name == "db"  # alphabetical: db < llm

    def test_names_sorted(self):
        pool = ResourcePool()
        pool.add(SharedResource("gpu", capacity=1))
        pool.add(SharedResource("api", capacity=5))
        pool.add(SharedResource("db", capacity=10))
        assert pool.names == ["api", "db", "gpu"]

    @pytest.mark.asyncio
    async def test_acquire_multiple(self):
        pool = ResourcePool()
        pool.add(SharedResource("llm", capacity=1))
        pool.add(SharedResource("db", capacity=1))

        async with pool.acquire_multiple("agent-1", ["llm", "db"]):
            assert pool.get("llm").is_holding("agent-1")
            assert pool.get("db").is_holding("agent-1")

        assert not pool.get("llm").is_holding("agent-1")
        assert not pool.get("db").is_holding("agent-1")

    @pytest.mark.asyncio
    async def test_acquire_releases_on_exception(self):
        pool = ResourcePool()
        pool.add(SharedResource("llm", capacity=1))
        pool.add(SharedResource("db", capacity=1))

        with pytest.raises(RuntimeError):
            async with pool.acquire_multiple("agent-1", ["llm", "db"]):
                raise RuntimeError("crash")

        assert not pool.get("llm").is_holding("agent-1")
        assert not pool.get("db").is_holding("agent-1")

    def test_utilization(self):
        pool = ResourcePool()
        pool.add(SharedResource("llm", capacity=2))
        pool.add(SharedResource("db", capacity=10))
        util = pool.utilization()
        assert util == {"db": 0.0, "llm": 0.0}


# ---------------------------------------------------------------------------
# Budget ceilings
# ---------------------------------------------------------------------------

class TestBudgetCeilings:

    def test_set_and_check_within_limit(self):
        budget = BudgetManager()
        budget.set_limit("agent-1", max_cost=100.0)
        assert budget.check("agent-1", task_cost=50.0) is True

    def test_check_exceeds_limit_rejects(self):
        budget = BudgetManager()
        budget.set_limit("agent-1", max_cost=10.0)
        budget.record_spend("agent-1", 8.0)
        with pytest.raises(BudgetExceededError):
            budget.check("agent-1", task_cost=5.0)

    def test_check_no_limit_allows(self):
        budget = BudgetManager()
        assert budget.check("any-agent", task_cost=9999.0) is True

    def test_default_limit(self):
        budget = BudgetManager(default_limit=50.0)
        budget.record_spend("agent-1", 45.0)
        with pytest.raises(BudgetExceededError):
            budget.check("agent-1", task_cost=10.0)

    def test_alert_mode(self):
        budget = BudgetManager(on_exceeded="alert")
        budget.set_limit("agent-1", max_cost=10.0)
        budget.record_spend("agent-1", 8.0)
        result = budget.check("agent-1", task_cost=5.0)
        assert result is False  # over budget but allowed
        assert len(budget.alerts) == 1

    def test_remaining(self):
        budget = BudgetManager()
        budget.set_limit("agent-1", max_cost=100.0)
        budget.record_spend("agent-1", 30.0)
        assert budget.remaining("agent-1") == 70.0

    def test_remaining_no_limit(self):
        budget = BudgetManager()
        assert budget.remaining("agent-1") is None

    def test_reset(self):
        budget = BudgetManager()
        budget.record_spend("agent-1", 50.0)
        budget.reset("agent-1")
        assert budget.spent("agent-1") == 0.0

    def test_summary(self):
        budget = BudgetManager()
        budget.set_limit("a1", max_cost=100.0)
        budget.record_spend("a1", 30.0)
        budget.set_limit("a2", max_cost=50.0)
        summary = budget.summary()
        assert summary["a1"]["remaining"] == 70.0
        assert summary["a2"]["spent"] == 0.0

    def test_remove_limit(self):
        budget = BudgetManager()
        budget.set_limit("a1", max_cost=100.0)
        budget.remove_limit("a1")
        assert budget.get_limit("a1") is None


# ---------------------------------------------------------------------------
# A2A protocol
# ---------------------------------------------------------------------------

class TestA2AProtocol:

    def test_agent_card(self):
        sched = _sched()
        a2a = A2ASchedulerAgent(sched, name="loco", url="http://localhost:8080")
        card = a2a.agent_card()
        assert card["name"] == "loco"
        assert card["capabilities"]["scheduling"] is True
        assert len(card["skills"]) == 2

    @pytest.mark.asyncio
    async def test_handle_task(self):
        sched = _sched()
        a2a = A2ASchedulerAgent(sched)
        result = await a2a.handle_task({
            "agent_id": "external-agent",
            "weight": 3.0,
            "task_type": "analysis",
        })
        assert result["status"] == "accepted"
        assert result["agent_id"] == "external-agent"
        assert "external-agent" in sched.agents

    @pytest.mark.asyncio
    async def test_handle_task_missing_agent_id(self):
        sched = _sched()
        a2a = A2ASchedulerAgent(sched)
        result = await a2a.handle_task({"weight": 1.0})
        assert result["status"] == "error"

    def test_get_status(self):
        sched = _sched()
        a2a = A2ASchedulerAgent(sched)
        status = a2a.get_status()
        assert status["status"] == "running"
        assert status["agents"] == 0
        assert status["alpha"] == 0.25

    @pytest.mark.asyncio
    async def test_status_reflects_tasks(self):
        sched = _sched()
        a2a = A2ASchedulerAgent(sched)
        await a2a.handle_task({"agent_id": "a1", "weight": 5.0})
        await a2a.handle_task({"agent_id": "a2", "weight": 2.0})
        status = a2a.get_status()
        assert status["agents"] == 2
        assert status["total_pending_tasks"] == 2
