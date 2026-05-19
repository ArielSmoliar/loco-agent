"""Tests for SharedResource and AsyncLOCOScheduler."""

import asyncio

import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler, BackpressureError, ShutdownError
from loco.resource import SharedResource
from loco.task import Task


# --- SharedResource unit tests ---


async def test_acquire_single_agent_immediate():
    """Acquire with capacity=1, one agent acquires immediately."""
    res = SharedResource(name="test", capacity=1)
    granted = await res.try_acquire("a1")
    assert granted is True
    assert res.holder_count == 1
    assert res.utilization == 1.0


async def test_acquire_capacity_full_blocks():
    """Acquire with capacity=1, second agent cannot acquire immediately."""
    res = SharedResource(name="test", capacity=1)
    await res.try_acquire("a1")
    granted = await res.try_acquire("a2")
    assert granted is False


async def test_release_frees_slot():
    """Release makes the slot available again."""
    res = SharedResource(name="test", capacity=1)
    await res.try_acquire("a1")
    assert res.available_slots == 0
    await res.release("a1")
    assert res.available_slots == 1
    assert res.utilization == 0.0


async def test_release_nonholder_silent():
    """Releasing an agent that doesn't hold is a no-op."""
    res = SharedResource(name="test", capacity=1)
    await res.release("nobody")  # should not raise


async def test_utilization_lifecycle():
    """Utilization reflects current holders: 0.0 -> 1.0 -> 0.0."""
    res = SharedResource(name="test", capacity=1)
    assert res.utilization == 0.0
    await res.try_acquire("a1")
    assert res.utilization == 1.0
    await res.release("a1")
    assert res.utilization == 0.0


async def test_capacity_validation():
    with pytest.raises(ValueError, match="Capacity must be"):
        SharedResource(name="bad", capacity=0)


async def test_multi_capacity():
    """Multiple agents can hold simultaneously up to capacity."""
    res = SharedResource(name="test", capacity=3)
    assert await res.try_acquire("a1")
    assert await res.try_acquire("a2")
    assert await res.try_acquire("a3")
    assert not await res.try_acquire("a4")
    assert res.utilization == 1.0


async def test_is_holding():
    res = SharedResource(name="test", capacity=1)
    assert not res.is_holding("a1")
    await res.try_acquire("a1")
    assert res.is_holding("a1")
    await res.release("a1")
    assert not res.is_holding("a1")


# --- Context manager tests ---


async def test_context_manager_releases_on_normal_exit():
    """Context manager releases on normal exit."""
    res = SharedResource(name="test", capacity=1)
    await res.try_acquire("a1")
    async with res.held_by("a1"):
        assert res.is_holding("a1")
    assert not res.is_holding("a1")


async def test_context_manager_releases_on_exception():
    """Context manager releases even on exception."""
    res = SharedResource(name="test", capacity=1)
    await res.try_acquire("a1")
    with pytest.raises(RuntimeError):
        async with res.held_by("a1"):
            raise RuntimeError("boom")
    assert not res.is_holding("a1")


# --- AsyncLOCOScheduler tests ---


def make_async_scheduler(
    agent_specs: list[tuple[str, list[tuple[float, int]]]],
    capacity: int = 1,
    alpha: float = 0.25,
    max_waiters: int = 100,
) -> AsyncLOCOScheduler:
    """Helper to create an AsyncLOCOScheduler with pre-loaded agents."""
    agents = []
    for agent_id, tasks in agent_specs:
        a = Agent(agent_id=agent_id)
        for i, (w, age) in enumerate(tasks):
            a.tasks.append(Task(task_id=f"{agent_id}-t{i}", weight=w, age=age))
        agents.append(a)
    resource = SharedResource(name="test", capacity=capacity)
    return AsyncLOCOScheduler(agents, resource, alpha=alpha, max_waiters=max_waiters, seed=42)


async def test_async_acquire_release_basic():
    """Basic acquire/release cycle works."""
    sched = make_async_scheduler([("a1", [(1.0, 0)])])

    async with sched.acquire("a1"):
        assert sched.resource.is_holding("a1")

    assert not sched.resource.is_holding("a1")


async def test_async_priority_ordering():
    """High-load agent gets resource before low-load agent."""
    sched = make_async_scheduler([
        ("high", [(3.0, 10), (3.0, 5)]),   # Qi=6, Dmax=10
        ("low", [(1.0, 1)]),                # Qi=1, Dmax=1
    ], capacity=1)

    order = []

    async def agent_work(agent_id: str):
        async with sched.acquire(agent_id):
            order.append(agent_id)

    # Both try to acquire concurrently
    await asyncio.gather(agent_work("high"), agent_work("low"))
    assert order[0] == "high"


async def test_async_release_grants_highest_priority():
    """Release grants to the highest-priority waiter, not FIFO."""
    sched = make_async_scheduler([
        ("holder", [(1.0, 0)]),
        ("low_pri", [(1.0, 1)]),    # Dmax=1, low priority
        ("high_pri", [(1.0, 20)]),  # Dmax=20, high priority
    ], capacity=1)

    # holder takes the resource
    await sched.resource.try_acquire("holder")

    order = []

    async def waiter(agent_id: str):
        async with sched.acquire(agent_id):
            order.append(agent_id)
            await asyncio.sleep(0.01)  # hold briefly so ordering is observable

    # Start both waiters (low_pri first to prove it's not FIFO)
    t_low = asyncio.create_task(waiter("low_pri"))
    await asyncio.sleep(0.02)
    t_high = asyncio.create_task(waiter("high_pri"))
    await asyncio.sleep(0.02)

    assert sched.resource.waiter_count == 2

    # Release holder -- should grant to high_pri (higher Dmax)
    await sched.resource.release("holder")
    await sched._on_release()

    # Let tasks complete
    await asyncio.sleep(0.15)

    # high_pri should have been granted first despite registering second
    assert order[0] == "high_pri"

    t_low.cancel()
    t_high.cancel()
    for t in [t_low, t_high]:
        try:
            await t
        except asyncio.CancelledError:
            pass


async def test_async_logical_tick_ages_tasks():
    """Each release increments the logical tick and ages waiting tasks."""
    sched = make_async_scheduler([
        ("a1", [(1.0, 0)]),
        ("a2", [(1.0, 0)]),
    ], capacity=1)

    assert sched.logical_tick == 0

    async with sched.acquire("a1"):
        pass  # acquire and release

    # After release, tick should have incremented
    assert sched.logical_tick == 1

    # a2's task should have aged by 1
    assert sched.agents["a2"].tasks[0].age == 1


async def test_async_submit_task():
    """submit_task enqueues to the correct agent."""
    sched = make_async_scheduler([("a1", [])])
    task = Task(task_id="new", weight=2.0)
    await sched.submit_task("a1", task)
    assert len(sched.agents["a1"].tasks) == 1
    assert sched.agents["a1"].tasks[0].weight == 2.0


async def test_async_submit_unknown_agent_auto_registers():
    """submit_task auto-registers unknown agents (thesis: slaves announce by participating)."""
    sched = make_async_scheduler([("a1", [])])
    assert "nope" not in sched.agents
    await sched.submit_task("nope", Task())
    assert "nope" in sched.agents
    assert len(sched.get_agent("nope").tasks) == 1


async def test_backpressure():
    """BackpressureError raised when too many waiters."""
    sched = make_async_scheduler([
        ("holder", [(1.0, 0)]),
        ("w1", [(1.0, 0)]),
        ("w2", [(1.0, 0)]),
    ], capacity=1, max_waiters=1)

    # Fill the resource
    await sched.resource.try_acquire("holder")

    # First waiter is fine
    async def waiter(aid: str):
        async with sched.acquire(aid):
            pass

    t1 = asyncio.create_task(waiter("w1"))
    await asyncio.sleep(0.05)

    # Second waiter hits backpressure
    with pytest.raises(BackpressureError):
        async with sched.acquire("w2"):
            pass

    # Clean up
    await sched.resource.release("holder")
    await sched._on_release()
    await asyncio.sleep(0.05)
    t1.cancel()
    try:
        await t1
    except asyncio.CancelledError:
        pass


async def test_shutdown_rejects_new_tasks():
    """After shutdown, submit_task raises ShutdownError."""
    sched = make_async_scheduler([("a1", [])])
    await sched.shutdown()
    with pytest.raises(ShutdownError):
        await sched.submit_task("a1", Task())


async def test_shutdown_rejects_acquire():
    """After shutdown, acquire raises ShutdownError."""
    sched = make_async_scheduler([("a1", [(1.0, 0)])])
    await sched.shutdown()
    with pytest.raises(ShutdownError):
        async with sched.acquire("a1"):
            pass


async def test_context_manager_releases_on_agent_exception():
    """If agent crashes while holding, resource is still released."""
    sched = make_async_scheduler([("a1", [(1.0, 0)])])

    with pytest.raises(RuntimeError, match="agent crashed"):
        async with sched.acquire("a1"):
            raise RuntimeError("agent crashed")

    assert not sched.resource.is_holding("a1")
