"""Desired-behavior tests: failures expose unhandled public-API boundaries.

No providers or framework packages are used. Adapter tests exercise LOCO's own
callbacks with local inputs, not an end-to-end LangChain/ADK/CrewAI integration.
"""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

import loco
from loco import Agent, AsyncLOCOScheduler, BudgetExceededError, BudgetManager, SharedResource, Task
from loco.adapters.crewai import CrewAIAdapter
from loco.adapters.google_adk import ADKAdapter
from loco.adapters.langchain import LOCOCallbackHandler
from loco.multi_resource import ResourcePool
from loco.tenant import MultiTenantScheduler, TenantCostExceededError


async def wait_until(predicate):
    async def poll():
        while not predicate():
            await asyncio.sleep(0)

    await asyncio.wait_for(poll(), 0.5)


async def invoke(api, fn, *, aid="a", weight=1):
    if api == "wrap":
        return await loco.wrap(fn, agent_id=aid, weight=weight)
    return await loco.scheduled(agent_id=aid, weight=weight)(fn)()


@pytest.fixture(autouse=True)
def reset_singleton():
    loco.reset()
    yield
    loco.reset()


@pytest.mark.parametrize("api", ["wrap", "scheduled"])
@pytest.mark.parametrize("prior_rejection", [False, True])
async def test_rejected_wrapper_does_not_poison_next_admission(api, prior_rejection):
    s = loco.configure(capacity=2, budget_mode="reject", auto_tune=False)
    loco.set_budget("a", 2)
    effects = []

    async def action():
        effects.append("ran")

    if prior_rejection:
        with pytest.raises(BudgetExceededError):
            await invoke(api, action, weight=3)
        assert effects == []
    # Cheap work fits even if an earlier expensive request was rejected.
    await invoke(api, action, weight=1)
    assert effects == ["ran"]
    assert s.budget.spent("a") == 1
    assert s.get_agent("a").tasks == []


@pytest.mark.parametrize("api", ["wrap", "scheduled"])
@pytest.mark.parametrize("overlap", [False, True])
async def test_out_of_order_completion_does_not_change_later_task_price(api, overlap):
    s = loco.configure(capacity=2, budget_mode="reject", auto_tune=False)
    loco.set_budget("a", 100)
    entered, release = asyncio.Event(), asyncio.Event()
    effects = []

    async def slow():
        effects.append(2)
        entered.set()
        await release.wait()

    async def medium():
        effects.append(5)

    async def cheap():
        effects.append(1)

    first = asyncio.create_task(invoke(api, slow, weight=2))
    try:
        await asyncio.wait_for(entered.wait(), 0.5)
        if not overlap:
            release.set()
            await first
        await invoke(api, medium, weight=5)
        await invoke(api, cheap, weight=1)
    finally:
        release.set()
        await first
    assert effects == [2, 5, 1]
    assert s.budget.spent("a") == sum(effects), {
        "submitted_weights": effects,
        "recorded_spend": s.budget.spent("a"),
    }
    assert s.resource.holder_count == 0


@pytest.mark.parametrize("api", ["wrap", "scheduled"])
async def test_cancelled_waiting_wrapper_removes_only_its_own_task(api):
    s = loco.configure(capacity=1, budget_mode="reject", auto_tune=False)
    loco.set_budget("a", 100)
    entered, release = asyncio.Event(), asyncio.Event()
    effects = []

    async def holder():
        entered.set()
        await release.wait()

    async def forbidden():
        effects.append("cancelled")

    first = asyncio.create_task(invoke(api, holder, weight=2))
    second = None
    try:
        await asyncio.wait_for(entered.wait(), 0.5)
        second = asyncio.create_task(invoke(api, forbidden, weight=5))
        await wait_until(lambda: s.resource.waiter_count == 1)
        second.cancel()
        with pytest.raises(asyncio.CancelledError):
            await second
    finally:
        release.set()
        await first
        if second and not second.done():
            second.cancel()
            await asyncio.gather(second, return_exceptions=True)
    assert effects == []
    assert s.resource.holder_count == 0
    assert s.get_agent("a").tasks == [], "Cancelled request remains queued"


def callbacks(kind, s):
    if kind == "langchain":
        adapter = LOCOCallbackHandler(s, "a")

        async def start(number):
            await adapter.on_llm_start(
                {"kwargs": {"model": "gpt-4o-mini"}}, ["hi"], run_id=str(number)
            )

        async def end(number):
            await adapter.on_llm_end({}, run_id=str(number))
    elif kind == "adk":
        adapter = ADKAdapter(s)
        contexts = [
            SimpleNamespace(agent_name="a", model="gemini-2.0-flash", invocation_id=str(i))
            for i in range(2)
        ]

        async def start(number):
            await adapter.before_model(contexts[number], {})

        async def end(number):
            await adapter.after_model(contexts[number], {})
    else:
        adapter = CrewAIAdapter(s, role_weights={"a": 1})

        async def start(number):
            await adapter.before_step("a")

        async def end(number):
            await adapter.after_step("a")

    return start, end


@pytest.mark.parametrize("kind", ["langchain", "adk", "crewai"])
@pytest.mark.parametrize("overlap", [False, True])
async def test_callback_overlap_does_not_lose_handles(kind, overlap):
    budget = BudgetManager(default_limit=10)
    s = AsyncLOCOScheduler([], SharedResource("local", 2), budget=budget)
    start, end = callbacks(kind, s)
    await start(0)
    if not overlap:
        await end(0)
    await start(1)
    await end(1)
    if overlap:
        await end(0)
    observed = (s.resource.holder_count, budget.reserved("a"), budget.spent("a"))
    # Cleanup only after taking the observation; lost handles aren't exposed by
    # the adapters, so use scheduler internals solely to leave the test isolated.
    for handle in list(s._active_handles.values()):
        await s.release_handle(handle)
    assert observed == (0, 0, 2), {
        "holders": observed[0],
        "reserved": observed[1],
        "settled": observed[2],
    }


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
