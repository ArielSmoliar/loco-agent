"""Multi-tenant isolation for LOCO-Agent (v0.4).

Partitions agents into tenant-scoped scheduling domains. Each tenant
has isolated agents and cost accounting. Admission uses a shared FIFO queue;
queued calls cannot be overtaken by later tenant calls. This is not weighted
fair sharing or independent per-tenant capacity.

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

import math
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from loco.agent import Agent
from loco.budget import validate_cost
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

    Wraps a shared FIFO resource with per-tenant agents and cost ceilings.
    Cost is charged at admission, including active calls, so concurrent calls
    cannot spend the same remaining budget. Executed tasks are dequeued exactly
    once on exit. A task is required; rejected/timed-out tasks remain queued.

    Args:
        resource: The shared resource all tenants compete for.
        optimize_for: Retained for compatibility; tenant admission uses FIFO.
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
        self._task_claims: set[int] = set()
        self._admitted_tasks: set[int] = set()
        self._pending_acquires: dict[str, int] = {}

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
            cost_ceiling=None if cost_ceiling is None else validate_cost(cost_ceiling),
        )
        self._tenants[tenant_id] = TenantState(config=config)

    def unregister_tenant(self, tenant_id: str) -> None:
        """Remove a tenant and all its agents.

        Raises:
            ValueError: If tenant_id is not registered.
            RuntimeError: If any of the tenant's agents are holding or waiting for resources.
        """
        tenant = self._get_tenant(tenant_id)
        for agent_id in tenant.agents:
            if self.resource.is_holding(agent_id) or self._pending_acquires.get(agent_id, 0):
                raise RuntimeError(
                    f"Cannot unregister tenant {tenant_id}: "
                    f"agent {agent_id} is holding or waiting for the resource"
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
            pending_cost = math.fsum(
                validate_cost(t.weight)
                for a in tenant.agents.values()
                for t in a.tasks
                if id(t) not in self._admitted_tasks
            )
            projected = tenant.total_cost + pending_cost + validate_cost(task.weight)
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
        self,
        tenant_id: str,
        agent_id: str,
        *,
        timeout: float | None = None,
        task: Task | None = None,
    ) -> AsyncIterator[None]:
        """Admit one queued task, honoring timeout and the current cost ceiling.

        A task's weight is charged before yielding, with no intervening await.
        Failures/cancellation after admission remain charged; this is task-weight
        accounting, not provider billing. Pre-admission failures do not charge.
        Pass task= to select an exact queued task; otherwise claim the next free
        one. Executed attempts are removed and counted on every exit.
        """
        tenant = self._get_tenant(tenant_id)
        if agent_id not in tenant.agents:
            raise ValueError(f"Agent {agent_id} not in tenant {tenant_id}")
        agent = tenant.agents[agent_id]
        if task is not None:
            if not any(t is task for t in agent.tasks) or id(task) in self._task_claims:
                raise ValueError("Task must be queued for this agent and unclaimed")
            serving_task = task
        else:
            serving_task = next((t for t in agent.tasks if id(t) not in self._task_claims), None)
        if serving_task is None:
            raise ValueError("Tenant acquisition requires an unclaimed queued task")
        self._task_claims.add(id(serving_task))
        self._pending_acquires[agent_id] = self._pending_acquires.get(agent_id, 0) + 1
        try:
            async with self.resource.acquire_fifo(agent_id, timeout=timeout):
                cost = validate_cost(serving_task.weight)
                limit = tenant.config.cost_ceiling
                if limit is not None and tenant.total_cost + cost > validate_cost(limit):
                    raise TenantCostExceededError(
                        f"Tenant {tenant_id} cost ceiling exceeded: "
                        f"{tenant.total_cost} (admitted) + {cost} (task) > {limit}"
                    )
                tenant.total_cost += cost
                self._admitted_tasks.add(id(serving_task))
                try:
                    yield
                finally:
                    agent.remove_task(serving_task, completed=True)
                    tenant.tasks_completed += 1
                    self._admitted_tasks.discard(id(serving_task))
        finally:
            self._task_claims.discard(id(serving_task))
            self._pending_acquires[agent_id] -= 1
            if not self._pending_acquires[agent_id]:
                del self._pending_acquires[agent_id]

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
