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
3. Budget check runs -- if over budget:
    - Resource is immediately released
    - Next waiting agent gets the slot
    - `BudgetExceededError` is raised (reject mode) or alert recorded (alert mode)
4. If within budget: work proceeds, spend is recorded on release

This design ensures rejected tasks don't inflate cost metrics or emit phantom grant events.

## Checking Budget State

```python
from loco.budget import BudgetManager

budget = scheduler.budget

budget.spent("analyst")       # Cumulative spend
budget.remaining("analyst")   # Budget remaining (None if uncapped)
budget.get_limit("analyst")   # The configured limit
budget.summary()              # Full state for all agents
budget.alerts                 # List of all exceeded events
```

## Resetting Budgets

```python
budget.reset("analyst")   # Reset one agent's spend to 0
budget.reset_all()        # Reset all agents
```

Use this for daily/monthly budget cycles.

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
