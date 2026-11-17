"""Tenant and resource-pool admission/liveness regression tests."""

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


def tenant_scheduler(capacity=2, limit=10, tasks=()):
    mt = MultiTenantScheduler(SharedResource("local", capacity))
    mt.register_tenant("t", cost_ceiling=limit)
    agent = Agent("a", tasks=list(tasks))
    mt.register_agent("t", agent)
    return mt, agent


async def test_tenant_preloaded_concurrent_tasks_charge_distinct_weights_once():
    first, second = Task(weight=2), Task(weight=3)
    mt, agent = tenant_scheduler(limit=5, tasks=[first, second])
    async with mt.acquire("t", "a", task=first):
        async with mt.acquire("t", "a", task=second):
            assert mt.tenant_cost("t") == 5  # includes both running actions
        assert agent.tasks == [first]
        assert agent.completed_tasks == [second]
    assert agent.tasks == []
    assert agent.completed_tasks == [second, first]
    assert mt.tenant_cost("t") == 5
    assert mt.tenant_stats("t")["tasks_completed"] == 2


async def test_tenant_inflight_cost_blocks_second_preloaded_call():
    mt, agent = tenant_scheduler(limit=1, tasks=[Task(), Task()])
    effects = []
    async with mt.acquire("t", "a"):
        effects.append("first")
        with pytest.raises(TenantCostExceededError):
            async with mt.acquire("t", "a"):
                effects.append("second")
        assert mt.resource.holder_count == 1
    assert effects == ["first"]
    assert mt.tenant_cost("t") == 1
    assert len(agent.tasks) == 1  # rejected task is still available for caller disposition
    assert mt.resource.holder_count == 0


async def test_tenant_submission_does_not_count_active_task_twice():
    mt, agent = tenant_scheduler(limit=2, tasks=[Task()])
    async with mt.acquire("t", "a"):
        await mt.submit_task("t", "a", Task())
        async with mt.acquire("t", "a"):
            assert mt.tenant_cost("t") == 2
    assert agent.tasks == []


async def test_tenant_requires_unclaimed_task_and_rejects_foreign_binding():
    mt, agent = tenant_scheduler(tasks=[Task()])
    with pytest.raises(ValueError, match="queued"):
        async with mt.acquire("t", "a", task=Task()):
            pytest.fail("Unsubmitted task ran")
    async with mt.acquire("t", "a", task=agent.tasks[0]):
        with pytest.raises(ValueError, match="unclaimed"):
            async with mt.acquire("t", "a"):
                pytest.fail("Same task was admitted twice")
    with pytest.raises(ValueError, match="queued task"):
        async with mt.acquire("t", "a"):
            pytest.fail("Unpriced action ran")
    assert mt.tenant_cost("t") == 1


@pytest.mark.parametrize("cancel", [False, True])
async def test_tenant_failed_execution_is_accounted_and_releases(cancel):
    mt, agent = tenant_scheduler(tasks=[Task(weight=2)])
    error = asyncio.CancelledError if cancel else RuntimeError
    with pytest.raises(error):
        async with mt.acquire("t", "a"):
            raise error()
    assert mt.tenant_cost("t") == 2
    assert mt.tenant_stats("t")["tasks_completed"] == 1
    assert agent.tasks == []
    assert mt.resource.holder_count == 0


async def test_tenant_timeout_cleans_only_its_own_same_agent_waiter():
    mt, agent = tenant_scheduler(capacity=1, tasks=[Task(), Task(), Task()])
    first, timed_task, last = agent.tasks

    async def timed():
        async with mt.acquire("t", "a", task=timed_task, timeout=0.005):
            pytest.fail("Timed out action ran")

    effects = []

    async def next_call():
        async with mt.acquire("t", "a", task=last, timeout=0.5):
            effects.append("last")

    async with mt.acquire("t", "a", task=first):
        timed_waiter = asyncio.create_task(timed())
        good_waiter = asyncio.create_task(next_call())
        with pytest.raises(TimeoutError):
            await timed_waiter
        assert mt.resource.waiter_count == 1
        assert mt.tenant_cost("t") == 1
        with pytest.raises(RuntimeError, match="holding or waiting"):
            mt.unregister_tenant("t")
    await asyncio.wait_for(good_waiter, 1)
    assert effects == ["last"]
    assert mt.resource.waiter_count == mt.resource.holder_count == 0
    assert mt.tenant_cost("t") == 2
    assert agent.tasks == [timed_task]


async def test_tenant_cannot_unregister_queued_tenant():
    mt, _ = tenant_scheduler(capacity=1, tasks=[Task()])
    assert await mt.resource.try_acquire("external")

    async def queued():
        async with mt.acquire("t", "a"):
            pass

    waiter = asyncio.create_task(queued())
    try:
        await wait_until(lambda: mt.resource.waiter_count == 1)
        with pytest.raises(RuntimeError, match="waiting"):
            mt.unregister_tenant("t")
    finally:
        waiter.cancel()
        await asyncio.gather(waiter, return_exceptions=True)
        await mt.resource.release("external")
    mt.unregister_tenant("t")
    assert mt.tenant_ids == []


async def test_tenant_checks_price_at_grant_and_rejection_wakes_next_tenant():
    task = Task()
    mt, agent = tenant_scheduler(capacity=1, limit=1, tasks=[task])
    mt.register_tenant("other")
    mt.register_agent("other", Agent("b", tasks=[Task()]))
    assert await mt.resource.try_acquire("external")
    effects = []

    async def action(tid, aid):
        async with mt.acquire(tid, aid):
            effects.append(aid)

    denied = asyncio.create_task(action("t", "a"))
    await wait_until(lambda: mt.resource.waiter_count == 1)
    allowed = asyncio.create_task(action("other", "b"))
    await wait_until(lambda: mt.resource.waiter_count == 2)
    task.weight = 2  # public mutable task changed while waiting
    await mt.resource.release("external")
    with pytest.raises(TenantCostExceededError):
        await asyncio.wait_for(denied, 1)
    await asyncio.wait_for(allowed, 1)
    assert effects == ["b"]
    assert mt.tenant_cost("t") == 0
    assert mt.resource.holder_count == 0
    assert agent.tasks == [task]


async def test_fifo_zero_timeout_succeeds_only_if_immediately_available():
    resource = SharedResource("r", 1)
    async with resource.acquire_fifo("a", timeout=0):
        with pytest.raises(TimeoutError):
            async with resource.acquire_fifo("b", timeout=0):
                pytest.fail("Unavailable slot granted")
        assert resource.waiter_count == 0
    assert resource.holder_count == 0


async def test_fifo_waiters_keep_arrival_order_across_same_agent_ids():
    resource = SharedResource("r", 1)
    effects = []

    async def worker(number, aid):
        async with resource.acquire_fifo(aid):
            effects.append(number)

    async with resource.acquire_fifo("holder"):
        tasks = []
        for i, aid in enumerate(["a", "b", "a"]):
            tasks.append(asyncio.create_task(worker(i, aid)))
            await wait_until(lambda: resource.waiter_count == len(tasks))
    await asyncio.wait_for(asyncio.gather(*tasks), 1)
    assert effects == [0, 1, 2]
    assert resource.holder_count == resource.waiter_count == 0


async def test_fifo_cancellation_after_grant_returns_slot_to_next_waiter():
    resource = SharedResource("r", 1)
    assert await resource.try_acquire("holder")
    effects = []

    async def worker(number):
        async with resource.acquire_fifo("same"):
            effects.append(number)

    first = asyncio.create_task(worker(1))
    await wait_until(lambda: resource.waiter_count == 1)
    second = asyncio.create_task(worker(2))
    await wait_until(lambda: resource.waiter_count == 2)
    await resource.release("holder")  # sets first's event before first resumes
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    await asyncio.wait_for(second, 1)
    assert effects == [2]
    assert resource.waiter_count == resource.holder_count == 0


async def test_pool_partial_acquisition_cancellation_releases_prior_resources():
    pool = ResourcePool()
    a, b = SharedResource("a"), SharedResource("b")
    pool.add(a)
    pool.add(b)
    async with b.acquire_fifo("holder"):

        async def worker():
            async with pool.acquire_multiple("worker", ["b", "a"]):
                pytest.fail("Blocked second resource should prevent action")

        waiter = asyncio.create_task(worker())
        await wait_until(lambda: b.waiter_count == 1)
        assert a.holder_count == 1
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        assert a.holder_count == 0
        assert b.holder_count == 1 and b.waiter_count == 0
    assert a.holder_count == b.holder_count == 0


async def test_pool_opposite_resource_orders_complete_with_capacity_bound():
    pool = ResourcePool()
    for name in ("a", "b"):
        pool.add(SharedResource(name))
    effects = []
    entered, release = asyncio.Event(), asyncio.Event()

    async def first():
        async with pool.acquire_multiple("first", ["a", "b"]):
            entered.set()
            await release.wait()
            effects.append("first")

    async def second():
        async with pool.acquire_multiple("second", ["b", "a"]):
            assert all(pool.get(n).holder_count == 1 for n in pool.names)
            effects.append("second")

    task1 = asyncio.create_task(first())
    await entered.wait()
    task2 = asyncio.create_task(second())
    await wait_until(lambda: pool.get("a").waiter_count == 1)
    release.set()
    await asyncio.wait_for(asyncio.gather(task1, task2), 1)
    assert effects == ["first", "second"]
    assert pool.utilization() == {"a": 0, "b": 0}


@pytest.mark.parametrize("cancel", [False, True])
async def test_pool_execution_failure_releases_all_resources(cancel):
    pool = ResourcePool()
    for name in ("a", "b"):
        pool.add(SharedResource(name))
    error = asyncio.CancelledError if cancel else RuntimeError
    with pytest.raises(error):
        async with pool.acquire_multiple("a", ["b", "a", "a"]):
            raise error()
    assert pool.utilization() == {"a": 0, "b": 0}
    with pytest.raises(ValueError, match="Unknown"):
        async with pool.acquire_multiple("a", ["a", "missing"]):
            pass
    assert pool.get("a").holder_count == 0


async def test_pool_repeated_cancellation_cannot_interrupt_reverse_cleanup():
    pool = ResourcePool()
    a, b = SharedResource("a"), SharedResource("b")
    pool.add(a)
    pool.add(b)
    entered, done = asyncio.Event(), asyncio.Event()

    async def worker():
        async with pool.acquire_multiple("worker", ["a", "b"]):
            entered.set()
            await done.wait()

    task = asyncio.create_task(worker())
    await entered.wait()
    await b._lock.acquire()
    task.cancel()
    await asyncio.sleep(0)
    task.cancel()
    await asyncio.sleep(0)
    b._lock.release()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 1)
    assert a.holder_count == b.holder_count == 0


@pytest.mark.parametrize("fifo_first", [False, True])
async def test_fifo_and_scored_scheduler_release_wake_each_other(fifo_first):
    from loco import AsyncLOCOScheduler

    resource = SharedResource("r", 1)
    scheduler = AsyncLOCOScheduler([Agent("scored", tasks=[Task()])], resource)
    effects = []

    @asynccontextmanager
    async def enter(fifo):
        if fifo:
            async with resource.acquire_fifo("fifo"):
                yield
        else:
            async with scheduler.acquire("scored"):
                yield

    async def waiter():
        async with enter(not fifo_first):
            effects.append("ran")

    async with enter(fifo_first):
        waiting = asyncio.create_task(waiter())
        await wait_until(lambda: resource.waiter_count == 1)
    await asyncio.wait_for(waiting, 1)
    assert effects == ["ran"]
    assert resource.holder_count == resource.waiter_count == 0
