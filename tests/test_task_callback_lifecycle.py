"""Desired-behavior tests: failures expose unhandled public-API boundaries.

No providers or framework packages are used. Adapter tests exercise LOCO's own
callbacks with local inputs, not an end-to-end LangChain/ADK/CrewAI integration.
"""

import asyncio
from types import SimpleNamespace

import pytest

import loco
from loco import Agent, AsyncLOCOScheduler, BudgetExceededError, BudgetManager, SharedResource, Task
from loco.adapters.crewai import CrewAIAdapter
from loco.adapters.google_adk import ADKAdapter
from loco.adapters.langchain import LOCOCallbackHandler


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
            await adapter.before_step("a", invocation_id=str(number))

        async def end(number):
            await adapter.after_step("a", invocation_id=str(number))

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
    assert observed == (0, 0, 2), {
        "holders": observed[0],
        "reserved": observed[1],
        "settled": observed[2],
    }


class CallbackHarness:
    def __init__(self, kind, scheduler):
        self.kind = kind
        self.scheduler = scheduler
        if kind == "langchain":
            self.adapter = LOCOCallbackHandler(scheduler, "a")
        elif kind == "adk":
            self.adapter = ADKAdapter(scheduler)
        else:
            self.adapter = CrewAIAdapter(scheduler, role_weights={"a": 1})

    def context(self, key):
        return SimpleNamespace(agent_name="a", model="gemini-2.0-flash", invocation_id=key)

    async def start(self, key):
        if self.kind == "langchain":
            await self.adapter.on_llm_start(
                {"kwargs": {"model": "gpt-4o-mini"}}, ["hi"], run_id=key
            )
        elif self.kind == "adk":
            await self.adapter.before_model(callback_context=self.context(key), llm_request={})
        else:
            await self.adapter.before_step("a", invocation_id=key)

    async def end(self, key, error=None):
        if self.kind == "langchain":
            if error is not None:
                await self.adapter.on_llm_error(error, run_id=key)
            else:
                await self.adapter.on_llm_end({}, run_id=key)
        elif self.kind == "adk":
            if error is not None:
                await self.adapter.on_model_error(
                    callback_context=self.context(key), llm_request={}, error=error
                )
            else:
                await self.adapter.after_model(callback_context=self.context(key), llm_response={})
        else:
            if error is not None:
                await self.adapter.on_step_error("a", error, invocation_id=key)
            else:
                await self.adapter.after_step("a", invocation_id=key)


@pytest.fixture(params=["langchain", "adk", "crewai"])
def callback(request):
    budget = BudgetManager(default_limit=10)
    scheduler = AsyncLOCOScheduler([], SharedResource("local", 2), budget=budget)
    return CallbackHarness(request.param, scheduler)


async def test_callback_error_and_duplicate_end_preserve_other_invocation(callback):
    s = callback.scheduler
    await callback.start("first")
    first = s.get_agent("a").tasks[0]
    await callback.start("second")
    second = s.get_agent("a").tasks[1]
    await callback.end("second", error=RuntimeError("provider failed"))
    assert s.get_agent("a").tasks == [first]
    assert s.get_agent("a").completed_tasks == [second]
    assert s.budget.reserved("a") == 1
    await callback.end("second")  # duplicate cannot consume first's handle
    await callback.end("unknown")
    assert s.resource.holder_count == 1
    await callback.end("first")
    assert s.resource.holder_count == 0
    assert s.budget.reserved("a") == 0
    assert s.budget.spent("a") == 2
    assert s.get_agent("a").completed_tasks == [second, first]


async def test_callback_missing_id_does_not_release_identified_call(callback):
    await callback.start("first")
    try:
        with pytest.raises(ValueError, match="invocation ID"):
            await callback.end(None)
        assert callback.scheduler.resource.holder_count == 1
    finally:
        await callback.end("first")


@pytest.mark.parametrize("first, second", [(None, None), (None, "id"), ("id", None), ("id", "id")])
async def test_callback_ambiguous_or_duplicate_start_rejected_before_enqueue(
    callback, first, second
):
    s = callback.scheduler
    await callback.start(first)
    original = list(s.get_agent("a").tasks)
    try:
        with pytest.raises(RuntimeError, match="invocation ID"):
            await asyncio.wait_for(callback.start(second), 1)
        assert s.get_agent("a").tasks == original
        assert s.resource.holder_count == 1
        assert s.budget.reserved("a") == 1
    finally:
        await callback.end(first)
    assert s.get_agent("a").tasks == []


async def test_callback_rejected_admission_does_not_leave_task_or_release_other_call(callback):
    s = callback.scheduler
    s.budget.set_limit("a", 1)
    await callback.start("first")
    original = list(s.get_agent("a").tasks)
    try:
        with pytest.raises(BudgetExceededError):
            await callback.start("second")
        await callback.end("second", error=RuntimeError("denied"))
        assert s.get_agent("a").tasks == original
        assert s.resource.holder_count == 1
    finally:
        await callback.end("first")
    assert s.budget.spent("a") == 1
    assert s.budget.reserved("a") == 0


@pytest.mark.parametrize("cancel_via_error_callback", [False, True])
async def test_callback_pending_start_cancellation_cleans_exact_task(
    callback, cancel_via_error_callback
):
    s = callback.scheduler
    s.resource.capacity = 1
    await callback.start("holder")
    original = list(s.get_agent("a").tasks)
    waiting = asyncio.create_task(callback.start("waiting"))
    try:
        await wait_until(lambda: s.resource.waiter_count == 1)
        with pytest.raises(RuntimeError, match="already active"):
            await asyncio.wait_for(callback.start("waiting"), 1)
        if cancel_via_error_callback:
            await asyncio.wait_for(callback.end("waiting", error=asyncio.CancelledError()), 1)
        else:
            waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        assert s.get_agent("a").tasks == original
        assert s.resource.waiter_count == 0
        assert s.resource.holder_count == 1
        assert s.budget.reserved("a") == 1
    finally:
        waiting.cancel()
        await asyncio.gather(waiting, return_exceptions=True)
        await callback.end("holder")
    assert s.budget.spent("a") == 1


async def test_callback_cancelled_completion_still_settles_and_releases(callback):
    s = callback.scheduler
    await callback.start("first")
    await s.resource._lock.acquire()  # force release to suspend after settlement
    closing = asyncio.create_task(callback.end("first"))
    try:
        await wait_until(lambda: s.budget.reserved("a") == 0)
        closing.cancel()
        await asyncio.sleep(0)
        closing.cancel()
    finally:
        s.resource._lock.release()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(closing, 1)
    assert s.get_agent("a").tasks == []
    assert s.resource.holder_count == 0
    assert s.budget.spent("a") == 1
    await callback.end("first")
    assert s.budget.spent("a") == 1


async def test_callback_concurrent_duplicate_completions_settle_once(callback):
    s = callback.scheduler
    await callback.start("first")
    await asyncio.gather(callback.end("first"), callback.end("first"))
    assert s.resource.holder_count == 0
    assert s.budget.spent("a") == 1
    assert s.budget.reserved("a") == 0
    assert len(s.get_agent("a").completed_tasks) == 1


async def test_explicit_task_acquisition_cannot_borrow_another_task():
    from loco import AccessPolicy, PolicyEnforcer, PolicyViolationError

    policy = AccessPolicy({"a": {"labels": ["public"]}})
    s = AsyncLOCOScheduler(
        [Agent("a")], SharedResource("local", 2), enforcer=PolicyEnforcer([policy])
    )
    public = Task(labels={"input": "public"})
    confidential = Task(labels={"input": "confidential"})
    await s.submit_task("a", public)
    await s.submit_task("a", confidential)
    with pytest.raises(PolicyViolationError):
        await s.acquire_start("a", task=confidential)
    async with s.acquire("a", task=public):
        with pytest.raises(ValueError, match="already has"):
            await s.acquire_start("a", task=public)
    with pytest.raises(ValueError, match="not queued"):
        await s.acquire_start("a", task=Task())
    assert s.resource.holder_count == 0


def test_exact_task_removal_does_not_remove_equal_task():
    first, second = Task(task_id="same"), Task(task_id="same")
    assert first == second and first is not second
    agent = Agent("a", tasks=[first, second])
    assert agent.remove_task(second, completed=True) is second
    assert len(agent.tasks) == 1 and agent.tasks[0] is first
    assert agent.completed_tasks[0] is second
    assert agent.remove_task(second, completed=True) is None
    assert len(agent.completed_tasks) == 1


async def test_coarse_crew_failure_cleans_submitted_task():
    budget = BudgetManager(default_limit=10)
    s = AsyncLOCOScheduler([], SharedResource("local"), budget=budget)
    adapter = CrewAIAdapter(s)

    class BrokenCrew:
        def kickoff(self):
            raise RuntimeError("provider failed")

    with pytest.raises(RuntimeError, match="provider failed"):
        await adapter.run_crew(BrokenCrew(), crew_id="a", weight=2)
    assert s.get_agent("a").tasks == []
    assert s.resource.holder_count == 0
    assert budget.spent("a") == 2
