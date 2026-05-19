"""Scenario 1 — Burst replay against async scheduler (Day 6).

Setup: 8 agents. Agent i receives (i+1) tasks at tick 0, all weight=1.
Resource capacity=1.

Assertions:
  - Service counts match tasks assigned exactly (counting invariant).
  - High-queue agents served first in early ticks (±1 position tolerance).
  - All tasks complete (no deadlock, no starvation).
"""

import asyncio
from collections import defaultdict

import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler
from loco.resource import SharedResource
from loco.task import Task

N_AGENTS = 8


def _make_scenario():
    """Create agents, resource, and task lists for the burst scenario."""
    agents = [Agent(agent_id=f"agent-{i}") for i in range(N_AGENTS)]
    resource = SharedResource(name="llm_api", capacity=1)
    # Agent i gets (i+1) tasks, all weight=1
    tasks_per_agent = {
        f"agent-{i}": [
            Task(task_id=f"agent-{i}-t{j}", weight=1.0)
            for j in range(i + 1)
        ]
        for i in range(N_AGENTS)
    }
    return agents, resource, tasks_per_agent


@pytest.mark.asyncio
async def test_service_counts_match_tasks_assigned():
    """Each agent is served exactly as many times as it has tasks."""
    agents, resource, tasks_per_agent = _make_scenario()
    service_counts: dict[str, int] = defaultdict(int)

    sched = AsyncLOCOScheduler(
        agents, resource, optimize_for="balanced", seed=42,
    )

    # Submit all tasks upfront (burst: everything arrives at tick 0)
    for agent_id, tasks in tasks_per_agent.items():
        for task in tasks:
            await sched.submit_task(agent_id, task)

    # Each agent runs its tasks through acquire/release
    async def agent_worker(agent_id: str, n_tasks: int):
        for _ in range(n_tasks):
            async with sched.acquire(agent_id):
                agent = sched.get_agent(agent_id)
                agent.serve_oldest_task()
                service_counts[agent_id] += 1

    workers = [
        agent_worker(f"agent-{i}", i + 1)
        for i in range(N_AGENTS)
    ]
    await asyncio.gather(*workers)

    # Assert service counts match exactly
    for i in range(N_AGENTS):
        agent_id = f"agent-{i}"
        expected = i + 1
        assert service_counts[agent_id] == expected, (
            f"{agent_id}: served {service_counts[agent_id]}, expected {expected}"
        )

    # Total: 1+2+...+8 = 36
    assert sum(service_counts.values()) == N_AGENTS * (N_AGENTS + 1) // 2


@pytest.mark.asyncio
async def test_high_queue_agents_served_first():
    """Scored grants favor high-queue agents under real contention.

    With instant work, asyncio processes workers sequentially (no contention).
    To test scoring, we use an asyncio.Event barrier: all workers register
    as waiters before the first grant, forcing the scheduler to score them.
    """
    agents, resource, tasks_per_agent = _make_scenario()
    service_order: list[str] = []

    sched = AsyncLOCOScheduler(
        agents, resource, optimize_for="balanced", seed=42,
        on_task_started=lambda aid, task: service_order.append(aid),
    )

    for agent_id, tasks in tasks_per_agent.items():
        for task in tasks:
            await sched.submit_task(agent_id, task)

    async def agent_worker(agent_id: str, n_tasks: int):
        for _ in range(n_tasks):
            async with sched.acquire(agent_id):
                agent = sched.get_agent(agent_id)
                agent.serve_oldest_task()
                # Yield control so other workers can register as waiters
                await asyncio.sleep(0)

    workers = [
        agent_worker(f"agent-{i}", i + 1)
        for i in range(N_AGENTS)
    ]
    await asyncio.gather(*workers)

    # Skip the first service (unscored immediate grant).
    # Among the next 5 scored grants, high-queue agents (5,6,7) should
    # appear at least 3 times.
    scored_grants = service_order[1:6]
    high_queue_agents = {"agent-7", "agent-6", "agent-5"}
    served_high = sum(1 for a in scored_grants if a in high_queue_agents)
    assert served_high >= 3, (
        f"Expected at least 3 of first 5 scored grants to be high-queue agents, "
        f"got {scored_grants}"
    )


@pytest.mark.asyncio
async def test_all_tasks_complete_no_deadlock():
    """All 36 tasks complete within a timeout — no deadlock."""
    agents, resource, tasks_per_agent = _make_scenario()

    sched = AsyncLOCOScheduler(
        agents, resource, optimize_for="balanced", seed=42,
    )

    for agent_id, tasks in tasks_per_agent.items():
        for task in tasks:
            await sched.submit_task(agent_id, task)

    async def agent_worker(agent_id: str, n_tasks: int):
        for _ in range(n_tasks):
            async with sched.acquire(agent_id):
                agent = sched.get_agent(agent_id)
                agent.serve_oldest_task()

    workers = [
        agent_worker(f"agent-{i}", i + 1)
        for i in range(N_AGENTS)
    ]

    # Must complete within 5 seconds — if it hangs, deadlock
    async with asyncio.timeout(5.0):
        await asyncio.gather(*workers)

    # All agent queues should be drained (workers dequeue via serve_oldest_task)
    for i in range(N_AGENTS):
        agent = sched.get_agent(f"agent-{i}")
        assert len(agent.tasks) == 0, f"agent-{i} still has {len(agent.tasks)} tasks"
        assert len(agent.completed_tasks) == i + 1


@pytest.mark.asyncio
async def test_burst_sync_replay_matches_notebook():
    """Sync _step() replay: service counts must match notebook exactly.

    This validates the scoring core against the notebook baseline
    independent of async machinery.
    """
    from loco.scheduler import LOCOScheduler

    agents = [Agent(agent_id=f"agent-{i}") for i in range(N_AGENTS)]
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)

    # Burst arrival at tick 0
    arrivals = {
        f"agent-{i}": [
            sched.new_task(weight=1.0) for _ in range(i + 1)
        ]
        for i in range(N_AGENTS)
    }
    sched._step(arrivals=arrivals)

    while sched.total_tasks_remaining() > 0:
        sched._step()

    # Service counts must match exactly
    for i in range(N_AGENTS):
        agent = sched.get_agent(f"agent-{i}")
        expected = i + 1
        assert len(agent.completed_tasks) == expected, (
            f"agent-{i}: completed {len(agent.completed_tasks)}, expected {expected}"
        )

    # Total ticks = total tasks (capacity=1, one served per tick)
    assert sched.tick == N_AGENTS * (N_AGENTS + 1) // 2


@pytest.mark.asyncio
async def test_burst_with_optimize_for_throughput():
    """Burst with optimize_for='throughput' (alpha=0.5) — same as notebook default."""
    agents, resource, tasks_per_agent = _make_scenario()
    service_counts: dict[str, int] = defaultdict(int)

    sched = AsyncLOCOScheduler(
        agents, resource, optimize_for="throughput", seed=42,
    )

    for agent_id, tasks in tasks_per_agent.items():
        for task in tasks:
            await sched.submit_task(agent_id, task)

    async def agent_worker(agent_id: str, n_tasks: int):
        for _ in range(n_tasks):
            async with sched.acquire(agent_id):
                agent = sched.get_agent(agent_id)
                agent.serve_oldest_task()
                service_counts[agent_id] += 1

    workers = [
        agent_worker(f"agent-{i}", i + 1)
        for i in range(N_AGENTS)
    ]
    await asyncio.gather(*workers)

    # Service counts invariant holds regardless of alpha
    for i in range(N_AGENTS):
        assert service_counts[f"agent-{i}"] == i + 1


@pytest.mark.asyncio
async def test_burst_with_optimize_for_latency():
    """Burst with optimize_for='latency' (alpha=0.0) — Dmax-only scheduling."""
    agents, resource, tasks_per_agent = _make_scenario()
    service_counts: dict[str, int] = defaultdict(int)

    sched = AsyncLOCOScheduler(
        agents, resource, optimize_for="latency", seed=42,
    )

    for agent_id, tasks in tasks_per_agent.items():
        for task in tasks:
            await sched.submit_task(agent_id, task)

    async def agent_worker(agent_id: str, n_tasks: int):
        for _ in range(n_tasks):
            async with sched.acquire(agent_id):
                agent = sched.get_agent(agent_id)
                agent.serve_oldest_task()
                service_counts[agent_id] += 1

    workers = [
        agent_worker(f"agent-{i}", i + 1)
        for i in range(N_AGENTS)
    ]
    await asyncio.gather(*workers)

    # Counting invariant holds at any alpha
    for i in range(N_AGENTS):
        assert service_counts[f"agent-{i}"] == i + 1
