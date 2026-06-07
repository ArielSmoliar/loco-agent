---
title: "Multi-Tenant Isolation"
description: "Run multiple tenants on a shared resource with cost ceilings"
---

# Multi-Tenant Isolation

MultiTenantScheduler lets multiple tenants share a single resource pool while enforcing per-tenant cost ceilings and agent limits. Each tenant gets isolated scheduling with guaranteed budget boundaries.

## Tenant Registration

```python
from loco import MultiTenantScheduler, Agent
from loco.resource import SharedResource

mt = MultiTenantScheduler(resource=SharedResource("llm", capacity=10))
mt.register_tenant("acme", max_agents=20, cost_ceiling=500.0)
mt.register_tenant("globex", max_agents=10, cost_ceiling=200.0)
```

Each tenant has two hard limits:

- **max_agents** -- maximum number of agents the tenant can register
- **cost_ceiling** -- cumulative cost limit; tasks that would exceed this are rejected

## Agent Registration and Task Submission

Agents are registered under a specific tenant:

```python
mt.register_agent("acme", Agent(agent_id="acme_analyst"))
mt.register_agent("acme", Agent(agent_id="acme_reviewer"))

await mt.submit_task("acme", "acme_analyst", task)
async with mt.acquire("acme", "acme_analyst"):
    await do_work()
```

## Cost Ceilings

When a task would push a tenant's cumulative cost past its ceiling, the scheduler raises `TenantCostExceededError`. This is a hard stop -- the task is not queued or executed.

## Agent Limits

If a tenant tries to register more agents than `max_agents`, the scheduler raises `TenantLimitError`.

## Querying Tenant State

```python
mt.tenant_stats("acme")
# {"cost": 312.5, "agents": 2, "ceiling": 500.0, "remaining": 187.5}

mt.tenant_cost("acme")    # 312.5
mt.all_tenants()           # stats for all tenants
```

## Isolation Guarantees

Tenants share the underlying resource capacity but are otherwise fully isolated. One tenant hitting its cost ceiling or agent limit does not affect other tenants. Budget enforcement, agent registration, and cost tracking are all scoped per tenant.
