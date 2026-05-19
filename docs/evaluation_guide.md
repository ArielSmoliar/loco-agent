# Evaluate LOCO-Agent — 5 Minutes Per Platform

> Pick your platform. Copy the example. See scheduling in action.

## Install

```bash
git clone https://github.com/ArielSmoliar/loco-agent.git
cd loco-agent
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

---

## 1. Google ADK Developer

**You have:** ADK agents hitting Gemini. You want to stop them from colliding on the API.

```python
"""eval_adk.py — Run this to see LOCO scheduling your ADK agents."""
import asyncio
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.google_adk import ADKAdapter

# Your Gemini API allows 3 concurrent requests
scheduler = AsyncLOCOScheduler(
    [], SharedResource("gemini_api", capacity=3),
    optimize_for="balanced",
)
adapter = ADKAdapter(scheduler)

# Simulate 5 ADK agents hitting the API
class FakeCtx:
    def __init__(self, name, model):
        self.agent_name = name
        self.model = model

async def simulate_adk_agent(name, model, n_calls):
    for i in range(n_calls):
        ctx = FakeCtx(name, model)
        await adapter.before_model(ctx, None)
        await asyncio.sleep(0.01)  # simulate Gemini call
        await adapter.after_model(ctx, f"response-{i}")

async def main():
    await asyncio.gather(
        simulate_adk_agent("support-bot", "gemini-2.0-flash", 5),
        simulate_adk_agent("billing", "gemini-2.5-pro", 3),
        simulate_adk_agent("search", "gemini-2.0-flash", 4),
        simulate_adk_agent("analytics", "gemini-2.5-pro", 6),
        simulate_adk_agent("webhook", "gemini-2.0-flash", 2),
    )

    print("Scheduling results:")
    print(f"  Agents: {len(scheduler.agents)}")
    print(f"  Total cost: {scheduler.metrics.total_cost():.1f}")
    for aid in sorted(scheduler.agents):
        agent = scheduler.get_agent(aid)
        cost = scheduler.metrics.agent_cost(aid)
        print(f"  {aid}: {len(agent.completed_tasks)} calls, cost={cost:.1f}")

asyncio.run(main())
```

**What to look for:** All 5 agents complete. No agent starves. Expensive agents (gemini-2.5-pro) get higher scheduling weight. Total cost tracked across the fleet.

**Next step:** Replace `FakeCtx` with real ADK `before_model_callback` / `after_model_callback` on your agents.

---

## 2. Anthropic SDK Developer

**You have:** Claude API calls across multiple agents. You want load-aware scheduling.

```python
"""eval_anthropic.py — Run this to see LOCO scheduling your Claude calls."""
import asyncio
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.anthropic import AnthropicAdapter

# Your Claude API rate limit: 5 concurrent requests
scheduler = AsyncLOCOScheduler(
    [], SharedResource("claude_api", capacity=5),
    optimize_for="balanced",
)

# Mock client (replace with real anthropic.AsyncAnthropic() for live testing)
class MockAnthropicClient:
    class messages:
        @staticmethod
        async def create(**kwargs):
            await asyncio.sleep(0.01)
            class Response:
                content = "Hello!"
                class usage:
                    input_tokens = 100
                    output_tokens = 50
            return Response()

adapter = AnthropicAdapter(scheduler, MockAnthropicClient())

async def main():
    # 4 agents making Claude calls with different models
    tasks = [
        adapter.create("analyst", model="claude-opus-4-20250514",
                       messages=[{"role": "user", "content": "Deep analysis"}]),
        adapter.create("summarizer", model="claude-haiku-4-5-20251001",
                       messages=[{"role": "user", "content": "Quick summary"}]),
        adapter.create("writer", model="claude-sonnet-4-20250514",
                       messages=[{"role": "user", "content": "Draft email"}]),
        adapter.create("analyst", model="claude-opus-4-20250514",
                       messages=[{"role": "user", "content": "Follow-up analysis"}]),
    ]
    await asyncio.gather(*tasks)

    print("Scheduling results:")
    print(f"  Total cost (weight): {scheduler.metrics.total_cost():.1f}")
    print(f"  Total actual tokens: {scheduler.metrics.total_actual_tokens()}")
    for aid in sorted(scheduler.agents):
        cost = scheduler.metrics.agent_cost(aid)
        print(f"  {aid}: cost={cost:.1f}")

asyncio.run(main())
```

**What to look for:** Opus calls (weight=5) get priority over Haiku calls (weight=1). Actual token usage is recorded alongside estimated weight. Cost breakdown by agent.

**Next step:** Replace `MockAnthropicClient` with `anthropic.AsyncAnthropic()`.

---

## 3. OpenAI SDK Developer

**You have:** GPT-4o / o3 calls across multiple services. You want to stop rate limit collisions.

```python
"""eval_openai.py — Run this to see LOCO scheduling your OpenAI calls."""
import asyncio
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.openai import OpenAIAdapter

scheduler = AsyncLOCOScheduler(
    [], SharedResource("openai_api", capacity=3),
    optimize_for="balanced",
)

# Mock client (replace with real openai.AsyncOpenAI())
class MockOpenAIClient:
    class chat:
        class completions:
            @staticmethod
            async def create(**kwargs):
                await asyncio.sleep(0.01)
                class Response:
                    choices = []
                    class usage:
                        total_tokens = 200
                return Response()

adapter = OpenAIAdapter(scheduler, MockOpenAIClient())

async def main():
    tasks = [
        adapter.create("rag-pipeline", model="gpt-4o",
                       messages=[{"role": "user", "content": "Search results"}]),
        adapter.create("chat-bot", model="gpt-4o-mini",
                       messages=[{"role": "user", "content": "Hello"}]),
        adapter.create("code-review", model="o3",
                       messages=[{"role": "user", "content": "Review this code"}]),
        adapter.create("rag-pipeline", model="gpt-4o",
                       messages=[{"role": "user", "content": "More results"}]),
    ]
    await asyncio.gather(*tasks)

    print("Scheduling results:")
    print(f"  Total cost: {scheduler.metrics.total_cost():.1f}")
    for aid in sorted(scheduler.agents):
        cost = scheduler.metrics.agent_cost(aid)
        print(f"  {aid}: cost={cost:.1f}")

asyncio.run(main())
```

**What to look for:** o3 (weight=5) gets priority. gpt-4o-mini (weight=1) doesn't block expensive work. All agents complete despite capacity=3 constraint.

---

## 4. AWS Bedrock Developer

**You have:** Bedrock agents hitting Claude/Titan models. You want cross-agent scheduling.

```python
"""eval_bedrock.py — Run this to see LOCO scheduling your Bedrock agents."""
import asyncio
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.aws_bedrock import BedrockAdapter

scheduler = AsyncLOCOScheduler(
    [], SharedResource("bedrock_api", capacity=5),
    optimize_for="balanced",
)
adapter = BedrockAdapter(scheduler)  # no real client needed for eval

async def main():
    # Simulate 6 Bedrock agents competing
    tasks = [
        adapter.invoke("auditor-1", model_id="anthropic.claude-opus-4-20250514-v1:0"),
        adapter.invoke("auditor-2", model_id="anthropic.claude-opus-4-20250514-v1:0"),
        adapter.invoke("triage", model_id="anthropic.claude-haiku-4-5-20251001-v1:0"),
        adapter.invoke("triage", model_id="anthropic.claude-haiku-4-5-20251001-v1:0"),
        adapter.invoke("analyst", model_id="anthropic.claude-sonnet-4-20250514-v1:0"),
        adapter.invoke("summarizer", model_id="amazon.titan-text-express-v1"),
    ]
    await asyncio.gather(*tasks)

    print("Scheduling results:")
    print(f"  Total cost: {scheduler.metrics.total_cost():.1f}")
    for aid in sorted(scheduler.agents):
        agent = scheduler.get_agent(aid)
        cost = scheduler.metrics.agent_cost(aid)
        print(f"  {aid}: {len(agent.completed_tasks)} calls, cost={cost:.1f}")

asyncio.run(main())
```

**What to look for:** Opus auditors (weight=5) get priority over Haiku triage (weight=1). All 6 agents share the 5-slot capacity fairly. Titan and Claude agents compete through the same scheduler.

---

## 5. Microsoft / AutoGen Developer

**You have:** AutoGen agents in a group chat. You want to schedule message delivery.

```python
"""eval_autogen.py — Run this to see LOCO scheduling your AutoGen agents."""
import asyncio
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.autogen import AutoGenAdapter

scheduler = AsyncLOCOScheduler(
    [], SharedResource("azure_openai", capacity=3),
    optimize_for="balanced",
)
adapter = AutoGenAdapter(scheduler, default_model="gpt-4o")

async def main():
    # Coordinator sends tasks to 4 agents
    tasks = [
        adapter.send_message("coordinator", "analyst", "Analyze Q2 data"),
        adapter.send_message("coordinator", "writer", "Draft the report"),
        adapter.send_message("coordinator", "reviewer", "Review the draft"),
        adapter.send_message("coordinator", "presenter", "Prepare slides"),
    ]
    await asyncio.gather(*tasks)

    # Pub/sub: broadcast to subscribers
    await adapter.publish_message(
        "coordinator", "updates", "Final data ready",
        subscribers=["analyst", "writer", "reviewer"],
    )

    print("Scheduling results:")
    print(f"  Total cost: {scheduler.metrics.total_cost():.1f}")
    for aid in sorted(scheduler.agents):
        agent = scheduler.get_agent(aid)
        cost = scheduler.metrics.agent_cost(aid)
        print(f"  {aid}: {len(agent.completed_tasks)} messages, cost={cost:.1f}")

asyncio.run(main())
```

**What to look for:** All 4 agents receive their messages. Pub/sub delivers to all 3 subscribers. PTU capacity (3 slots) is respected — agents queue when slots are full. Cost tracked per agent.

---

## 6. LangChain Developer

**You have:** LangChain chains hitting OpenAI/Claude. You want per-call scheduling.

```python
"""eval_langchain.py — Run this to see LOCO scheduling your LangChain calls."""
import asyncio
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.langchain import LOCOCallbackHandler

scheduler = AsyncLOCOScheduler(
    [], SharedResource("llm_api", capacity=2),
    optimize_for="balanced",
)

async def simulate_chain(agent_id, model, n_calls):
    cb = LOCOCallbackHandler(scheduler, agent_id)
    for i in range(n_calls):
        await cb.on_llm_start({"kwargs": {"model_name": model}}, [f"prompt {i}"])
        await asyncio.sleep(0.01)  # simulate LLM call
        await cb.on_llm_end(f"response-{i}")

async def main():
    await asyncio.gather(
        simulate_chain("rag-pipeline", "gpt-4o", 5),
        simulate_chain("qa-chain", "gpt-4o-mini", 3),
        simulate_chain("summarizer", "claude-sonnet-4-20250514", 4),
    )

    print("Scheduling results:")
    print(f"  Total cost: {scheduler.metrics.total_cost():.1f}")
    for aid in sorted(scheduler.agents):
        agent = scheduler.get_agent(aid)
        cost = scheduler.metrics.agent_cost(aid)
        print(f"  {aid}: {len(agent.completed_tasks)} calls, cost={cost:.1f}")

asyncio.run(main())
```

**What to look for:** With capacity=2, only 2 LLM calls run at once. The third agent waits and gets scheduled by priority. gpt-4o (weight=3) outprioritizes gpt-4o-mini (weight=1). Mixed Claude/OpenAI models in the same pool.

**Next step:** Attach `LOCOCallbackHandler` as a callback to your real `ChatOpenAI` or `ChatAnthropic` instance.

---

## What All Evaluations Prove

Run any example above and you'll see:

1. **No collisions** — agents respect the capacity limit, no rate limit errors
2. **Automatic priority** — expensive models get served first, no rules needed
3. **No starvation** — cheap agents still complete, just wait a bit longer
4. **Cost visibility** — `scheduler.metrics.cost_by_agent()` shows who's spending
5. **Zero code changes** — your agent logic doesn't change, only the resource access layer

## Going Deeper

```bash
# See all 4 validated scenarios
python sandbox.py --scenario burst
python sandbox.py --scenario webhook_spike --optimize-for latency
python sandbox.py --scenario fairness --alpha 0.5
python sandbox.py --scenario mdash_security

# Run the test suite (254 tests)
pytest

# Read the integration test plans
cat docs/sdk_integration_plans.md
```
