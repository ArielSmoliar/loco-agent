"""Tests for multi-tenant isolation (v0.4)."""

import pytest

from loco.agent import Agent
from loco.resource import SharedResource
from loco.task import Task
from loco.tenant import MultiTenantScheduler, TenantCostExceededError, TenantLimitError


@pytest.fixture
def mt():
    """Fresh multi-tenant scheduler."""
    resource = SharedResource(name="llm_api", capacity=4)
    return MultiTenantScheduler(resource=resource, optimize_for="balanced")


class TestTenantRegistration:

    def test_register_tenant(self, mt):
        mt.register_tenant("acme", max_agents=10, cost_ceiling=100.0)
        assert "acme" in mt.tenant_ids

    def test_register_duplicate_raises(self, mt):
        mt.register_tenant("acme")
        with pytest.raises(ValueError, match="already registered"):
            mt.register_tenant("acme")

    def test_unregister_tenant(self, mt):
        mt.register_tenant("acme")
        mt.unregister_tenant("acme")
        assert "acme" not in mt.tenant_ids

    def test_unregister_unknown_raises(self, mt):
        with pytest.raises(ValueError, match="Unknown tenant"):
            mt.unregister_tenant("nonexistent")


class TestAgentRegistration:

    def test_register_agent(self, mt):
        mt.register_tenant("acme")
        mt.register_agent("acme", Agent(agent_id="a1"))
        assert mt.agent_tenant("a1") == "acme"

    def test_register_agent_unknown_tenant(self, mt):
        with pytest.raises(ValueError, match="Unknown tenant"):
            mt.register_agent("nonexistent", Agent(agent_id="a1"))

    def test_register_agent_duplicate(self, mt):
        mt.register_tenant("acme")
        mt.register_agent("acme", Agent(agent_id="a1"))
        with pytest.raises(ValueError, match="already registered"):
            mt.register_agent("acme", Agent(agent_id="a1"))

    def test_register_agent_cross_tenant_duplicate(self, mt):
        mt.register_tenant("acme")
        mt.register_tenant("globex")
        mt.register_agent("acme", Agent(agent_id="a1"))
        with pytest.raises(ValueError, match="already registered under tenant acme"):
            mt.register_agent("globex", Agent(agent_id="a1"))

    def test_max_agents_enforced(self, mt):
        mt.register_tenant("acme", max_agents=2)
        mt.register_agent("acme", Agent(agent_id="a1"))
        mt.register_agent("acme", Agent(agent_id="a2"))
        with pytest.raises(TenantLimitError):
            mt.register_agent("acme", Agent(agent_id="a3"))


class TestTaskSubmission:

    @pytest.mark.asyncio
    async def test_submit_task(self, mt):
        mt.register_tenant("acme")
        mt.register_agent("acme", Agent(agent_id="a1"))
        await mt.submit_task("acme", "a1", Task(weight=3.0))

    @pytest.mark.asyncio
    async def test_submit_task_wrong_tenant(self, mt):
        mt.register_tenant("acme")
        mt.register_tenant("globex")
        mt.register_agent("acme", Agent(agent_id="a1"))
        with pytest.raises(ValueError, match="not registered under tenant"):
            await mt.submit_task("globex", "a1", Task(weight=1.0))

    @pytest.mark.asyncio
    async def test_cost_ceiling_enforced(self, mt):
        mt.register_tenant("acme", cost_ceiling=10.0)
        mt.register_agent("acme", Agent(agent_id="a1"))
        await mt.submit_task("acme", "a1", Task(weight=5.0))
        await mt.submit_task("acme", "a1", Task(weight=4.0))
        with pytest.raises(TenantCostExceededError):
            await mt.submit_task("acme", "a1", Task(weight=3.0))

    @pytest.mark.asyncio
    async def test_no_ceiling_allows_any_cost(self, mt):
        mt.register_tenant("acme")  # no cost ceiling
        mt.register_agent("acme", Agent(agent_id="a1"))
        await mt.submit_task("acme", "a1", Task(weight=1000.0))


class TestAcquireRelease:

    @pytest.mark.asyncio
    async def test_acquire_release_lifecycle(self, mt):
        mt.register_tenant("acme")
        mt.register_agent("acme", Agent(agent_id="a1"))
        await mt.submit_task("acme", "a1", Task(weight=5.0))

        async with mt.acquire("acme", "a1"):
            pass  # resource held

        assert mt.tenant_cost("acme") == 5.0

    @pytest.mark.asyncio
    async def test_multi_tenant_concurrent(self, mt):
        """Two tenants can hold the resource simultaneously."""
        mt.register_tenant("acme")
        mt.register_tenant("globex")
        mt.register_agent("acme", Agent(agent_id="acme_a1"))
        mt.register_agent("globex", Agent(agent_id="globex_a1"))

        await mt.submit_task("acme", "acme_a1", Task(weight=3.0))
        await mt.submit_task("globex", "globex_a1", Task(weight=2.0))

        # Both should be able to acquire (capacity=4)
        async with mt.acquire("acme", "acme_a1"):
            async with mt.acquire("globex", "globex_a1"):
                pass

        assert mt.tenant_cost("acme") == 3.0
        assert mt.tenant_cost("globex") == 2.0


class TestTenantStats:

    @pytest.mark.asyncio
    async def test_tenant_stats(self, mt):
        mt.register_tenant("acme", max_agents=20, cost_ceiling=500.0)
        mt.register_agent("acme", Agent(agent_id="a1"))
        await mt.submit_task("acme", "a1", Task(weight=10.0))

        async with mt.acquire("acme", "a1"):
            pass

        stats = mt.tenant_stats("acme")
        assert stats["tenant_id"] == "acme"
        assert stats["agent_count"] == 1
        assert stats["total_cost"] == 10.0
        assert stats["cost_ceiling"] == 500.0
        assert stats["cost_remaining"] == 490.0
        assert stats["tasks_completed"] == 1

    @pytest.mark.asyncio
    async def test_tenant_remaining_no_ceiling(self, mt):
        mt.register_tenant("acme")
        assert mt.tenant_remaining("acme") is None

    @pytest.mark.asyncio
    async def test_all_tenants(self, mt):
        mt.register_tenant("acme", cost_ceiling=100.0)
        mt.register_tenant("globex", cost_ceiling=200.0)
        all_stats = mt.all_tenants()
        assert "acme" in all_stats
        assert "globex" in all_stats
