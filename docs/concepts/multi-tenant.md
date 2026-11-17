---
title: "Multi-Tenant Isolation"
description: "Run multiple tenants on a shared resource with cost ceilings"
---

# Multi-Tenant Isolation

MultiTenantScheduler lets multiple tenants share a single resource pool while enforcing per-tenant cost ceilings and agent limits. Tenant calls share FIFO admission; cost accounting and agent registration are scoped per tenant.

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

`submit_task()` checks admitted spend plus pending queue cost before enqueueing.
`acquire()` checks again at grant and charges the task weight before execution.
This closes the preloaded-agent-queue path and includes concurrent in-flight
calls in the ceiling. A grant rejected by `TenantCostExceededError` never enters
the action and releases its slot for the next waiter.

This is process-local task-weight accounting. Failure or cancellation after
admission remains charged; rejection, cancellation, or timeout before admission
is not charged. Provider billing and independent scheduler instances do not share
this ledger.

## Agent Limits

If a tenant tries to register more agents than `max_agents`, the scheduler raises `TenantLimitError`.

## Querying Tenant State

```python
mt.tenant_stats("acme")
# {"tenant_id": "acme", "agent_count": 2, "max_agents": 20,
#  "total_cost": 312.5, "cost_ceiling": 500.0, "cost_remaining": 187.5,
#  "tasks_completed": 12}

mt.tenant_cost("acme")    # 312.5
mt.all_tenants()           # stats for all tenants
```

## Isolation Guarantees

Registration and costs are scoped per tenant. Capacity and wait time are shared:
a tenant burst can increase another tenant's wait. FIFO prevents later tenant
calls from overtaking already queued calls; this is not weighted fair sharing or
reserved per-tenant capacity. `optimize_for` remains accepted for compatibility,
but tenant admission uses FIFO rather than the core LOCO scoring policy.

## Task lifecycle and migration

Each acquire requires an unclaimed queued task. Use `task=task` to bind an exact
submitted object, or omit it to claim the next unclaimed queued task. Empty
queues raise `ValueError` rather than granting unpriced execution.

Executed tasks are automatically removed by identity on exit, including errors
and cancellation. Stop manually dequeueing after the context exits, or you could
remove the next task. `tasks_completed` counts admitted attempts that exited,
including unsuccessful attempts; it is not a success metric.

Rejected or timed-out tasks stay queued. The caller can retry the same task or
remove it with `agent.remove_task(task)`. Active tasks are not counted twice
when validating a later submission. A tenant with active or waiting acquisitions
cannot be unregistered.

```python
await mt.submit_task("acme", "acme_analyst", task)
async with mt.acquire("acme", "acme_analyst", task=task, timeout=1.0):
    await do_work()
# This exact task has already been removed; do not dequeue another one.
```

`timeout` bounds a queued resource wait, not execution time. On timeout, only that
call's waiter and claim are removed; the active holder and other waiters remain
intact. A zero timeout permits immediate admission only.

See [Resource waiting and cleanup](../resource-lifecycle.md) for shared-resource
ordering and multi-resource rollback behavior.
