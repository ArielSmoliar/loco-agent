"""Scenario 1 — Burst: 8 agents receive work simultaneously.

The scheduler serves high-backlog agents first. Service counts match
tasks assigned exactly.

Run: python examples/burst.py
"""

import asyncio
from collections import defaultdict

from loco import Agent, AsyncLOCOScheduler, SharedResource, Task

N_AGENTS = 8


async def main():
    agents = [Agent(agent_id=f"agent-{i}") for i in range(N_AGENTS)]
    resource = SharedResource(name="llm_api", capacity=1)
    service_order: list[str] = []

    scheduler = AsyncLOCOScheduler(
        agents, resource, optimize_for="balanced", seed=42,
        on_task_started=lambda aid, t: service_order.append(aid),
    )

    # Burst: agent i gets (i+1) tasks, all weight=1
    for i in range(N_AGENTS):
        for j in range(i + 1):
            await scheduler.submit_task(f"agent-{i}", Task(weight=1.0))

    total_tasks = N_AGENTS * (N_AGENTS + 1) // 2
    print(f"Burst: {N_AGENTS} agents, {total_tasks} total tasks, capacity=1\n")

    # Run all agents concurrently
    async def worker(agent_id: str, n_tasks: int):
        for _ in range(n_tasks):
            async with scheduler.acquire(agent_id):
                agent = scheduler.get_agent(agent_id)
                agent.serve_oldest_task()
                await asyncio.sleep(0)  # yield for contention

    await asyncio.gather(*(
        worker(f"agent-{i}", i + 1) for i in range(N_AGENTS)
    ))

    # Results
    print("Service order (first 12):")
    for i, aid in enumerate(service_order[:12]):
        print(f"  tick {i+1:2d}: {aid}")

    print("\nService counts:")
    counts = defaultdict(int)
    for aid in service_order:
        counts[aid] += 1
    for i in range(N_AGENTS):
        aid = f"agent-{i}"
        expected = i + 1
        status = "OK" if counts[aid] == expected else "MISMATCH"
        print(f"  {aid}: served {counts[aid]} (expected {expected}) [{status}]")

    # Cost tracking
    print(f"\nTotal cost: {scheduler.metrics.total_cost()}")
    print(f"Cost by agent: {scheduler.metrics.cost_by_agent()}")


if __name__ == "__main__":
    asyncio.run(main())
