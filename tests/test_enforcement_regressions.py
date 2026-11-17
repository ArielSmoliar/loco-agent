"""Behavioral regressions for the privately reported 0.4.0 enforcement issues."""

import asyncio
from contextlib import asynccontextmanager

import pytest

import loco
from loco import (
    AccessPolicy,
    Agent,
    AsyncLOCOScheduler,
    BudgetExceededError,
    BudgetManager,
    Policy,
    PolicyEnforcer,
    PolicyViolationError,
    SharedResource,
    Task,
)


@asynccontextmanager
async def acquired(scheduler, api, agent_id="a"):
    if api == "context":
        async with scheduler.acquire(agent_id):
            yield
    else:
        handle = await scheduler.acquire_start(agent_id)
        try:
            yield
        finally:
            await scheduler.release_handle(handle)


def make_scheduler(capacity=2, policies=(), budget=None):
    return AsyncLOCOScheduler(
        [Agent("a"), Agent("holder")], SharedResource("local", capacity),
        enforcer=PolicyEnforcer(list(policies)), budget=budget,
    )


async def wait_until(predicate):
    async def poll():
        while not predicate():
            await asyncio.sleep(0)
    await asyncio.wait_for(poll(), 2)


@pytest.mark.parametrize("api", ["context", "split"])
async def test_concurrent_acquisition_checks_its_own_task_label(api):
    s = make_scheduler(policies=[AccessPolicy({"a": {"labels": ["public"]}})])
    await s.submit_task("a", Task(task_id="public", labels={"input": "public"}))
    effects = []
    async with acquired(s, api):
        effects.append("public")
        await s.submit_task("a", Task(task_id="secret", labels={"input": "confidential"}))
        with pytest.raises(PolicyViolationError):
            async with acquired(s, api):
                effects.append("confidential")
        assert s.resource.holder_count == 1
    assert effects == ["public"]
    assert s.resource.holder_count == 0


@pytest.mark.parametrize("api", ["context", "split"])
async def test_concurrent_acquisition_reserves_inflight_budget(api):
    budget = BudgetManager(default_limit=1)
    s = make_scheduler(budget=budget)
    effects = []
    await s.submit_task("a", Task(weight=1))
    async with acquired(s, api):
        effects.append("first")
        await s.submit_task("a", Task(weight=1))
        with pytest.raises(BudgetExceededError):
            async with acquired(s, api):
                effects.append("second")
        assert budget.spent("a") == 0  # first action has not completed
        assert budget.remaining("a") == 0  # but its commitment counts
    assert effects == ["first"]
    assert budget.spent("a") == 1
    assert s.resource.holder_count == 0


async def test_wrap_reserves_budget_before_calling_second_action():
    loco.reset()
    s = loco.configure(capacity=2, budget_mode="reject", auto_tune=False)
    loco.set_budget("a", 1)
    entered, release = asyncio.Event(), asyncio.Event()
    effects = []

    async def first_action():
        effects.append("first")
        entered.set()
        await release.wait()

    async def second_action():
        effects.append("second")

    first = asyncio.create_task(loco.wrap(first_action, agent_id="a"))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        with pytest.raises(BudgetExceededError):
            await loco.wrap(second_action, agent_id="a")
    finally:
        release.set()
        await first
        loco.reset()
    assert effects == ["first"]
    assert s.budget.spent("a") == 1
    assert s.resource.holder_count == 0


@pytest.mark.parametrize("api", ["context", "split"])
@pytest.mark.parametrize("waiter_count", [1, 2])
async def test_shutdown_cancels_every_waiter_without_running_actions(api, waiter_count):
    s = make_scheduler(capacity=1)
    await s.submit_task("holder", Task())
    effects = []

    async def waiting_action():
        await s.submit_task("a", Task())
        async with acquired(s, api):
            effects.append("waiter")

    async with acquired(s, api, "holder"):
        waiters = [asyncio.create_task(waiting_action()) for _ in range(waiter_count)]
        try:
            await wait_until(lambda: s.resource.waiter_count == waiter_count)
            report = await s.shutdown(timeout=0.001)
            await wait_until(lambda: all(t.done() for t in waiters))
            results = await asyncio.gather(*waiters, return_exceptions=True)
            assert all(isinstance(r, asyncio.CancelledError) for r in results)
            assert effects == []
            assert report == {"cancelled_waiters": waiter_count, "active_holders": 1}
            assert s.resource.holder_count == 1
            assert s.resource.waiter_count == 0
        finally:
            for task in waiters:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*waiters, return_exceptions=True)
    assert s.resource.holder_count == 0


class ReturnPolicy(Policy):
    name = "custom"

    def __init__(self, result):
        self.result = result
        self.checks = self.records = 0

    def check(self, agent_id, task):
        self.checks += 1
        return self.result

    def record(self, agent_id, task):
        self.records += 1


@pytest.mark.parametrize("api", ["context", "split"])
async def test_false_policy_denies_and_rolls_back_budget(api):
    budget = BudgetManager(default_limit=1)
    deny, later = ReturnPolicy(False), ReturnPolicy(True)
    s = make_scheduler(policies=[budget, deny, later])
    await s.submit_task("a", Task())
    effects = []
    with pytest.raises(PolicyViolationError, match="custom"):
        async with acquired(s, api):
            effects.append("denied")
    assert effects == []
    assert deny.checks == 1 and deny.records == 0
    assert later.checks == later.records == 0
    assert budget.spent("a") == 0 and budget.remaining("a") == 1
    assert s.resource.holder_count == 0


def test_check_all_false_denial_short_circuits():
    deny, later = ReturnPolicy(False), ReturnPolicy(True)
    with pytest.raises(PolicyViolationError, match="custom"):
        PolicyEnforcer([deny, later]).check_all("a", Task())
    assert deny.checks == 1
    assert later.checks == 0


@pytest.mark.parametrize("result", [None, 0, 1, "allow"])
@pytest.mark.parametrize("api", ["context", "split"])
async def test_invalid_policy_result_fails_closed_without_leaking_slot(api, result):
    s = make_scheduler(policies=[ReturnPolicy(result)])
    await s.submit_task("a", Task())
    with pytest.raises(TypeError, match="bool"):
        async with acquired(s, api):
            pytest.fail("invalid policy response admitted work")
    assert s.resource.holder_count == 0


@pytest.mark.parametrize("mode", ["alert", "downgrade"])
@pytest.mark.parametrize("api", ["context", "split"])
async def test_advisory_budget_modes_still_allow_over_budget_work(api, mode):
    budget = BudgetManager(default_limit=0, on_exceeded=mode)
    s = make_scheduler(budget=budget)
    await s.submit_task("a", Task())
    effects = []
    async with acquired(s, api):
        effects.append("allowed")
    assert effects == ["allowed"]
    assert budget.spent("a") == 1
    assert len(budget.alerts) == 1


@pytest.mark.parametrize("mode", ["alert", "downgrade"])
def test_advisory_budget_returns_allow_and_records_warning(mode):
    budget = BudgetManager(default_limit=0, on_exceeded=mode)
    assert budget.check("a", Task()) is True
    assert len(budget.alerts) == 1
    assert PolicyEnforcer([budget]).check_all("a", Task()) == ["budget"]
    assert len(budget.alerts) == 2


@pytest.mark.parametrize("api", ["context", "split"])
@pytest.mark.parametrize("change_policy", [False, True])
async def test_waiters_recheck_current_policy_before_execution(api, change_policy):
    enforcer = PolicyEnforcer([AccessPolicy({"a": {"labels": ["confidential"]}})])
    s = AsyncLOCOScheduler(
        [Agent("a"), Agent("holder")], SharedResource("local", 1), enforcer=enforcer,
    )
    await s.submit_task("holder", Task())
    effects = []

    async def waiting_action():
        await s.submit_task("a", Task(labels={"input": "confidential"}))
        async with acquired(s, api):
            effects.append("confidential")

    async with acquired(s, api, "holder"):
        waiter = asyncio.create_task(waiting_action())
        await wait_until(lambda: s.resource.waiter_count == 1)
        assert effects == []
        if change_policy:
            enforcer.remove_policy("access")
            enforcer.add_policy(AccessPolicy({"a": {"labels": ["public"]}}))
    if change_policy:
        with pytest.raises(PolicyViolationError):
            await asyncio.wait_for(waiter, 2)
        assert effects == []
    else:
        await asyncio.wait_for(waiter, 2)
        assert effects == ["confidential"]
    assert s.resource.holder_count == 0
