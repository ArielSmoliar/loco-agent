---
title: "Budget Management"
description: "Per-agent spend limits with automatic enforcement on every acquire() call"
---

# Budget Management

Per-agent spend limits with automatic enforcement on every `acquire()` call.

## Quick Setup

```python
import loco

loco.configure(capacity=3, budget_mode="reject")
loco.set_budget("analyst", max_cost=50.0)
loco.set_budget("batch-processor", max_cost=20.0)
# coordinator has no limit -- uncapped by default
```

## Budget Units

Budget units are **weight units** -- the same as `Task.weight`. Not dollars, not tokens.

| Model tier | Weight | Meaning |
|-----------|--------|---------|
| haiku / gpt-4o-mini | 1.0 | 1 budget unit per call |
| sonnet / gpt-4o | 2.0 | 2 budget units per call |
| opus / o1 | 5.0 | 5 budget units per call |

A budget of 50.0 means: the agent can make 25 sonnet-class calls (weight=2.0 each), or 10 opus-class calls (weight=5.0 each), or any mix that sums to 50.

## Enforcement Modes

| Mode | What happens when budget is exceeded |
|------|------|
| `"reject"` | Raises `BudgetExceededError`. Resource is released and given to the next waiting agent. |
| `"alert"` | Task proceeds. An alert is recorded. Budget overspend is tracked. |
| `"downgrade"` | Task proceeds. Flagged for model tier downgrade. |

```python
from loco.budget import BudgetExceededError

try:
    result = await loco.wrap(call_llm, agent_id="analyst", weight=2.0)
except BudgetExceededError as e:
    print(f"Agent {e.agent_id} over budget: spent {e.current}, limit {e.limit}")
```

## How Enforcement Works

Budget is checked **after** the resource is acquired but **before** the work executes. This means:

1. Agent waits in the scheduling queue like normal
2. Agent wins a resource slot via L(i) scoring
3. Atomically check settled spend + in-flight reservations + this task estimate. If over budget:
    - Reject mode releases the slot, wakes the next waiter, and raises `BudgetExceededError`.
    - Alert and downgrade modes record a warning, retain the slot, and continue.
4. If allowed: reserve the estimate before work starts, then replace that reservation with settled spend on release

This design ensures rejected tasks don't inflate cost metrics or emit phantom grant events.
Concurrent admissions share a process-local ledger when they share the same
BudgetPolicy object. Separate processes do not share this ledger. See
[Budget reservations and settlement](../budget_reservations.md) for details.

`check()` alone does not reserve budget. It returns `True` when execution is
allowed, including advisory `alert` and `downgrade` overages; inspect `alerts`
for those warnings. Reject mode raises `BudgetExceededError`.

## Checking Budget State

```python
from loco.budget import BudgetManager

budget = scheduler.budget

budget.spent("analyst")       # Settled spend
budget.reserved("analyst")    # In-flight commitments
budget.remaining("analyst")   # Limit minus spend and reservations (None if uncapped)
budget.get_limit("analyst")   # The configured limit
budget.summary()              # Full state for all agents
budget.alerts                 # List of all exceeded events
```

## Session Cost Tracking

Tag tasks with a `session_id` to track costs per session (request, workflow, conversation):

```python
from loco import Task

task = Task(weight=2.0, session_id="req-abc123")
```

Query session costs:

```python
scheduler.metrics.cost_by_session()
# {"req-abc123": 17.0, "req-def456": 8.0}

scheduler.metrics.session_cost("req-abc123")
# 17.0

scheduler.metrics.cost_by_session_and_agent("req-abc123")
# {"analyst": 12.0, "reviewer": 5.0}

scheduler.metrics.sessions()
# ["req-abc123", "req-def456"]
```

Tasks without `session_id` are tracked in agent totals but not in session rollups.

## Resetting Budgets

```python
budget.reset("analyst")   # Reset one agent's spend to 0
budget.reset_all()        # Reset all agents
```

Use this for daily/monthly budget cycles once in-flight reservations have settled.
Resetting a budget with outstanding reservations raises `RuntimeError`.

## Full API (BudgetManager)

For direct use without the convenience API:

```python
from loco import AsyncLOCOScheduler, SharedResource
from loco.budget import BudgetManager

budget = BudgetManager(default_limit=100.0, on_exceeded="reject")
budget.set_limit("expensive-agent", max_cost=50.0)

scheduler = AsyncLOCOScheduler(
    agents, resource,
    budget=budget,  # wired into acquire() automatically
)
```

## Pretty Output

With `LOCO_LOG=pretty`, budget events show in the terminal:

```
[BUDGET]   investigator   spend=12.0 + task=3.0 > limit=12.0 [reject]  (tick 29)
[GRANT]    analyst        score=0.82  waited=3  budget=12.50 remaining  (tick 30)
```
