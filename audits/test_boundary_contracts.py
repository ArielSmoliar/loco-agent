"""Remaining tenant/resource-pool findings; lifecycle tests moved to tests/."""

import asyncio
from contextlib import asynccontextmanager

import pytest

from loco import Agent, SharedResource, Task
from loco.multi_resource import ResourcePool
from loco.tenant import MultiTenantScheduler, TenantCostExceededError


async def wait_until(predicate):
    async def poll():
        while not predicate():
            await asyncio.sleep(0)

    await asyncio.wait_for(poll(), 0.5)


@asynccontextmanager
async def contended_resource(kind, capacity):
    resource = SharedResource("local", capacity)
    if kind == "tenant":
        manager = MultiTenantScheduler(resource)
        for aid in ("holder", "waiter"):
            manager.register_tenant(aid)
            manager.register_agent(aid, Agent(aid))
            await manager.submit_task(aid, aid, Task())

        def acquire(aid):
            return manager.acquire(aid, aid)
    else:
        pool = ResourcePool()
        pool.add(resource)

        def acquire(aid):
            return pool.acquire_multiple(aid, ["local"])

    yield resource, acquire


@pytest.mark.parametrize("kind", ["tenant", "pool"])
@pytest.mark.parametrize("capacity", [1, 2])
async def test_release_eventually_runs_waiting_action(kind, capacity):
    effects = []
    async with contended_resource(kind, capacity) as (resource, acquire):

        async def worker():
            async with acquire("waiter"):
                effects.append("ran")

        async with acquire("holder"):
            waiter = asyncio.create_task(worker())
            await wait_until(lambda: resource.waiter_count == 1 or waiter.done())
        try:
            # The holder is gone. A free slot must eventually be granted.
            await asyncio.wait_for(asyncio.shield(waiter), 0.05)
        except TimeoutError:
            observed = (resource.holder_count, resource.waiter_count)
            waiter.cancel()
            await asyncio.gather(waiter, return_exceptions=True)
            pytest.fail(f"No progress after release: holders={observed[0]}, waiters={observed[1]}")
        assert effects == ["ran"]
        assert resource.holder_count == resource.waiter_count == 0


async def test_tenant_timeout_is_honored():
    resource = SharedResource("local", 1)
    mt = MultiTenantScheduler(resource)
    mt.register_tenant("tenant")
    for aid in ("holder", "waiter"):
        mt.register_agent("tenant", Agent(aid))
        await mt.submit_task("tenant", aid, Task())
    effects = []

    async def waiting():
        async with mt.acquire("tenant", "waiter", timeout=0.005):
            effects.append("ran")

    async with mt.acquire("tenant", "holder"):
        waiter = asyncio.create_task(waiting())
        try:
            # Outer watchdog is deliberately distinct from the API timeout.
            done, _ = await asyncio.wait([waiter], timeout=0.05)
            assert waiter in done, "Tenant timeout was ignored; caller still waiting"
            with pytest.raises(TimeoutError):
                await waiter
            assert effects == []
        finally:
            if not waiter.done():
                waiter.cancel()
            await asyncio.gather(waiter, return_exceptions=True)


@pytest.mark.parametrize("preloaded", [False, True])
async def test_tenant_ceiling_cannot_be_bypassed_by_preloaded_agent_queue(preloaded):
    mt = MultiTenantScheduler(SharedResource("local", 1))
    mt.register_tenant("tenant", cost_ceiling=1)
    task = Task(weight=2)
    mt.register_agent("tenant", Agent("a", tasks=[task] if preloaded else []))
    effects = []
    with pytest.raises(TenantCostExceededError):
        if not preloaded:
            await mt.submit_task("tenant", "a", task)
        async with mt.acquire("tenant", "a"):
            effects.append("over_budget")
    assert effects == []
    assert mt.tenant_cost("tenant") == 0
