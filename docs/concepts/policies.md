---
title: "Policy Engine"
description: "Composable policies for cost governance, access control, and rate limiting"
---

# Policy Engine

Composable policies evaluated at dispatch time. The PolicyEnforcer sits between the scheduler's grant decision and task execution, checking each policy in order and short-circuiting on the first rejection.

## Quick Setup

```python
from loco import (
    AsyncLOCOScheduler, Agent, SharedResource,
    PolicyEnforcer, BudgetPolicy, AccessPolicy, RatePolicy,
)

enforcer = PolicyEnforcer([
    BudgetPolicy(default_limit=50.0),
    AccessPolicy(rules={"analyst": {"labels": ["public", "internal"]}}),
    RatePolicy(limits={"batch": 10.0}, period=60.0),
])

scheduler = AsyncLOCOScheduler(
    agents=[Agent(agent_id="analyst"), Agent(agent_id="batch")],
    resource=SharedResource("llm_api", capacity=3),
    enforcer=enforcer,
)
```

## How It Works

Policies are checked **after** the resource is acquired but **before** work executes -- the same point where budget checks ran in v0.2. The enforcer evaluates policies in order and short-circuits on the first rejection:

1. Agent wins a resource slot via L(i) scoring
2. PolicyEnforcer runs each policy's `check()` in order
3. First rejection: resource is released, next waiter gets the slot, `PolicyViolationError` raised
4. All pass: work proceeds, `record()` called on each policy after release

## Built-in Policies

### BudgetPolicy

Per-agent spend limits. Same behavior as v0.2's `BudgetManager` (which is now an alias).

```python
from loco import BudgetPolicy

budget = BudgetPolicy(default_limit=100.0, on_exceeded="reject")
budget.set_limit("expensive-agent", max_cost=50.0)
```

Three enforcement modes: `"reject"` (raise), `"alert"` (allow + log), `"downgrade"` (allow + flag).

See [Budget Management](budgets.md) for full details.

### AccessPolicy

Controls which agents can process tasks with specific security labels. Open by default -- agents not listed in rules are allowed.

```python
from loco import AccessPolicy, SecurityLabel, Task

policy = AccessPolicy(rules={
    "analyst": {"labels": ["public", "internal"]},
    "auditor": {"labels": ["public", "internal", "confidential"]},
})

# Analyst can process public/internal tasks but not confidential
# Auditor can process anything
# Agents not in rules are allowed (open by default)
```

Requires tasks to have labels set:

```python
task = Task(
    weight=2.0,
    labels={"input": SecurityLabel.CONFIDENTIAL, "output": SecurityLabel.INTERNAL},
)
```

### RatePolicy

Per-agent request rate limits using a token bucket algorithm.

```python
from loco import RatePolicy

policy = RatePolicy(
    limits={"batch": 10.0, "realtime": 100.0},
    period=60.0,  # 10 requests per minute for batch, 100 for realtime
)

# Check remaining tokens
policy.remaining("batch")  # 10.0 initially, decreases with each check
```

The bucket refills automatically over time. Burst capacity equals the limit.

## Composing Policies

The PolicyEnforcer evaluates policies in order. Put fast/cheap checks first:

```python
enforcer = PolicyEnforcer([
    RatePolicy(limits={"batch": 10.0}),       # fast: token bucket check
    AccessPolicy(rules={...}),                  # fast: label lookup
    BudgetPolicy(default_limit=100.0),          # fast: spend comparison
])
```

### Adding and Removing at Runtime

```python
enforcer.add_policy(RatePolicy(limits={"new-agent": 5.0}))
enforcer.remove_policy("rate")   # remove by policy name
enforcer.get_policy("budget")    # look up by name
```

### Summary

```python
enforcer.summary()
# {"budget": {"analyst": {"limit": 50.0, "spent": 12.0, "remaining": 38.0}},
#  "access": {"type": "AccessPolicy"},
#  "rate": {"type": "RatePolicy"}}
```

## Writing Custom Policies

Extend the `Policy` base class:

```python
from loco.policy import Policy, PolicyViolationError
from loco.task import Task

class RegionPolicy(Policy):
    """Only allow agents in specific regions."""
    name = "region"

    def __init__(self, allowed_regions: dict[str, list[str]]):
        self._regions = allowed_regions

    def check(self, agent_id: str, task: Task) -> bool:
        if agent_id in self._regions:
            if task.task_type not in self._regions[agent_id]:
                raise PolicyViolationError(
                    self.name, agent_id,
                    f"Task type {task.task_type!r} not allowed in region"
                )
        return True

    def record(self, agent_id: str, task: Task) -> None:
        # Optional: track per-region usage
        pass
```

## Backward Compatibility

The `budget=` parameter still works unchanged:

```python
# v0.2 style -- still works
scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)

# v0.3 style -- policy composition
scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

# Both together -- budget is added to enforcer automatically
scheduler = AsyncLOCOScheduler(agents, resource, budget=budget, enforcer=enforcer)
```

`BudgetManager` is an alias for `BudgetPolicy`. Existing code works without changes.

## Exceptions

| Exception | When |
|-----------|------|
| `PolicyViolationError` | Any policy rejects a task |
| `BudgetExceededError` | Budget policy rejects (subclass of PolicyViolationError) |

```python
from loco import PolicyViolationError, BudgetExceededError

try:
    async with scheduler.acquire("agent"):
        await do_work()
except BudgetExceededError:
    # Handle budget-specific rejection
except PolicyViolationError as e:
    # Handle any policy rejection
    print(f"Policy {e.policy_name} rejected: {e.detail}")
```
