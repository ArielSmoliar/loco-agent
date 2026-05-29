# Quick Start

Get LOCO-Agent running in 5 minutes. No API keys needed.

## Install

```bash
pip install loco-agent
```

## Option 1: One-Line Wrapper (simplest)

```python
import asyncio
import loco

async def main():
    # Configure once at startup
    loco.configure(capacity=3, optimize_for="balanced")

    # Wrap any async LLM call
    async def my_llm_call(**kwargs):
        # Replace with your actual LLM client call
        return f"Response using {kwargs.get('model', 'default')}"

    # LOCO handles scheduling, contention, and cost tracking
    result = await loco.wrap(
        my_llm_call,
        agent_id="analyst",
        weight=2.0,  # cost proxy: 1=cheap, 5=expensive
        model="sonnet",
    )
    print(result)

    # See what happened
    scheduler = loco.get_scheduler()
    print(f"Cost by agent: {scheduler.metrics.cost_by_agent()}")
    print(f"Total cost: {scheduler.metrics.total_cost()}")

asyncio.run(main())
```

## Option 2: Decorator

```python
import asyncio
import loco

loco.configure(capacity=3)

@loco.scheduled(agent_id="webhook", weight=1.0)
async def handle_webhook(payload):
    # Your LLM call here
    return f"Handled: {payload}"

async def main():
    result = await handle_webhook("incoming event")
    print(result)

asyncio.run(main())
```

## Option 3: Full Control (acquire/release)

```python
import asyncio
from loco import Agent, Task, AsyncLOCOScheduler, SharedResource

async def main():
    resource = SharedResource("llm_api", capacity=1)
    agents = [Agent(agent_id="urgent"), Agent(agent_id="batch")]
    scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

    # Submit tasks with different weights
    await scheduler.submit_task("urgent", Task(weight=3.0))
    for _ in range(5):
        await scheduler.submit_task("batch", Task(weight=1.0))

    # Agents compete for the resource
    async def worker(agent_id, n):
        for _ in range(n):
            async with scheduler.acquire(agent_id):
                scheduler.get_agent(agent_id).serve_oldest_task()
                await asyncio.sleep(0)

    await asyncio.gather(worker("urgent", 1), worker("batch", 5))
    print(scheduler.metrics.cost_by_agent())

asyncio.run(main())
```

## Add Budget Enforcement

```python
import loco

loco.configure(capacity=3, budget_mode="reject")
loco.set_budget("analyst", max_cost=50.0)
loco.set_budget("batch", max_cost=20.0)

# Analyst can spend up to 50 weight units before being rejected
# Budget units = weight units (opus call at weight=5 costs 5 units)
```

Three enforcement modes:

| Mode | Behavior |
|------|----------|
| `"reject"` | Raises `BudgetExceededError`, frees the resource for the next agent |
| `"alert"` | Allows the task, logs a warning, records the alert |
| `"downgrade"` | Allows the task, flags for model downgrade |

## Add Policy Enforcement

Compose multiple policies -- budget limits, access control, and rate limiting in one enforcer:

```python
from loco import (
    AsyncLOCOScheduler, Agent, SharedResource,
    PolicyEnforcer, BudgetPolicy, AccessPolicy, RatePolicy,
    SecurityLabel, Task,
)

enforcer = PolicyEnforcer([
    BudgetPolicy(default_limit=100.0, on_exceeded="reject"),
    AccessPolicy(rules={"analyst": {"labels": ["public", "internal"]}}),
    RatePolicy(limits={"batch": 10.0}, period=60.0),
])

scheduler = AsyncLOCOScheduler(
    agents=[Agent(agent_id="analyst"), Agent(agent_id="batch")],
    resource=SharedResource("llm_api", capacity=3),
    enforcer=enforcer,
)
```

See [Policy Engine](concepts/policies.md) for details.

## See Scheduling in Action

Set `LOCO_LOG=pretty` for colored terminal output:

```bash
LOCO_LOG=pretty python your_app.py
```

Output:

```
[ENQUEUE]  analyst        weight=2.0  queue=2.0  (tick 0)
[GRANT]    analyst        score=0.82  waited=3  budget=12.50 remaining  (tick 3)
[RELEASE]  analyst        cost=2.0  util=33%  (tick 3)
[BUDGET]   investigator   spend=12.0 + task=3.0 > limit=12.0 [reject]  (tick 29)
```

## Detect Your Frameworks

```bash
loco doctor
```

Output:

```
LOCO Doctor
============================================================

Detected frameworks:
  + Anthropic SDK    v0.45.x      -> loco.adapters.anthropic.AnthropicAdapter
  + LangChain        v0.3.x       -> loco.adapters.langchain.LOCOCallbackHandler

Quick start (Anthropic SDK):
  ...
```

## Run the Example Scripts

```bash
git clone https://github.com/ArielSmoliar/loco-agent.git
cd loco-agent

python examples/burst.py            # 8 agents, simultaneous work
python examples/fairness.py         # 10 agents, sustained load
python examples/webhook_spike.py    # Background + urgent spike
python examples/mdash_security.py   # Multi-model cost routing
```

## Next

- [Load Function](concepts/load-function.md) -- how the scheduling equation works
- [Budget Management](concepts/budgets.md) -- cost governance deep dive
- [Policy Engine](concepts/policies.md) -- composable policies for cost governance
- [Execution Plans](concepts/plans.md) -- DAG-based task orchestration
- [SLO Error Budgets](concepts/slo.md) -- monitor scheduling quality
- [Adapters](adapters/index.md) -- integrate with your framework
