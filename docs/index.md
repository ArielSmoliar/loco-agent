# LOCO-Agent

**Load-aware scheduling and cost governance for multi-agent AI systems.**

LOCO-Agent sits underneath your agent framework and decides which agent gets the shared resource next -- based on queue depth, wait time, and task cost. One layer gives you bounded concurrency, automatic priority, per-agent budget enforcement, and cross-framework cost visibility.

## Install

```bash
pip install loco-agent
```

## 30-Second Example

```python
import asyncio
import loco

async def main():
    loco.configure(capacity=3, budget_mode="reject")
    loco.set_budget("analyst", max_cost=50.0)

    async def call_llm(prompt="hello"):
        return f"response: {prompt}"

    result = await loco.wrap(
        call_llm, agent_id="analyst", weight=2.0, prompt="summarize Q2 report"
    )
    print(result)
    print(loco.get_scheduler().metrics.cost_by_agent())

asyncio.run(main())
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
