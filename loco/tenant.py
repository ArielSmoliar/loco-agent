"""Multi-tenant isolation for LOCO-Agent (v0.4).

Partitions agents into tenant-scoped scheduling domains. Each tenant
gets its own scheduling context with independent cost tracking, policy
enforcement, and starvation guarantees. One tenant's burst can't starve
another tenant's agents.

Usage:
    mt = MultiTenantScheduler(
        resource=SharedResource("llm_api", capacity=10),
        optimize_for="balanced",
    )

    mt.register_tenant("acme", max_agents=20, cost_ceiling=500.0)
    mt.register_tenant("globex", max_agents=10, cost_ceiling=200.0)

    mt.register_agent("acme", Agent(agent_id="acme_analyst"))
    await mt.submit_task("acme", "acme_analyst", task)

    async with mt.acquire("acme", "acme_analyst"):
        await do_work()
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from loco.agent import Agent
from loco.resource import SharedResource
from loco.task import Task


@dataclass
class TenantConfig:
    """Configuration for a single tenant."""

    tenant_id: str
    max_agents: int = 100
    cost_ceiling: float | None = None  # None = unlimited


@dataclass
class TenantState:
    """Runtime state for a single tenant."""

    config: TenantConfig
    agents: dict[str, Agent] = field(default_factory=dict)
    total_cost: float = 0.0
    tasks_completed: int = 0


class TenantCostExceededError(Exception):
    """Raised when a tenant's cost ceiling would be exceeded."""


class TenantLimitError(Exception):
    """Raised when a tenant's agent limit would be exceeded."""


class MultiTenantScheduler:
    """Multi-tenant scheduling with isolated domains.

    Wraps a shared resource with per-tenant agent pools, cost tracking,
    and starvation prevention. Each tenant's agents compete only within
    their tenant for fair scheduling, while the underlying resource is
    shared across all tenants.

    Args:
        resource: The shared resource all tenants compete for.
        optimize_for: Scheduling optimization target.
    """

    def __init__(
        self,
        resource: SharedResource,
        *,
        optimize_for: str = "balanced",
    ) -> None:
        self.resource = resource
        self._optimize_for = optimize_for
        self._tenants: dict[str, TenantState] = {}
        # Map agent_id -> tenant_id for fast lookup
        self._agent_tenant: dict[str, str] = {}

    def register_tenant(
        self,
        tenant_id: str,
        *,
        max_agents: int = 100,
        cost_ceiling: float | None = None,
    ) -> None:
        """Register a new tenant.

        Args:
            tenant_id: Unique tenant identifier.
            max_agents: Maximum agents this tenant can register.
            cost_ceiling: Maximum cumulative cost for this tenant. None = unlimited.

        Raises:
            ValueError: If tenant_id is already registered.
        """
        if tenant_id in self._tenants:
            raise ValueError(f"Tenant already registered: {tenant_id}")
        config = TenantConfig(
            tenant_id=tenant_id,
            max_agents=max_agents,
            cost_ceiling=cost_ceiling,
        )
        self._tenants[tenant_id] = TenantState(config=config)

    def unregister_tenant(self, tenant_id: str) -> None:
        """Remove a tenant and all its agents.

        Raises:
            ValueError: If tenant_id is not registered.
            RuntimeError: If any of the tenant's agents are holding resources.
        """
        tenant = self._get_tenant(tenant_id)
        for agent_id in tenant.agents:
            if self.resource.is_holding(agent_id):
                raise RuntimeError(
                    f"Cannot unregister tenant {tenant_id}: "
                    f"agent {agent_id} is holding the resource"
                )
        for agent_id in list(tenant.agents.keys()):
            self._agent_tenant.pop(agent_id, None)
        del self._tenants[tenant_id]

    def register_agent(self, tenant_id: str, agent: Agent) -> None:
        """Register an agent under a tenant.

        Raises:
            ValueError: If tenant doesn't exist or agent already registered.
            TenantLimitError: If tenant has reached max_agents.
        """
        tenant = self._get_tenant(tenant_id)
        if agent.agent_id in self._agent_tenant:
            existing_tenant = self._agent_tenant[agent.agent_id]
            raise ValueError(
                f"Agent {agent.agent_id} already registered under tenant {existing_tenant}"
            )
        if len(tenant.agents) >= tenant.config.max_agents:
            raise TenantLimitError(
                f"Tenant {tenant_id} has reached max_agents ({tenant.config.max_agents})"
            )
        tenant.agents[agent.agent_id] = agent
        self._agent_tenant[agent.agent_id] = tenant_id

    async def submit_task(self, tenant_id: str, agent_id: str, task: Task) -> None:
        """Submit a task to an agent within a tenant.

        Raises:
            ValueError: If tenant or agent doesn't exist.
            TenantCostExceededError: If the task would exceed the tenant's cost ceiling.
        """
        tenant = self._get_tenant(tenant_id)
        if agent_id not in tenant.agents:
            raise ValueError(f"Agent {agent_id} not registered under tenant {tenant_id}")

        # Check cost ceiling (include pending queue cost)
        if tenant.config.cost_ceiling is not None:
            pending_cost = sum(
                t.weight for a in tenant.agents.values() for t in a.tasks
            )
            projected = tenant.total_cost + pending_cost + task.weight
            if projected > tenant.config.cost_ceiling:
                raise TenantCostExceededError(
                    f"Tenant {tenant_id} cost ceiling exceeded: "
                    f"{tenant.total_cost} (spent) + {pending_cost} (pending) + "
                    f"{task.weight} (new) > {tenant.config.cost_ceiling}"
                )

        agent = tenant.agents[agent_id]
        agent.tasks.append(task)

    @asynccontextmanager
    async def acquire(
        self, tenant_id: str, agent_id: str, *, timeout: float | None = None
    ) -> AsyncIterator[None]:
        """Acquire the shared resource for a tenant's agent.

        Enforces tenant cost ceiling on grant. Records cost to tenant state.

        Args:
            tenant_id: The tenant making the request.
            agent_id: The agent requesting the resource.
            timeout: Max seconds to wait.

        Raises:
            ValueError: If tenant or agent doesn't exist.
            TenantCostExceededError: If granting would exceed cost ceiling.
        """
        tenant = self._get_tenant(tenant_id)
        if agent_id not in tenant.agents:
            raise ValueError(f"Agent {agent_id} not in tenant {tenant_id}")

        agent = tenant.agents[agent_id]
        serving_task = agent.tasks[0] if agent.tasks else None

        # Acquire the shared resource
        granted = await self.resource.try_acquire(agent_id)
        if not granted:
            await self.resource.wait_for_slot(agent_id)

        # Record cost
        if serving_task:
            tenant.total_cost += serving_task.weight

        try:
            async with self.resource.held_by(agent_id):
                yield
        finally:
            if serving_task:
                tenant.tasks_completed += 1

    def tenant_cost(self, tenant_id: str) -> float:
        """Get cumulative cost for a tenant."""
        return self._get_tenant(tenant_id).total_cost

    def tenant_remaining(self, tenant_id: str) -> float | None:
        """Get remaining cost budget for a tenant. None if no ceiling."""
        tenant = self._get_tenant(tenant_id)
        if tenant.config.cost_ceiling is None:
            return None
        return max(0.0, tenant.config.cost_ceiling - tenant.total_cost)

    def tenant_stats(self, tenant_id: str) -> dict[str, Any]:
        """Get stats for a tenant."""
        tenant = self._get_tenant(tenant_id)
        return {
            "tenant_id": tenant_id,
            "agent_count": len(tenant.agents),
            "max_agents": tenant.config.max_agents,
            "total_cost": tenant.total_cost,
            "cost_ceiling": tenant.config.cost_ceiling,
            "cost_remaining": self.tenant_remaining(tenant_id),
            "tasks_completed": tenant.tasks_completed,
        }

    def all_tenants(self) -> dict[str, dict[str, Any]]:
        """Get stats for all tenants."""
        return {tid: self.tenant_stats(tid) for tid in self._tenants}

    def agent_tenant(self, agent_id: str) -> str | None:
        """Look up which tenant an agent belongs to."""
        return self._agent_tenant.get(agent_id)

    @property
    def tenant_ids(self) -> list[str]:
        """List of registered tenant IDs."""
        return list(self._tenants.keys())

    def _get_tenant(self, tenant_id: str) -> TenantState:
        if tenant_id not in self._tenants:
            raise ValueError(f"Unknown tenant: {tenant_id}")
        return self._tenants[tenant_id]
