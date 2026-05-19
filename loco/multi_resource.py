"""Multi-resource contention for LOCO-Agent.

Agents acquiring multiple resources simultaneously (LLM + DB + GPU).
Deadlock prevention via resource ordering — resources are always
acquired in a consistent order (alphabetical by name).

Usage:
    pool = ResourcePool()
    pool.add(SharedResource("llm_api", capacity=3))
    pool.add(SharedResource("database", capacity=10))
    pool.add(SharedResource("gpu", capacity=1))

    scheduler = AsyncLOCOScheduler(agents, pool.primary, optimize_for="balanced")

    async with pool.acquire_multiple("agent-1", ["llm_api", "gpu"]):
        # holds both resources
        result = await do_work()
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from loco.resource import SharedResource


class ResourcePool:
    """Manages multiple shared resources with deadlock-safe multi-acquire.

    Deadlock prevention: resources are always acquired in sorted order
    (by name). This prevents circular wait — the classic deadlock condition.

    A→B and B→A can deadlock. But if both always acquire in order A→B,
    no circular wait is possible.
    """

    def __init__(self) -> None:
        self._resources: dict[str, SharedResource] = {}

    def add(self, resource: SharedResource) -> None:
        """Add a resource to the pool."""
        if resource.name in self._resources:
            raise ValueError(f"Resource already in pool: {resource.name}")
        self._resources[resource.name] = resource

    def get(self, name: str) -> SharedResource:
        """Get a resource by name."""
        if name not in self._resources:
            raise ValueError(f"Unknown resource: {name}")
        return self._resources[name]

    @property
    def primary(self) -> SharedResource:
        """The first resource (alphabetically). Use as the scheduler's resource."""
        if not self._resources:
            raise RuntimeError("No resources in pool")
        return self._resources[sorted(self._resources)[0]]

    @property
    def names(self) -> list[str]:
        """Sorted list of resource names."""
        return sorted(self._resources)

    @asynccontextmanager
    async def acquire_multiple(
        self, agent_id: str, resource_names: list[str]
    ) -> AsyncIterator[None]:
        """Acquire multiple resources in sorted order (deadlock-safe).

        All requested resources are acquired before yielding. Released
        in reverse order on exit (including exceptions).

        Args:
            agent_id: The agent requesting resources.
            resource_names: List of resource names to acquire.

        Raises:
            ValueError: if any resource name is unknown.
        """
        # Sort for consistent ordering (deadlock prevention)
        sorted_names = sorted(set(resource_names))
        acquired: list[SharedResource] = []

        try:
            for name in sorted_names:
                resource = self.get(name)
                granted = await resource.try_acquire(agent_id)
                if not granted:
                    await resource.wait_for_slot(agent_id)
                    # After wait_for_slot, we need to acquire
                    # (grant() already added us to holders)
                else:
                    pass  # try_acquire already added us
                acquired.append(resource)
            yield
        finally:
            # Release in reverse order
            for resource in reversed(acquired):
                await resource.release(agent_id)

    def utilization(self) -> dict[str, float]:
        """Current utilization per resource."""
        return {
            name: res.utilization
            for name, res in sorted(self._resources.items())
        }
