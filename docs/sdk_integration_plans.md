# SDK Integration Test Plans

> Concrete test scenarios for each supported platform. Each plan shows how to wire LOCO-Agent, what to assert, and a runnable test example.
>
> **v0.1 status:** All platforms work with the core API (`async with scheduler.acquire()`). Callback-based frameworks also work with `acquire_start()` / `release_handle()`. Framework-specific adapter classes are v0.2.

---

## 1. Anthropic Claude SDK

**Pattern:** Direct wrap — `async with acquire()` around `client.messages.create()`.

**Hook:** None needed. The caller owns the API call.

```python
import anthropic
from loco import Agent, AsyncLOCOScheduler, SharedResource, Task

client = anthropic.AsyncAnthropic()
scheduler = AsyncLOCOScheduler(
    [Agent(agent_id="analyst")],
    SharedResource(name="claude_api", capacity=3),
    optimize_for="balanced",
)

async def scheduled_claude_call(prompt: str, model: str = "claude-sonnet-4-20250514"):
    MODEL_COST = {"claude-sonnet-4-20250514": 2.0, "claude-opus-4-20250514": 5.0, "claude-haiku-4-5-20251001": 1.0}
    weight = MODEL_COST.get(model, 2.0)
    await scheduler.submit_task("analyst", Task(weight=weight))

    async with scheduler.acquire("analyst"):
        message = await client.messages.create(
            model=model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        scheduler.get_agent("analyst").serve_oldest_task()
    return message
```

**Test scenario:**
```python
@pytest.mark.asyncio
async def test_anthropic_scheduling():
    """3 agents compete for 1 Claude API slot."""
    agents = [Agent(agent_id=f"agent-{i}") for i in range(3)]
    resource = SharedResource(name="claude_api", capacity=1)
    sched = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")
    served = []

    async def mock_claude_call(agent_id, weight):
        await sched.submit_task(agent_id, Task(weight=weight))
        async with sched.acquire(agent_id):
            sched.get_agent(agent_id).serve_oldest_task()
            served.append(agent_id)
            await asyncio.sleep(0)

    await asyncio.gather(
        mock_claude_call("agent-0", weight=5.0),  # opus
        mock_claude_call("agent-1", weight=1.0),  # haiku
        mock_claude_call("agent-2", weight=2.0),  # sonnet
    )
    assert len(served) == 3
    assert sched.metrics.total_cost() == 8.0
```

**Assertions:**
- All 3 agents served
- Cost tracked correctly (5.0 + 1.0 + 2.0 = 8.0)
- Higher-weight agent (opus) gets priority under contention

---

## 2. OpenAI Agents SDK

**Pattern:** Direct wrap around `client.chat.completions.create()`, or custom `ModelProvider` for deeper integration.

**Hook:** `RunHooks.on_llm_start` / `on_llm_end` (callback-based, uses split API).

```python
from openai import AsyncOpenAI
from loco import AsyncLOCOScheduler, Agent, Task, SharedResource

client = AsyncOpenAI()
scheduler = AsyncLOCOScheduler(
    [Agent(agent_id="assistant")],
    SharedResource(name="openai_api", capacity=5),
    optimize_for="balanced",
)

# Direct wrap (works today)
async def scheduled_openai_call(prompt: str, model: str = "gpt-4o"):
    MODEL_COST = {"gpt-4o": 3.0, "gpt-4o-mini": 1.0, "o3": 5.0}
    weight = MODEL_COST.get(model, 2.0)
    await scheduler.submit_task("assistant", Task(weight=weight))

    async with scheduler.acquire("assistant"):
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
        )
        scheduler.get_agent("assistant").serve_oldest_task()
    return response

# Callback-based (uses split API, for RunHooks integration)
async def on_llm_start(agent_id: str, model: str):
    MODEL_COST = {"gpt-4o": 3.0, "gpt-4o-mini": 1.0, "o3": 5.0}
    await scheduler.submit_task(agent_id, Task(weight=MODEL_COST.get(model, 2.0)))
    return await scheduler.acquire_start(agent_id)

async def on_llm_end(handle):
    scheduler.get_agent(handle.agent_id).serve_oldest_task()
    await scheduler.release_handle(handle)
```

**Test scenario:**
```python
@pytest.mark.asyncio
async def test_openai_split_api():
    """Simulate RunHooks on_llm_start/on_llm_end pattern."""
    sched = AsyncLOCOScheduler([], SharedResource(name="openai", capacity=1))

    # Simulate 3 concurrent LLM calls via split API
    h1 = None

    async def agent_work(name, model):
        nonlocal h1
        handle = await on_llm_start(name, model)
        await asyncio.sleep(0)  # simulate LLM call
        await on_llm_end(handle)

    await asyncio.gather(
        agent_work("rag", "gpt-4o"),
        agent_work("chat", "gpt-4o-mini"),
        agent_work("analysis", "o3"),
    )
    assert sched.metrics.total_cost() == 9.0  # 3 + 1 + 5
```

**Assertions:**
- Split acquire/release works across callback boundary
- Auto-registration creates agents on first submit
- Cost per model tracked correctly

---

## 3. Google ADK

**Pattern:** Callback-based — `before_model_callback` / `after_model_callback` with split acquire/release.

**Hook:** ADK provides `ctx.model` and `ctx.agent_name` in callbacks.

```python
from loco import AsyncLOCOScheduler, Task, SharedResource

scheduler = AsyncLOCOScheduler(
    [], SharedResource(name="gemini_api", capacity=3),
    optimize_for="balanced",
)
MODEL_COST = {"gemini-2.0-flash": 1.0, "gemini-2.5-pro": 3.0, "gemini-2.5-flash": 1.5}

# Store handles between callbacks
_handles = {}

async def loco_before_model(ctx, llm_request):
    weight = MODEL_COST.get(ctx.model, 1.0)
    await scheduler.submit_task(ctx.agent_name, Task(weight=weight))
    handle = await scheduler.acquire_start(ctx.agent_name)
    _handles[ctx.agent_name] = handle
    return None  # proceed with the call

async def loco_after_model(ctx, llm_response):
    handle = _handles.pop(ctx.agent_name)
    scheduler.get_agent(handle.agent_id).serve_oldest_task()
    await scheduler.release_handle(handle)
    return llm_response

# Wire into ADK agent:
# agent = adk.Agent(name="support", model="gemini-2.0-flash",
#                   before_model_callback=loco_before_model,
#                   after_model_callback=loco_after_model)
```

**Test scenario:**
```python
@pytest.mark.asyncio
async def test_adk_callback_pattern():
    """Simulate ADK before_model/after_model with split API."""
    sched = AsyncLOCOScheduler([], SharedResource(name="gemini", capacity=1))
    handles = {}

    # Mock ADK context
    class MockCtx:
        def __init__(self, name, model):
            self.agent_name = name
            self.model = model

    async def simulate_adk_call(name, model):
        ctx = MockCtx(name, model)
        await loco_before_model(ctx, None)
        await asyncio.sleep(0)  # simulate Gemini call
        await loco_after_model(ctx, "response")

    await asyncio.gather(
        simulate_adk_call("support", "gemini-2.0-flash"),
        simulate_adk_call("billing", "gemini-2.5-pro"),
    )
    assert sched.metrics.total_cost() == 4.0  # 1.0 + 3.0
    assert "support" in sched.agents  # auto-registered
    assert "billing" in sched.agents
```

**Assertions:**
- Handles stored/retrieved correctly between callbacks
- Auto-registration from `submit_task`
- Model-to-weight mapping works
- Resource released even if LLM call is fast

---

## 4. LangChain

**Pattern:** Callback-based — `BaseCallbackHandler.on_llm_start` / `on_llm_end` with split acquire/release.

**Hook:** `serialized` dict contains model config, `prompts` contains text.

```python
from langchain_core.callbacks import BaseCallbackHandler
from loco import AsyncLOCOScheduler, Task, SharedResource

scheduler = AsyncLOCOScheduler(
    [], SharedResource(name="llm_api", capacity=3),
    optimize_for="balanced",
)

class LOCOCallback(BaseCallbackHandler):
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self._handle = None

    async def on_llm_start(self, serialized, prompts, **kwargs):
        model = serialized.get("kwargs", {}).get("model_name", "unknown")
        MODEL_COST = {"gpt-4o": 3.0, "claude-sonnet-4-20250514": 2.0, "gpt-4o-mini": 1.0}
        weight = MODEL_COST.get(model, 1.0)
        await scheduler.submit_task(self.agent_id, Task(weight=weight))
        self._handle = await scheduler.acquire_start(self.agent_id)

    async def on_llm_end(self, response, **kwargs):
        if self._handle:
            scheduler.get_agent(self.agent_id).serve_oldest_task()
            await scheduler.release_handle(self._handle)
            self._handle = None

# Wire into LangChain:
# llm = ChatOpenAI(callbacks=[LOCOCallback("rag-agent-1")])
```

**Test scenario:**
```python
@pytest.mark.asyncio
async def test_langchain_callback_pattern():
    """Simulate LangChain on_llm_start/on_llm_end."""
    sched = AsyncLOCOScheduler([], SharedResource(name="llm", capacity=1))

    async def simulate_langchain_call(agent_id, model):
        cb = LOCOCallback(agent_id)
        serialized = {"kwargs": {"model_name": model}}
        await cb.on_llm_start(serialized, ["test prompt"])
        await asyncio.sleep(0)  # simulate LLM
        await cb.on_llm_end("response")

    await asyncio.gather(
        simulate_langchain_call("rag", "gpt-4o"),
        simulate_langchain_call("qa", "gpt-4o-mini"),
    )
    assert sched.metrics.cost_by_agent()["rag"] == 3.0
    assert sched.metrics.cost_by_agent()["qa"] == 1.0
```

---

## 5. CrewAI

**Pattern:** Callback-based — `step_callback` on Agent for per-step scheduling, or direct wrap around `crew.kickoff()` for coarse scheduling.

**Hook:** `step_callback` receives `StepOutput` with agent and tool info.

```python
from loco import AsyncLOCOScheduler, Task, SharedResource

scheduler = AsyncLOCOScheduler(
    [], SharedResource(name="llm_api", capacity=2),
    optimize_for="balanced",
)

# Coarse scheduling (works today) — wrap crew.kickoff()
async def scheduled_crew_run(crew, inputs):
    await scheduler.submit_task("crew-main", Task(weight=3.0))
    async with scheduler.acquire("crew-main"):
        result = crew.kickoff(inputs=inputs)
        scheduler.get_agent("crew-main").serve_oldest_task()
    return result

# Per-step scheduling (v0.2 adapter) — uses step_callback
# def loco_step_callback(step_output):
#     agent_role = step_output.agent.role
#     handle = asyncio.run(scheduler.acquire_start(agent_role))
#     # ... step executes ...
#     asyncio.run(scheduler.release_handle(handle))
```

**Test scenario:**
```python
@pytest.mark.asyncio
async def test_crewai_coarse_scheduling():
    """Two crews compete for shared LLM resource."""
    sched = AsyncLOCOScheduler([], SharedResource(name="llm", capacity=1))
    served = []

    async def mock_crew_run(crew_id, weight):
        await sched.submit_task(crew_id, Task(weight=weight))
        async with sched.acquire(crew_id):
            sched.get_agent(crew_id).serve_oldest_task()
            served.append(crew_id)
            await asyncio.sleep(0)

    await asyncio.gather(
        mock_crew_run("research-crew", 5.0),
        mock_crew_run("writing-crew", 2.0),
    )
    assert len(served) == 2
    assert sched.metrics.total_cost() == 7.0
```

---

## 6. AWS Bedrock Agents

**Pattern:** `RETURN_CONTROL` action group pauses the orchestration loop. LOCO-Agent decides when to resume via `InvokeAgent` with `returnControlInvocationResults`.

**Hook:** Action group configured with `RETURN_CONTROL` in Bedrock agent setup.

```python
import boto3
from loco import AsyncLOCOScheduler, Task, SharedResource

scheduler = AsyncLOCOScheduler(
    [], SharedResource(name="bedrock_api", capacity=5),
    optimize_for="balanced",
)

async def handle_bedrock_return_control(event, agent_id: str):
    """Called when Bedrock agent hits RETURN_CONTROL action group."""
    # Extract model info from the event
    model = event.get("modelId", "anthropic.claude-3-sonnet")
    MODEL_COST = {
        "anthropic.claude-3-sonnet": 2.0,
        "anthropic.claude-3-opus": 5.0,
        "anthropic.claude-3-haiku": 1.0,
    }
    weight = MODEL_COST.get(model, 2.0)

    await scheduler.submit_task(agent_id, Task(weight=weight))
    async with scheduler.acquire(agent_id):
        # Resume the Bedrock agent
        # client.invoke_agent(
        #     agentId=agent_id,
        #     sessionId=event["sessionId"],
        #     returnControlInvocationResults=...
        # )
        scheduler.get_agent(agent_id).serve_oldest_task()
```

**Test scenario:**
```python
@pytest.mark.asyncio
async def test_bedrock_return_control():
    """Simulate RETURN_CONTROL pause/resume pattern."""
    sched = AsyncLOCOScheduler([], SharedResource(name="bedrock", capacity=2))
    resumed = []

    async def simulate_bedrock_agent(agent_id, model_cost):
        await sched.submit_task(agent_id, Task(weight=model_cost))
        async with sched.acquire(agent_id):
            # Simulate resume
            resumed.append(agent_id)
            sched.get_agent(agent_id).serve_oldest_task()
            await asyncio.sleep(0)

    await asyncio.gather(
        simulate_bedrock_agent("auditor-1", 5.0),
        simulate_bedrock_agent("auditor-2", 5.0),
        simulate_bedrock_agent("triage", 1.0),
    )
    assert len(resumed) == 3
    assert sched.metrics.total_cost() == 11.0
```

**Assertions:**
- RETURN_CONTROL pattern maps cleanly to acquire/release
- Multiple Bedrock agents share quota via LOCO scheduling
- AgentCore OTEL telemetry can feed weight estimation (v0.2)

---

## 7. Azure / AutoGen v0.4

**Pattern:** Custom `AgentRuntime` — the most scheduler-friendly surface. Wraps `SingleThreadedAgentRuntime` and adds load-aware dispatch before message delivery.

**Hook:** AutoGen v0.4 `AgentRuntime` interface — implement `send_message` / `publish_message` with scheduling gate.

```python
from loco import AsyncLOCOScheduler, Task, SharedResource

scheduler = AsyncLOCOScheduler(
    [], SharedResource(name="azure_openai", capacity=3),
    optimize_for="balanced",
)

# AutoGen v0.4 custom runtime (conceptual)
# class LOCOAgentRuntime(SingleThreadedAgentRuntime):
#     async def send_message(self, message, recipient, sender):
#         agent_id = str(recipient)
#         weight = estimate_message_cost(message)
#         await scheduler.submit_task(agent_id, Task(weight=weight))
#         async with scheduler.acquire(agent_id):
#             return await super().send_message(message, recipient, sender)

# Foundry Responses API proxy (alternative path)
async def scheduled_foundry_call(agent_id: str, prompt: str):
    await scheduler.submit_task(agent_id, Task(weight=2.0))
    async with scheduler.acquire(agent_id):
        # response = await foundry_client.responses.create(
        #     model="gpt-4o",
        #     input=prompt,
        # )
        scheduler.get_agent(agent_id).serve_oldest_task()
```

**Test scenario:**
```python
@pytest.mark.asyncio
async def test_autogen_runtime_pattern():
    """Simulate AutoGen v0.4 custom runtime with scheduling gate."""
    sched = AsyncLOCOScheduler([], SharedResource(name="azure", capacity=1))
    messages_delivered = []

    async def send_message(sender, recipient, content, weight):
        await sched.submit_task(recipient, Task(weight=weight))
        async with sched.acquire(recipient):
            messages_delivered.append((sender, recipient))
            sched.get_agent(recipient).serve_oldest_task()
            await asyncio.sleep(0)

    await asyncio.gather(
        send_message("coordinator", "analyst", "analyze this", 3.0),
        send_message("coordinator", "writer", "draft report", 2.0),
        send_message("coordinator", "reviewer", "review draft", 1.0),
    )
    assert len(messages_delivered) == 3
    assert sched.metrics.total_cost() == 6.0
```

**Assertions:**
- AutoGen runtime pattern maps to acquire/release per message
- Multiple agents in a group chat share PTU capacity
- Coordinator-style orchestration works with LOCO priority

---

## Cross-Platform Test: Mixed Fleet

The key differentiator — agents from different frameworks sharing one scheduler.

```python
@pytest.mark.asyncio
async def test_cross_framework_scheduling():
    """Anthropic, OpenAI, and ADK agents compete for the same resource pool."""
    sched = AsyncLOCOScheduler(
        [], SharedResource(name="shared_llm", capacity=2),
        optimize_for="balanced",
    )
    served = []

    async def claude_agent():
        await sched.submit_task("claude-analyst", Task(weight=5.0))
        async with sched.acquire("claude-analyst"):
            sched.get_agent("claude-analyst").serve_oldest_task()
            served.append("claude-analyst")
            await asyncio.sleep(0)

    async def openai_agent():
        await sched.submit_task("gpt-summarizer", Task(weight=3.0))
        async with sched.acquire("gpt-summarizer"):
            sched.get_agent("gpt-summarizer").serve_oldest_task()
            served.append("gpt-summarizer")
            await asyncio.sleep(0)

    async def adk_agent():
        await sched.submit_task("gemini-webhook", Task(weight=1.0))
        async with sched.acquire("gemini-webhook"):
            sched.get_agent("gemini-webhook").serve_oldest_task()
            served.append("gemini-webhook")
            await asyncio.sleep(0)

    await asyncio.gather(claude_agent(), openai_agent(), adk_agent())
    assert len(served) == 3
    assert sched.metrics.total_cost() == 9.0
    # All three auto-registered, all three served, framework-agnostic
```
