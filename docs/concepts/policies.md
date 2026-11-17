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
2. PolicyEnforcer reserves each policy in order. The default reservation hook checks permission; BudgetPolicy atomically reserves the task's estimated cost.
3. First rejection: prior budget reservations are cancelled, the resource is released, and the error is raised.
4. All pass: work proceeds. The admitted policies settle on completion, including failures and cancellation. Stateless policies retain their `check()` / `record()` hooks.

## Built-in Policies

### BudgetPolicy

Per-agent limits include settled spend and in-flight reservations. `BudgetManager` remains an alias for `BudgetPolicy`.

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
# {"budget": {"analyst": {"limit": 50.0, "spent": 12.0, "reserved": 0.0, "remaining": 38.0}},
#  "access": {"type": "AccessPolicy"},
#  "rate": {"type": "RatePolicy"}}
```

## Writing Custom Policies

Extend the `Policy` base class. The boolean result is an admission decision:

- Return `True` to allow execution.
- Return `False` to deny. The enforcer raises `PolicyViolationError` with the policy name.
- Raise `PolicyViolationError` directly to provide a specific reason.
- Other return values, including `None`, raise `TypeError` and prevent execution.

A warning-only policy must record its warning separately and return `True`.
The same contract applies to `check_all()` and both scheduler acquire APIs.
Checks happen at admission, so policy changes made while a task waits are honored.

For stateful custom policies, override `reserve()`, `settle_reservation()`, and
`cancel_reservation()`. A `reserve()` override must enforce the decision using
`self._check_or_raise(agent_id, task)` or raise on rejection, and clean up any
partial state if it raises. Its return value is an opaque reservation token,
not a boolean decision. The enforcer does not run checks twice: checks such as
rate limiting can have side effects. The default cancellation hook does nothing;
a custom policy with rollback requirements must implement it.

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

`BudgetManager` is an alias for `BudgetPolicy`.

Migration from 0.4.0: custom policies that returned `False` as a warning must
now return `True` and record that warning separately. Previously the return
value was ignored. Policies that omitted a return must explicitly return `True`
on allowed paths. Built-in budget `alert` and `downgrade` modes still permit
execution, but their `check()` result is now `True`; inspect `budget.alerts`
to detect overages. Exception-based denial is unchanged.

See [Budget reservations and settlement](../budget_reservations.md) for task
association, accounting, and cleanup details.

## Exceptions

| Exception | When |
|-----------|------|
| `PolicyViolationError` | Any policy rejects a task |
| `BudgetExceededError` | Budget policy rejects (subclass of PolicyViolationError) |
| `TypeError` | Custom `check()` returns something other than a bool |

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
