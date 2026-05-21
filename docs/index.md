# LOCO-Agent

**Load-aware scheduling and cost governance for multi-agent AI systems.**

LOCO-Agent sits underneath your agent framework and decides which agent gets the shared resource next -- based on queue depth, wait time, and task cost. One layer gives you bounded concurrency, automatic priority, per-agent budget enforcement, and cross-framework cost visibility.

## Install

```bash
pip install loco-agent
LOCO_LOG=pretty python try_it.py
```

## 30-Second Example

```python
import asyncio
import loco

async def main():
    loco.configure(capacity=2, budget_mode="reject")
    loco.set_budget("analyst", max_cost=10.0)

    async def call_llm(prompt="hello"):
        await asyncio.sleep(0.05)  # your LLM call here
        return f"done: {prompt}"

    results = await asyncio.gather(
        loco.wrap(call_llm, agent_id="analyst",    weight=2.0, prompt="classify ticket"),
        loco.wrap(call_llm, agent_id="analyst",    weight=2.0, prompt="summarize report"),
        loco.wrap(call_llm, agent_id="escalation", weight=5.0, prompt="investigate breach"),
        loco.wrap(call_llm, agent_id="support",    weight=1.0, prompt="draft reply"),
    )
    for r in results:
        print(r)
    print(loco.get_scheduler().metrics.cost_by_agent())

asyncio.run(main())
```

Run with `LOCO_LOG=pretty` to see scheduling decisions in real time:

```bash
LOCO_LOG=pretty python your_app.py
```

```
[ENQUEUE]  analyst        weight=2.0  queue=2.0  (tick 0)
[GRANT]    analyst        score=0.25  waited=0  budget=10.0 remaining  (tick 0)
[ENQUEUE]  escalation     weight=5.0  queue=5.0  (tick 0)
[ENQUEUE]  support        weight=1.0  queue=1.0  (tick 0)
[RELEASE]  analyst        cost=2.0  util=50%  (tick 1)
[GRANT]    escalation     score=1.00  waited=2  (tick 2)
[GRANT]    support        score=0.80  waited=2  (tick 2)
[RELEASE]  escalation     cost=5.0  util=50%  (tick 2)
[RELEASE]  support        cost=1.0  util=0%  (tick 3)
```

## What It Does

| Without LOCO | With LOCO |
|---|---|
| Agents hit the LLM API blindly | Bounded concurrency -- `capacity=3` means max 3 concurrent calls |
| Urgent work stuck behind batch jobs | Automatic priority -- urgent agents escalate via wait time |
| No visibility into agent spend | Cost tracking per agent across all frameworks |
| No budget limits | Per-agent budget enforcement (reject / alert / downgrade) |
| Manual priority tuning | Self-tuning alpha parameter adapts to workload shifts |

## Works With

Anthropic SDK, OpenAI SDK, Google ADK, LangChain, CrewAI, AWS Bedrock, Azure/AutoGen -- or any async Python code.

Run `loco doctor` to detect your installed frameworks and get integration code.

## Next Steps

- [Quick Start](quickstart.md) -- install, configure, and see scheduling output in 5 minutes
- [Concepts](concepts/load-function.md) -- how the load function, ticks, and alpha work
- [API Reference](api.md) -- every class, method, and parameter
- [Adapters](adapters/index.md) -- framework-specific integration guides
