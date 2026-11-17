"""Atomic commitments, settlement, and cleanup on production acquire paths."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from loco import Agent, AsyncLOCOScheduler, SharedResource, Task
from loco.budget import BudgetExceededError, BudgetPolicy
from loco.policy import Policy, PolicyEnforcer, PolicyViolationError


def scheduler(limit=10, capacity=4, budget=None, **kwargs):
    budget = budget if budget is not None else BudgetPolicy(default_limit=limit)
    return AsyncLOCOScheduler(
        [Agent(agent_id="a")], SharedResource("r", capacity), budget=budget, **kwargs
    ), budget


async def enqueue(s, cost=5, task_id=None):
    task = Task(weight=cost, **({"task_id": task_id} if task_id else {}))
    await s.submit_task("a", task)
    return task


async def test_budget_subclass_receives_original_task_metadata():
    class LabelBudget(BudgetPolicy):
        def check(self, agent_id, task):
            if task.labels.get("input") != "public":
                return False
            return super().check(agent_id, task)

    budget = LabelBudget(default_limit=10)
    s, _ = scheduler(budget=budget)
    allowed = Task(weight=2, labels={"input": "public"})
    denied = Task(weight=3, labels={"input": "confidential"})
    await s.submit_task("a", allowed)
    await s.submit_task("a", denied)
    async with s.acquire("a", task=allowed):
        assert budget.reserved("a") == 2
        with pytest.raises(PolicyViolationError):
            await s.acquire_start("a", task=denied)
        assert budget.reserved("a") == 2
    assert budget.spent("a") == 2
    assert budget.reserved("a") == 0
    assert s.resource.holder_count == 0


def test_atomic_reserve_across_threads():
    budget = BudgetPolicy(default_limit=10)
    barrier = Barrier(8)

    def attempt(_):
        barrier.wait()
        try:
            return budget.reserve("a", 3)
        except BudgetExceededError:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        tokens = [r for r in pool.map(attempt, range(8)) if r is not None]
    assert len(tokens) == 3
    assert budget.reserved("a") == 9
    assert budget.spent("a") == 0
    assert budget.remaining("a") == 1
    for token in tokens:
        budget.settle(token, 2)
    assert budget.reserved("a") == 0
    assert budget.spent("a") == 6


def test_settle_cancel_foreign_token_and_reset():
    budget = BudgetPolicy(default_limit=10)
    token = budget.reserve("a", 7)
    with pytest.raises(RuntimeError):
        budget.reset("a")
    with pytest.raises(RuntimeError):
        budget.reset_all()
    with pytest.raises(ValueError):
        BudgetPolicy().settle(token)
    assert budget.cancel(token)
    assert not budget.cancel(token)
    assert not budget.settle(token)
    token = budget.reserve("a", 7)
    assert budget.settle(token, 4)
    assert not budget.settle(token, 9)
    assert budget.spent("a") == 4
    assert budget.remaining("a") == 6
    budget.reset_all()
    assert budget.spent("a") == 0


@pytest.mark.parametrize("cost", [-1, float("nan"), float("inf"), True, "3"])
def test_invalid_prices_cannot_erase_commitments(cost):
    budget = BudgetPolicy(default_limit=10)
    with pytest.raises(ValueError):
        budget.reserve("a", cost)
    token = budget.reserve("a", 5)
    with pytest.raises(ValueError):
        budget.settle(token, cost)
    assert budget.reserved("a") == 5
    assert budget.spent("a") == 0
    with pytest.raises(ValueError):
        budget.record_spend("a", cost)
    with pytest.raises(ValueError):
        budget.set_limit("a", cost)


@pytest.mark.parametrize("mode", ["alert", "downgrade"])
def test_nonreject_modes_remain_permissive_with_one_alert(mode):
    budget = BudgetPolicy(default_limit=1, on_exceeded=mode)
    token = budget.reserve("a", 3)
    assert len(budget.alerts) == 1
    budget.settle(token)
    assert budget.spent("a") == 3


async def test_parallel_same_agent_cannot_exceed_estimated_ceiling():
    s, budget = scheduler()
    for _ in range(8):
        await enqueue(s)
    release = asyncio.Event()
    admitted = []

    async def worker():
        try:
            handle = await s.acquire_start("a")
        except BudgetExceededError:
            return
        s.get_agent("a").serve_oldest_task()
        admitted.append(handle)
        await release.wait()
        await s.release_handle(handle)

    tasks = [asyncio.create_task(worker()) for _ in range(8)]
    for _ in range(10):
        await asyncio.sleep(0)
    assert len(admitted) == 2
    assert budget.reserved("a") == 10
    assert budget.remaining("a") == 0
    release.set()
    await asyncio.gather(*tasks)
    assert budget.spent("a") == 10
    assert budget.reserved("a") == 0
    assert s.resource.holder_count == 0


async def test_shared_policy_coordinates_two_schedulers():
    shared = BudgetPolicy(default_limit=5)
    first, _ = scheduler(budget=shared)
    second, _ = scheduler(budget=shared)
    await enqueue(first, 4)
    await enqueue(second, 4)
    h = await first.acquire_start("a")
    with pytest.raises(BudgetExceededError):
        await second.acquire_start("a")
    assert shared.reserved("a") == 4
    await first.release_handle(h, actual_cost=2)
    with pytest.raises(BudgetExceededError):
        await second.acquire_start("a")
    assert shared.spent("a") == 2
    assert second.resource.holder_count == 0


async def test_both_acquire_apis_settle_actual_cost_and_free_difference():
    s, budget = scheduler(limit=10)
    await enqueue(s, 8)
    async with s.acquire("a") as handle:
        assert budget.reserved("a") == 8
        assert budget.spent("a") == 0
        handle.set_actual_cost(3)
        s.get_agent("a").serve_oldest_task()
    assert budget.spent("a") == 3
    await enqueue(s, 7)
    h = await s.acquire_start("a")
    await s.release_handle(h, actual_cost=4)
    await s.release_handle(h, actual_cost=999)
    assert budget.spent("a") == 7
    assert budget.reserved("a") == 0


async def test_unknown_actual_cost_settles_original_estimate_even_if_task_mutates():
    s, budget = scheduler()
    task = await enqueue(s, 5)
    h = await s.acquire_start("a")
    task.weight = 1
    await s.release_handle(h)
    assert budget.spent("a") == 5


async def test_actual_cost_overestimate_records_charge_and_blocks_next_call():
    s, budget = scheduler(limit=5)
    await enqueue(s, 3)
    h = await s.acquire_start("a")
    s.get_agent("a").serve_oldest_task()
    await s.release_handle(h, actual_cost=7)
    assert budget.spent("a") == 7
    assert budget.reserved("a") == 0
    await enqueue(s, 1)
    with pytest.raises(BudgetExceededError):
        await s.acquire_start("a")


async def test_bad_actual_cost_and_foreign_handle_do_not_consume_release():
    s, budget = scheduler()
    other, _ = scheduler()
    await enqueue(s)
    h = await s.acquire_start("a")
    with pytest.raises(ValueError):
        await s.release_handle(h, actual_cost=float("nan"))
    with pytest.raises(ValueError):
        await other.release_handle(h)
    assert budget.reserved("a") == 5
    await s.release_handle(h, actual_cost=0)
    assert budget.spent("a") == 0
    assert s.resource.holder_count == 0


class Deny(Policy):
    name = "deny"

    def check(self, agent_id, task):
        raise PolicyViolationError(self.name, agent_id, "denied")


class BadCompletion(Policy):
    name = "bad_completion"

    def check(self, agent_id, task):
        return True

    def record(self, agent_id, task):
        raise RuntimeError("completion failed")


async def test_later_policy_rejection_rolls_back_prior_budget_reservation():
    budget = BudgetPolicy(default_limit=10)
    s = AsyncLOCOScheduler(
        [Agent("a")], SharedResource("r"), enforcer=PolicyEnforcer([budget, Deny()])
    )
    await enqueue(s)
    with pytest.raises(PolicyViolationError):
        await s.acquire_start("a")
    assert budget.spent("a") == budget.reserved("a") == 0
    assert s.resource.holder_count == 0


async def test_settlement_uses_admission_snapshot_even_if_policies_removed():
    budget = BudgetPolicy(default_limit=10)
    enforcer = PolicyEnforcer([budget])
    s = AsyncLOCOScheduler([Agent("a")], SharedResource("r"), enforcer=enforcer)
    await enqueue(s)
    h = await s.acquire_start("a")
    enforcer.remove_policy("budget")
    await s.release_handle(h)
    assert budget.spent("a") == 5
    assert budget.reserved("a") == 0


async def test_other_policy_completion_failure_cannot_leak_budget_or_slot():
    budget = BudgetPolicy(default_limit=10)
    s = AsyncLOCOScheduler(
        [Agent("a")], SharedResource("r"), enforcer=PolicyEnforcer([BadCompletion(), budget])
    )
    await enqueue(s)
    h = await s.acquire_start("a")
    with pytest.raises(RuntimeError, match="completion failed"):
        await s.release_handle(h)
    assert budget.spent("a") == 5
    assert budget.reserved("a") == 0
    assert s.resource.holder_count == 0


@pytest.mark.parametrize("error", [RuntimeError("hook failed"), asyncio.CancelledError()])
async def test_start_hook_failure_rolls_back_before_execution(error):
    def hook(*_):
        raise error

    s, budget = scheduler(on_task_started=hook)
    await enqueue(s)
    with pytest.raises(type(error)):
        await s.acquire_start("a")
    assert budget.reserved("a") == budget.spent("a") == 0
    assert s.resource.holder_count == 0


async def test_cancelled_execution_settles_estimate_and_wakes_next_waiter():
    s, budget = scheduler(limit=10, capacity=1)
    await enqueue(s)
    await enqueue(s)
    started = asyncio.Event()

    async def holder():
        async with s.acquire("a"):
            s.get_agent("a").serve_oldest_task()
            started.set()
            await asyncio.Event().wait()

    first = asyncio.create_task(holder())
    await started.wait()
    second = asyncio.create_task(s.acquire_start("a"))
    await asyncio.sleep(0)
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    h = await asyncio.wait_for(second, 0.2)
    assert budget.spent("a") == 5
    assert budget.reserved("a") == 5
    await s.release_handle(h)
    assert budget.spent("a") == 10
    assert budget.reserved("a") == 0


async def test_timeout_removes_only_its_own_same_agent_waiter():
    s, budget = scheduler(capacity=1, limit=20)
    for _ in range(3):
        await enqueue(s)
    h = await s.acquire_start("a")
    s.get_agent("a").serve_oldest_task()
    first = asyncio.create_task(s.acquire_start("a", timeout=0.01))
    second = asyncio.create_task(s.acquire_start("a", timeout=0.2))
    with pytest.raises(TimeoutError):
        await first
    assert s.resource.waiter_count == 1
    assert budget.reserved("a") == 5
    await s.release_handle(h)
    h2 = await second
    await s.release_handle(h2)
    assert budget.reserved("a") == 0


async def test_cancel_between_resource_grant_and_waiter_resume_returns_slot():
    resource = SharedResource("r")
    await resource.try_acquire("holder")
    waiter = asyncio.create_task(resource.wait_for_slot("a"))
    await asyncio.sleep(0)
    await resource.release("holder")
    await resource.grant("a")
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert resource.holder_count == resource.waiter_count == 0


async def test_shutdown_cancels_all_same_agent_waiters_without_reservations():
    s, budget = scheduler(capacity=1)
    for _ in range(3):
        await enqueue(s)
    h = await s.acquire_start("a")
    waiters = [asyncio.create_task(s.acquire_start("a")) for _ in range(2)]
    await asyncio.sleep(0)
    await s.shutdown(timeout=0.001)
    results = await asyncio.gather(*waiters, return_exceptions=True)
    assert all(isinstance(r, asyncio.CancelledError) for r in results)
    assert budget.reserved("a") == 5
    await s.release_handle(h)
    assert budget.reserved("a") == s.resource.holder_count == 0


async def test_duplicate_budget_argument_is_not_charged_twice():
    budget = BudgetPolicy(default_limit=10)
    s, _ = scheduler(budget=budget, enforcer=PolicyEnforcer([budget]))
    await enqueue(s, 5)
    async with s.acquire("a"):
        assert budget.reserved("a") == 5
    assert budget.spent("a") == 5


async def test_completion_callback_error_settles_and_frees_resource():
    def callback(*_):
        raise RuntimeError("callback failed")

    s, budget = scheduler(on_task_completed=callback)
    await enqueue(s)
    with pytest.raises(RuntimeError, match="callback failed"):
        async with s.acquire("a"):
            pass
    assert budget.spent("a") == 5
    assert budget.reserved("a") == s.resource.holder_count == 0


async def test_repeated_cancellation_cannot_interrupt_slot_cleanup():
    s, budget = scheduler(capacity=1)
    await enqueue(s)
    handle = await s.acquire_start("a")
    # Hold the resource lock so release is demonstrably suspended mid-cleanup.
    await s.resource._lock.acquire()
    release = asyncio.create_task(s.release_handle(handle))
    await asyncio.sleep(0)
    release.cancel()
    await asyncio.sleep(0)
    release.cancel()
    await asyncio.sleep(0)
    s.resource._lock.release()
    with pytest.raises(asyncio.CancelledError):
        await release
    assert budget.reserved("a") == s.resource.holder_count == 0
    assert budget.spent("a") == 5


async def test_heterogeneous_costs_reserve_each_submitted_task_at_admission():
    s, budget = scheduler(limit=10)
    await enqueue(s, 3)
    first = await s.acquire_start("a")
    s.get_agent("a").serve_oldest_task()
    await enqueue(s, 8)
    with pytest.raises(BudgetExceededError):
        await s.acquire_start("a")
    await s.release_handle(first, actual_cost=1)
    second = await s.acquire_start("a")
    assert budget.reserved("a") == 8
    await s.release_handle(second)
    assert budget.spent("a") == 9


async def test_waiters_keep_their_own_prices_when_prior_task_is_rejected():
    s, budget = scheduler(limit=5, capacity=1)
    first = await enqueue(s, 5)
    handle = await s.acquire_start("a")
    s.get_agent("a").tasks.remove(first)
    expensive = await enqueue(s, 8)
    cheap = await enqueue(s, 1)

    async def denied():
        with pytest.raises(BudgetExceededError):
            await s.acquire_start("a")
        s.get_agent("a").tasks.remove(expensive)

    denied_task = asyncio.create_task(denied())
    cheap_task = asyncio.create_task(s.acquire_start("a"))
    await asyncio.sleep(0)
    await s.release_handle(handle, actual_cost=0)
    await denied_task
    cheap_handle = await cheap_task
    assert cheap_handle._serving_task is cheap
    assert budget.reserved("a") == 1
    await s.release_handle(cheap_handle)
