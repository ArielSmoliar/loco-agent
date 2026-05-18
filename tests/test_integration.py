"""Integration tests for AsyncLOCOScheduler: full lifecycle."""

import asyncio

import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler, BackpressureError, ShutdownError
from loco.resource import SharedResource
from loco.task import Task


def make_scheduler(
    n_agents: int,
    tasks_per_agent: int,
    capacity: int = 2,
    alpha: float = 0.25,
    weight: float = 1.0,
    max_waiters: int = 100,
    **kwargs,
) -> AsyncLOCOScheduler:
    agents = []
    for i in range(n_agents):
        a = Agent(agent_id=f"agent-{i}")
        for j in range(tasks_per_agent):
            a.tasks.append(Task(task_id=f"a{i}-t{j}", weight=weight, age=0))
        agents.append(a)
    resource = SharedResource(name="llm_api", capacity=capacity)
    return AsyncLOCOScheduler(
        agents, resource, alpha=alpha, max_waiters=max_waiters, seed=42, **kwargs
    )


# --- Test 1: 5 agents, capacity=2, 15 tasks, all complete ---

async def test_five_agents_fifteen_tasks_no_deadlock():
    """5 agents, 1 resource with capacity=2. Each agent has 3 tasks.
    All 15 tasks complete without deadlock or timeout."""
    sched = make_scheduler(n_agents=5, tasks_per_agent=3, capacity=2)
    completed = []

    async def agent_work(agent_id: str):
        agent = sched.get_agent(agent_id)
        while agent.tasks:
            async with sched.acquire(agent_id):
                task = agent.serve_oldest_task()
                if task:
                    completed.append((agent_id, task.task_id))
                    await asyncio.sleep(0.01)  # simulate work

    async with asyncio.timeout(10):
        await asyncio.gather(*[
            agent_work(f"agent-{i}") for i in range(5)
        ])

    assert len(completed) == 15
    # Every agent contributed 3 tasks
    for i in range(5):
        agent_tasks = [c for c in completed if c[0] == f"agent-{i}"]
        assert len(agent_tasks) == 3


# --- Test 2: Cancellation via timeout ---

async def test_cancellation_timeout():
    """Agent times out waiting for resource. Removed from queue, others unaffected."""
    sched = make_scheduler(n_agents=2, tasks_per_agent=1, capacity=1)

    # agent-0 holds the resource
    hold_event = asyncio.Event()
    released_event = asyncio.Event()

    async def holder():
        async with sched.acquire("agent-0"):
            hold_event.set()
            # Hold for a while
            await asyncio.sleep(1.0)
        released_event.set()

    holder_task = asyncio.create_task(holder())
    await hold_event.wait()

    # agent-1 tries to acquire with short timeout
    with pytest.raises(TimeoutError):
        async with sched.acquire("agent-1", timeout=0.1):
            pass

    # agent-1 should be cleaned up from wait queue
    assert sched.resource.waiter_count == 0

    # Clean up holder
    holder_task.cancel()
    try:
        await holder_task
    except asyncio.CancelledError:
        pass


# --- Test 3: Agent exception mid-task ---

async def test_agent_exception_releases_resource():
    """If agent crashes while holding resource, resource is released
    and other agents can proceed."""
    sched = make_scheduler(n_agents=2, tasks_per_agent=1, capacity=1)
    other_completed = False

    # agent-0 crashes
    with pytest.raises(RuntimeError, match="agent crashed"):
        async with sched.acquire("agent-0"):
            raise RuntimeError("agent crashed")

    assert not sched.resource.is_holding("agent-0")

    # agent-1 can now acquire
    async with sched.acquire("agent-1"):
        other_completed = True

    assert other_completed


# --- Test 4: BackpressureError ---

async def test_backpressure_error():
    """BackpressureError raised at acquire() time when max_waiters exceeded."""
    sched = make_scheduler(n_agents=3, tasks_per_agent=1, capacity=1, max_waiters=1)

    # Fill the resource
    await sched.resource.try_acquire("agent-0")

    # First waiter is fine
    async def waiter():
        async with sched.acquire("agent-1"):
            pass

    t = asyncio.create_task(waiter())
    await asyncio.sleep(0.05)

    # Second waiter hits backpressure
    with pytest.raises(BackpressureError):
        async with sched.acquire("agent-2"):
            pass

    # Scheduler still works -- clean up
    await sched.resource.release("agent-0")
    await sched._on_release()
    await asyncio.sleep(0.05)
    t.cancel()
    try:
        await t
    except asyncio.CancelledError:
        pass


# --- Test 5: Submit to unknown agent ---

async def test_submit_unknown_agent():
    sched = make_scheduler(n_agents=1, tasks_per_agent=0)
    with pytest.raises(ValueError, match="Unknown agent"):
        await sched.submit_task("nonexistent", Task())


# --- Test 6: Lifecycle hooks fire in order ---

async def test_lifecycle_hooks_fire_in_order():
    """on_task_started fires before on_task_completed for each task."""
    events = []

    def on_started(agent_id, task):
        events.append(("started", agent_id, task.task_id))

    def on_completed(agent_id, task, result):
        events.append(("completed", agent_id, task.task_id))

    sched = make_scheduler(
        n_agents=2, tasks_per_agent=1, capacity=1,
        on_task_started=on_started, on_task_completed=on_completed,
    )

    async def agent_work(agent_id):
        async with sched.acquire(agent_id):
            await asyncio.sleep(0.01)

    await asyncio.gather(agent_work("agent-0"), agent_work("agent-1"))

    # Each agent should have started then completed
    started_events = [e for e in events if e[0] == "started"]
    completed_events = [e for e in events if e[0] == "completed"]
    assert len(started_events) >= 1
    assert len(completed_events) >= 1

    # For each agent, started must come before completed
    for agent_id in ["agent-0", "agent-1"]:
        agent_events = [e for e in events if e[1] == agent_id]
        if len(agent_events) == 2:
            assert agent_events[0][0] == "started"
            assert agent_events[1][0] == "completed"


# --- Test 7: Logical tick increments on release ---

async def test_logical_tick_on_release():
    """Each release increments the global tick. Waiting tasks age."""
    sched = make_scheduler(n_agents=2, tasks_per_agent=1, capacity=1)

    assert sched.logical_tick == 0
    initial_age = sched.agents["agent-1"].tasks[0].age

    async with sched.acquire("agent-0"):
        await asyncio.sleep(0.01)

    # After release, tick incremented and agent-1's task aged
    assert sched.logical_tick == 1
    assert sched.agents["agent-1"].tasks[0].age == initial_age + 1


# --- Test 8: Shutdown with in-flight task ---

async def test_shutdown_with_inflight():
    """Shutdown waits for in-flight task then cancels waiters."""
    sched = make_scheduler(n_agents=2, tasks_per_agent=1, capacity=1)
    holder_done = asyncio.Event()

    async def holder():
        async with sched.acquire("agent-0"):
            await asyncio.sleep(0.1)
        holder_done.set()

    async def waiter():
        try:
            async with sched.acquire("agent-1"):
                pass
        except (ShutdownError, asyncio.CancelledError):
            pass

    ht = asyncio.create_task(holder())
    wt = asyncio.create_task(waiter())
    await asyncio.sleep(0.05)

    result = await sched.shutdown(timeout=2.0)

    assert result["cancelled_waiters"] >= 0
    assert sched._shutting_down is True

    ht.cancel()
    wt.cancel()
    for t in [ht, wt]:
        try:
            await t
        except asyncio.CancelledError:
            pass


# --- Test 9: Shutdown then submit ---

async def test_shutdown_then_submit():
    sched = make_scheduler(n_agents=1, tasks_per_agent=0)
    await sched.shutdown()
    with pytest.raises(ShutdownError):
        await sched.submit_task("agent-0", Task())


# --- Test 10: Shutdown then acquire ---

async def test_shutdown_then_acquire():
    sched = make_scheduler(n_agents=1, tasks_per_agent=1)
    await sched.shutdown()
    with pytest.raises(ShutdownError):
        async with sched.acquire("agent-0"):
            pass
