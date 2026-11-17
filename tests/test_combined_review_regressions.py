"""Regression coverage for rollback and capacity boundaries found during review."""

import asyncio

import pytest

from loco import (
    Agent,
    AsyncLOCOScheduler,
    BudgetPolicy,
    Policy,
    PolicyEnforcer,
    SharedResource,
    Task,
)


async def test_failed_custom_rollback_still_cancels_budget_and_releases_slot():
    class BrokenRollback(Policy):
        name = "broken_rollback"

        def check(self, agent_id, task):
            return True

        def cancel_reservation(self, agent_id, task, reservation):
            raise RuntimeError("custom rollback failed")

    class Deny(Policy):
        name = "deny"

        def check(self, agent_id, task):
            return False

    budget = BudgetPolicy(default_limit=1)
    enforcer = PolicyEnforcer([budget, BrokenRollback(), Deny()])
    scheduler = AsyncLOCOScheduler([Agent("a")], SharedResource("r"), enforcer=enforcer)
    task = Task(weight=1)
    await scheduler.submit_task("a", task)

    # Rollback runs in reverse order, so the failing custom hook is reached
    # before the budget cancellation. Neither it nor denial may leak capacity.
    with pytest.raises(RuntimeError, match="custom rollback failed"):
        async with scheduler.acquire("a", task=task):
            pytest.fail("Rejected work executed")
    assert budget.spent("a") == budget.reserved("a") == 0
    assert scheduler.resource.holder_count == scheduler.resource.waiter_count == 0

    # The exact task can be retried once the rejecting policies are removed.
    enforcer.remove_policy("deny")
    enforcer.remove_policy("broken_rollback")
    async with scheduler.acquire("a", task=task):
        assert budget.reserved("a") == 1
    assert budget.spent("a") == 1
    assert budget.reserved("a") == scheduler.resource.holder_count == 0


async def test_explicit_grant_cannot_overfill_resource():
    resource = SharedResource("r", capacity=1)
    assert await resource.try_acquire("holder")
    waiting = asyncio.create_task(resource.wait_for_slot("waiter"))
    try:
        await asyncio.sleep(0)
        assert resource.waiter_count == 1

        await resource.grant("waiter")
        assert resource.holder_count == 1
        assert resource.waiter_count == 1
        assert not resource.is_holding("waiter")
        assert not waiting.done()

        await resource.release("holder")
        await resource.grant("waiter")
        await asyncio.wait_for(waiting, 1)
        assert resource.holder_count == 1
        assert resource.waiter_count == 0
        assert resource.is_holding("waiter")
    finally:
        if not waiting.done():
            waiting.cancel()
        await asyncio.gather(waiting, return_exceptions=True)
        await resource.release("holder")
        await resource.release("waiter")
    assert resource.holder_count == resource.waiter_count == 0
