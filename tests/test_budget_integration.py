"""Integration tests: BudgetManager wired into AsyncLOCOScheduler."""

import asyncio

import pytest

from loco import Agent, AsyncLOCOScheduler, SharedResource, Task
from loco.budget import BudgetExceededError, BudgetManager


@pytest.fixture
def resource():
    return SharedResource("test_api", capacity=1)


@pytest.fixture
def agents():
    return [Agent(agent_id="a"), Agent(agent_id="b")]


# --- Reject mode ---


@pytest.mark.asyncio
async def test_reject_mode_blocks_acquire(agents, resource):
    """Over-budget task raises BudgetExceededError, resource is released,
    next waiter gets the slot."""
    budget = BudgetManager(on_exceeded="reject")
    budget.set_limit("a", max_cost=5.0)
    budget.record_spend("a", 4.5)  # 0.5 remaining

    scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)
    await scheduler.submit_task("a", Task(weight=2.0))  # exceeds: 4.5 + 2.0 > 5.0

    with pytest.raises(BudgetExceededError) as exc_info:
        async with scheduler.acquire("a"):
            pass  # should never reach here

    assert exc_info.value.agent_id == "a"
    assert exc_info.value.limit == 5.0

    # Resource should be free after rejection
    assert resource.holder_count == 0
    assert resource.available_slots == 1


@pytest.mark.asyncio
async def test_reject_frees_slot_for_next_waiter(agents, resource):
    """When agent A is rejected, agent B (waiting) gets the slot."""
    budget = BudgetManager(on_exceeded="reject")
    budget.set_limit("a", max_cost=1.0)
    budget.record_spend("a", 0.9)  # 0.1 remaining

    scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)
    await scheduler.submit_task("a", Task(weight=2.0))  # will exceed
    await scheduler.submit_task("b", Task(weight=1.0))  # within budget (no limit on b)

    b_granted = asyncio.Event()

    async def worker_a():
        with pytest.raises(BudgetExceededError):
            async with scheduler.acquire("a"):
                pass

    async def worker_b():
        async with scheduler.acquire("b"):
            b_granted.set()
            scheduler.get_agent("b").serve_oldest_task()

    await asyncio.gather(worker_a(), worker_b())
    assert b_granted.is_set()


@pytest.mark.asyncio
async def test_reject_mode_acquire_start(agents, resource):
    """Reject mode works via the split acquire/release API too."""
    budget = BudgetManager(on_exceeded="reject")
    budget.set_limit("a", max_cost=5.0)
    budget.record_spend("a", 4.5)

    scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)
    await scheduler.submit_task("a", Task(weight=2.0))

    with pytest.raises(BudgetExceededError):
        await scheduler.acquire_start("a")

    assert resource.holder_count == 0


# --- Alert mode ---


@pytest.mark.asyncio
async def test_alert_mode_allows_over_budget(agents, resource):
    """Alert mode allows the task but records an alert."""
    budget = BudgetManager(on_exceeded="alert")
    budget.set_limit("a", max_cost=5.0)
    budget.record_spend("a", 4.5)

    scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)
    await scheduler.submit_task("a", Task(weight=2.0))

    # Should NOT raise -- alert mode allows through
    async with scheduler.acquire("a"):
        scheduler.get_agent("a").serve_oldest_task()

    assert len(budget.alerts) == 1
    assert budget.alerts[0]["agent_id"] == "a"


# --- Downgrade mode ---


@pytest.mark.asyncio
async def test_downgrade_mode_allows(agents, resource):
    """Downgrade mode allows the task and records alert."""
    budget = BudgetManager(on_exceeded="downgrade")
    budget.set_limit("a", max_cost=5.0)
    budget.record_spend("a", 4.5)

    scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)
    await scheduler.submit_task("a", Task(weight=2.0))

    async with scheduler.acquire("a"):
        scheduler.get_agent("a").serve_oldest_task()

    assert len(budget.alerts) == 1


# --- Spend tracking ---


@pytest.mark.asyncio
async def test_spend_recorded_on_release(agents, resource):
    """budget.spent() increments after task completes via acquire()."""
    budget = BudgetManager(default_limit=100.0)
    scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)
    await scheduler.submit_task("a", Task(weight=3.0))

    assert budget.spent("a") == 0.0

    async with scheduler.acquire("a"):
        scheduler.get_agent("a").serve_oldest_task()

    assert budget.spent("a") == 3.0


@pytest.mark.asyncio
async def test_spend_recorded_on_release_handle(agents, resource):
    """budget.spent() increments after release_handle() (split API)."""
    budget = BudgetManager(default_limit=100.0)
    scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)
    await scheduler.submit_task("a", Task(weight=5.0))

    handle = await scheduler.acquire_start("a")
    assert budget.spent("a") == 0.0

    scheduler.get_agent("a").serve_oldest_task()
    await scheduler.release_handle(handle)

    assert budget.spent("a") == 5.0


# --- Backward compatibility ---


@pytest.mark.asyncio
async def test_no_budget_backward_compat(agents, resource):
    """budget=None (default) -- everything works as before."""
    scheduler = AsyncLOCOScheduler(agents, resource)
    assert scheduler.budget is None

    await scheduler.submit_task("a", Task(weight=1.0))
    async with scheduler.acquire("a"):
        scheduler.get_agent("a").serve_oldest_task()

    assert scheduler.metrics.agent_cost("a") == 1.0


# --- Edge case ---


@pytest.mark.asyncio
async def test_no_task_skips_check(agents, resource):
    """Empty queue agent acquires without budget check (no task to price)."""
    budget = BudgetManager(on_exceeded="reject")
    budget.set_limit("a", max_cost=0.0)  # zero budget

    scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)
    # Don't submit any task -- agent has empty queue

    async with scheduler.acquire("a"):
        pass  # should not raise -- no serving_task to check

    assert resource.holder_count == 0
