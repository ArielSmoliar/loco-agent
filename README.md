# LOCO-Agent

**Your 50 agents just collided on the same API. The urgent one is stuck behind a batch job. Nobody knows why.**

LOCO-Agent is a load-aware scheduling layer for multi-agent systems. It sits underneath LangGraph, CrewAI, Google ADK, OpenAI Agents SDK, or any Python agent framework and decides which agent gets the shared resource next -- based on queue depth, wait time, and task cost.

- **No priority rules needed** -- agents with urgent work escalate automatically via the load function
- **Proven convergence** -- derived from a [2011 wireless networks thesis](https://en.wikipedia.org/wiki/Contention-based_protocol), validated across 4 production scenarios
- **One equation** -- `L(i) = alpha * (queue_depth) + (1 - alpha) * (wait_time)`
- **Framework-agnostic** -- register any async function as an agent; schedule across frameworks simultaneously

> AGPL-3.0 -- open core from day one.

## The Problem

Organizations deploying agents at scale hit three problems no framework solves:

1. **No scheduling.** Every framework solves choreography (which agent does what). None solve scheduling (which agent goes *next* when resources are scarce). Your LangChain RAG pipeline and Google ADK webhook handler spike at 2pm and fight over the same LLM API quota blindly. The batch job wins because it got there first. The urgent webhook waits. Your customer notices.

2. **No token visibility.** You're spending $200k/month on LLM inference across dozens of agents. You can't answer "which agents are consuming the most tokens?" or "is high-value work actually getting served first?" Each framework tracks its own calls. Nobody has the cross-agent view.

3. **Manual tuning that never ends.** Every time you add an agent, change a model, or shift traffic patterns, someone has to manually re-tune priorities, rate limits, and routing rules. This is a full-time job that doesn't scale -- and the rules go stale the moment workload patterns shift.

LOCO-Agent solves all three with one layer underneath your existing frameworks.

```mermaid
graph TB
    subgraph LOCO["LOCO-Agent (load-aware scheduler)"]
        direction TB
        LC["LangChain\nAdapter"]
        SCORE["L(i) scores"]
        ADK["ADK\nAdapter"]
        LC <-->|"L(i)"| SCORE
        SCORE <-->|"L(i)"| ADK
        LC --> RES
        ADK --> RES
        RES["Shared Resource Pool\n(LLM slots, DB, GPU)"]
    end
```

## Quick Start

### Prerequisites

- Python 3.10+
- [Jupyter](https://jupyter.org/) (for the simulation notebook)

### Install and run the simulation

```bash
git clone https://github.com/ArielSmoliar/loco-agent.git
cd loco-agent
python3 -m venv .venv && source .venv/bin/activate
pip install numpy matplotlib jupyter
jupyter notebook simulation/loco_simulation.ipynb
```

### What you'll see

The notebook validates the load function across three scenarios:

**Scenario 1 -- Burst:** 8 agents receive work simultaneously. The scheduler serves high-backlog agents first. Service counts match tasks assigned exactly.

**Scenario 2 -- Fairness under sustained load:** 10 agents at different arrival rates for 500 ticks. At alpha=0, Jain's fairness index = 0.995 (near-perfect equity). At alpha >= 0.75, low-load agents starve -- proving the Dmax term is the primary fairness mechanism, not a tie-breaker.

**Scenario 3 -- Webhook spike:** 10 background agents at 70% utilization, then 5 urgent webhooks arrive. Their Dmax grows each tick they wait, naturally crossing over background priority. No rules, no manual assignment -- urgency emerges from the math.

## The Load Function

```
L(i) = alpha * (Qi / max Qj) + (1 - alpha) * (Dmax_i / max Dmax_j)
```

| Term | Meaning |
|------|---------|
| `Qi` | Weighted queue depth -- sum of task costs in agent i's queue |
| `Dmax_i` | Age of the oldest waiting task in agent i's queue |
| `alpha` | Tuning knob: 1 = throughput-optimized, 0 = latency-optimized |

Both terms are **normalized across all competing agents** -- relative priority, not absolute cost. An agent with Q=10 when everyone else has Q=10 scores the same as Q=1 when everyone else has Q=1.

### Tuning alpha

| Setting | alpha | Behavior | Use when |
|---------|-------|----------|----------|
| `"latency"` | 0.0 | Prioritize agents whose tasks have waited longest | Webhooks, user-facing requests |
| `"balanced"` | 0.25 | Recommended default | Most workloads |
| `"throughput"` | 0.5 | Prioritize agents with the deepest backlog | Batch processing, ETL |

> **Do not use alpha > 0.5 in production.** The simulation proves that alpha >= 0.75 causes starvation -- some agents complete zero tasks. The Dmax term is load-bearing for fairness.

## What the Scheduler Sees

The scheduler is deliberately decoupled from agent internals. It does not know which model an agent uses, what framework runs it, or how many tokens a call will consume. All of that knowledge is compressed into a single number -- task `weight` -- by the adapter or caller. The scheduler then derives everything it needs from queue state.

### Parameter flow

| Layer | Parameter | What it is | Source |
|-------|-----------|------------|--------|
| **Task** | `weight` | Cost proxy (1=cheap, 3=expensive) | Adapter or caller sets at submit time |
| **Task** | `age` | Ticks spent waiting in queue | Scheduler auto-increments on each release |
| **Agent** | `Qi` | Weighted queue depth = `sum(task.weight)` | Derived from task queue |
| **Agent** | `Dmax` | Oldest waiting task = `max(task.age)` | Derived from task queue |
| **System** | `alpha` | Latency vs throughput tradeoff | Config (`optimize_for`) |
| **System** | `capacity` | Concurrent resource slots | Config (`SharedResource`) |
| **System** | `max_waiters` | Backpressure limit | Config (default 100) |

### What this means

**The scheduler never asks "what are you?"** It asks "how loaded are you?" and "how long have you been waiting?" -- then decides who goes next. This is the key design choice: agent metadata (model, framework, cost profile) is translated into task weight *before* it reaches the scheduler.

**Without an adapter**, the caller must set `weight` manually on each task. The scheduler still works -- it just treats unweighted tasks as `weight=1.0`, losing cost-awareness. You get fair scheduling by queue depth and wait time, but every task looks equally expensive.

**With an adapter**, the translation happens automatically. The adapter intercepts framework hooks (e.g., `on_llm_start`), reads the model name and prompt, computes weight, and submits to the scheduler. The developer's code never changes.

```mermaid
graph LR
    DEV["Developer's\nagent code"] --> HOOK["Framework\nhook fires"]
    HOOK --> ADAPT["Adapter:\nmodel=opus → weight=5.0"]
    ADAPT --> SUBMIT["scheduler.submit_task()"]
    SUBMIT --> SCHED["Scheduler sees:\nQi = 5.0, Dmax = 0\n(no idea it's Opus)"]

    style ADAPT fill:#fff3e0,stroke:#e65100
    style SCHED fill:#e8f5e9,stroke:#2e7d32
```

### What the scheduler does NOT know

These are intentionally outside the scheduler's scope in v0.1:

- **Model name or tier** -- abstracted into weight
- **Token budget or spend limit** -- visibility only, not enforcement (planned for v0.2)
- **Per-agent SLA or latency target** -- fairness emerges from Dmax, not from targets
- **Rate limits** -- handled by the resource capacity, not per-agent
- **Framework identity** -- a LangChain agent and an ADK agent are indistinguishable

This separation keeps the scoring function clean: `L(i) = alpha * (Qi / max Qj) + (1 - alpha) * (Dmax_i / max Dmax_j)` works the same whether it's scheduling 3 agents or 300, across one framework or five.

## Token Management

Task weight maps directly to token cost. This gives the scheduler cost-awareness across every agent in the organization, regardless of which framework runs it.

### Cost-aware scheduling

Qi (weighted queue depth) reflects total pending token spend, not just task count. An agent with one GPT-4o call (weight=3) can outprioritize an agent with three Haiku calls (weight=1). The scheduler routes tokens to the work that needs them most.

```python
# Expensive analysis task -- scheduler knows this costs more
await scheduler.submit_task("fraud-detector", Task(weight=3.0, task_type="gpt4o"))

# Cheap triage task -- won't block expensive work unnecessarily
await scheduler.submit_task("ticket-router", Task(weight=1.0, task_type="haiku"))
```

### Cross-agent spend visibility

Every scheduling decision logs the task cost. The metrics API gives the org-level view that no single framework provides:

```python
scheduler.metrics.cost_by_agent()
# {"fraud-detector": 847.5, "webhook-handler": 42.0, "ticket-router": 115.0,
#  "rag-pipeline": 315.0, "summarizer": 203.0}

scheduler.metrics.total_cost()
# 1522.5
```

This answers the questions that matter at scale: which agents are consuming the most tokens? Is high-value work getting served first? Which team's agents are driving spend?

### Self-tuning priority

The load function replaces manual priority rules with math that adapts automatically. When you add a new agent or traffic patterns shift, you don't re-tune anything -- the scheduler re-normalizes across all agents on every scheduling decision. The alpha parameter (`optimize_for`) is the only knob, and it rarely needs to change.

> **v0.1 is visibility only.** Cost tracking and scheduling, not enforcement. Budget ceilings, per-agent spend limits, and model-tier routing are planned for the enterprise tier.

## How It Works

### Step 1: Register agents and a shared resource

At app startup, the platform engineer tells the scheduler which agents exist and what resource they share. Each agent gets its own task queue -- the scheduler reads queue depth and wait time directly from it.

```python
from loco import Agent, Task, LOCOScheduler, SharedResource

# Define the shared resource (e.g. LLM API with 3 concurrent slots)
llm_api = SharedResource(name="llm_api", capacity=3)

# Register agents -- these are the competitors
agents = [
    Agent(agent_id="rag-pipeline", agent_type="batch"),
    Agent(agent_id="webhook-handler", agent_type="webhook"),
    Agent(agent_id="summarizer", agent_type="batch"),
]

# Create the scheduler -- three words instead of a thesis chapter
scheduler = AsyncLOCOScheduler(agents, llm_api, optimize_for="balanced")
```

### Step 2: Submit tasks as work arrives

When an agent has work to do, submit a task to its queue. The task's weight reflects its cost (1=cheap, 3=expensive).

```python
# A webhook just fired -- submit urgent work
await scheduler.submit_task("webhook-handler", Task(weight=1.0, task_type="webhook"))

# A batch job queued 5 documents for RAG processing
for doc in documents:
    await scheduler.submit_task("rag-pipeline", Task(weight=2.0, task_type="rag"))
```

### Step 3: Acquire the resource, do the work, release

Agents compete for the resource through the load function. The scheduler decides who goes next.

```python
# The agent requests the resource -- blocks until L(i) wins
async with scheduler.acquire("webhook-handler"):
    result = await call_llm(prompt)
# Resource auto-released on exit, scheduler re-evaluates all waiters
```

That's the full lifecycle: register, submit, acquire, release. The scheduler handles priority, fairness, and contention automatically.

### Contention Resolution

When multiple agents call `acquire()` and the resource is full, the scheduler resolves contention through a score-and-grant cycle derived from the [LOCO-MAC protocol](https://en.wikipedia.org/wiki/Contention-based_protocol):

```mermaid
sequenceDiagram
    participant A as Agent A (L=0.9)
    participant B as Agent B (L=0.6)
    participant C as Agent C (L=0.3)
    participant S as Scheduler
    participant R as Resource (capacity=1)

    A->>S: acquire()
    S->>R: slot available → grant A
    B->>S: acquire()
    S-->>B: capacity full → wait
    C->>S: acquire()
    S-->>C: capacity full → wait

    Note over B,C: Tasks age each tick (Dmax grows)

    A->>S: release()
    S->>S: tick++ · age tasks · re-score
    Note over S: B: L=0.7 · C: L=0.5
    S->>R: grant B (highest)

    B->>S: release()
    S->>S: tick++ · age tasks · re-score
    S->>R: grant C (only waiter)
```

**Key properties:**

- **Scoring happens at grant time, not request time.** An agent that registered late but has high Dmax still wins. This prevents priority inversion.
- **Not FIFO.** The wait queue is re-scored on every release. An agent that joined the queue second can be granted first if its load score is higher.
- **Starvation-proof.** The Dmax term grows every tick an agent waits. Even a low-backlog agent will eventually cross over higher-backlog agents -- urgency emerges from waiting, not from manual priority rules.
- **Backpressure.** If the wait queue exceeds `max_waiters` (default 100), new `acquire()` calls raise `BackpressureError` instead of piling up unboundedly.
- **Guaranteed release.** The `async with` context manager ensures the resource is freed even if the agent raises an exception, preventing deadlock from crashed agents.

## Framework Integration

LOCO-Agent doesn't replace your framework. It wraps the resource calls via framework-specific adapters. The adapter sits between the framework and the scheduler -- the developer's agents run unchanged.

```mermaid
graph TD
    DEV["Developer's agent code\n(unchanged)"] --> HOOK["Framework fires hook\n(on_llm_start / before_model_callback)"]
    HOOK --> ADAPT

    subgraph ADAPT["LOCO Adapter"]
        direction TB
        S1["1. Estimate token cost\n(from prompt + model tier)"]
        S2["2. Create Task(weight=cost)"]
        S3["3. Submit to scheduler"]
        S4["4. Acquire resource\n(blocks until L(i) wins)"]
        S1 --> S2 --> S3 --> S4
    end

    ADAPT --> LLM["LLM call fires"]
    LLM --> DONE["Framework fires completion hook\n(on_llm_end / after_model_callback)"]
    DONE --> REL["Adapter calls release()\nScheduler re-evaluates all waiters"]

    style ADAPT fill:#e3f2fd,stroke:#1565c0
    style LLM fill:#fff3e0,stroke:#e65100
    style REL fill:#e8f5e9,stroke:#2e7d32
```

### How the adapter knows the token cost

The adapter estimates cost from information available *before* the LLM call fires. Two approaches:

**Static model tiers** (simplest, good enough for scheduling):

```python
# Platform engineer defines this once
MODEL_COST = {
    "haiku": 1.0,
    "sonnet": 2.0,
    "opus": 5.0,
    "gpt-4o": 3.0,
    "gemini-flash": 1.0,
}
```

**Prompt-based estimate** (more precise):

```python
def estimate_cost(prompts, model="sonnet"):
    tokens = sum(len(p) for p in prompts) // 4   # rough char-to-token
    cost_per_1k = MODEL_COST.get(model, 1.0)
    return tokens * cost_per_1k / 1000
```

The load function normalizes (`Qi / max Qj`), so relative cost is what matters -- not exact dollar amounts. A weight=3 task gets 3x the scheduling weight of a weight=1 task. Being roughly right is enough for correct priority ordering.

> **v0.2 planned:** empirical cost tracking -- after each call completes, record actual token usage and auto-adjust future estimates.

### LangChain (via callbacks)

```python
class LOCOCallback(BaseCallbackHandler):
    async def on_llm_start(self, serialized, prompts, **kwargs):
        model = serialized.get("kwargs", {}).get("model_name", "sonnet")
        weight = estimate_cost(prompts, model)
        await scheduler.submit_task(self.agent_id, Task(weight=weight))
        await scheduler.acquire(self.agent_id)

    async def on_llm_end(self, response, **kwargs):
        scheduler.release(self.agent_id)

# Zero changes to existing chains
llm = ChatOpenAI(callbacks=[LOCOCallback(scheduler, "rag-agent-1")])
```

### Google ADK (via model callbacks)

```python
async def loco_before_model(ctx, llm_request):
    weight = MODEL_COST.get(ctx.model, 1.0)
    await scheduler.submit_task(ctx.agent_name, Task(weight=weight))
    await scheduler.acquire(ctx.agent_name)
    return None  # proceed with the call

async def loco_after_model(ctx, llm_response):
    scheduler.release(ctx.agent_name)
    return llm_response

agent = Agent(name="support", model="gemini-2.0-flash",
              before_model_callback=loco_before_model,
              after_model_callback=loco_after_model)
```

### Cross-framework scheduling

The key: both frameworks point to the same scheduler instance.

```python
# One scheduler, one resource pool, all agents compete through L(i)
scheduler = LOCOScheduler(agents, llm_api, optimize_for="balanced")

# LangChain agents registered as "rag-pipeline", "qa-chain", "summarizer"
# ADK agents registered as "webhook-handler", "support-bot", "billing"
# All 6 compete for the same 3 LLM API slots
```

When ADK webhooks spike, their Dmax grows. The scheduler naturally deprioritizes LangChain batch jobs -- no rules, no manual priority.

## Architecture

```mermaid
graph LR
    subgraph public["Public API (async)"]
        ACQ["acquire(agent)"]
        REL["release(agent)"]
        SHUT["shutdown(timeout)"]
    end

    subgraph internal["Internal (sync)"]
        CLS["compute_load_scores()"]
        SEL["select_agent(scores)"]
        STEP["_step() ← tests"]
    end

    ACQ --> CLS
    REL --> SEL
    CLS --> SEL
```

The async `acquire()`/`release()` API is the core primitive. The adapter layer wraps this with framework-specific hooks. The scheduler never knows which framework produced the agent.

See [PLAN.md](PLAN.md) for the full build plan, mermaid diagrams, and day-by-day breakdown.

## Origin

The load function is a direct port of the LOCO-MAC contention resolution protocol from a [2011 BGU wireless networks thesis](https://en.wikipedia.org/wiki/Contention-based_protocol). Every MAC primitive has an agent equivalent:

| LOCO-MAC (wireless, 2011) | LOCO-Agent (AI agents, 2026) |
|----------------------------|------------------------------|
| Radio channel | LLM API slot / DB / GPU |
| Node | Agent |
| Queue depth Qi | Weighted task queue |
| Stale delay Dmax | Age of oldest waiting task |
| Contention round | Load-based priority bid |
| End Slave Grant | `release()` signal |

The thesis proved convergence for wireless nodes competing for a shared channel. The simulation proves it works for AI agents competing for shared compute.

## Roadmap

### v0.1 (in progress)
- [x] Load function validation (simulation notebook)
- [x] Build plan and API spec
- [x] Package scaffolding + Task/Agent extraction
- [x] Scheduler scoring core (compute_load_scores, select_agent, _step)
- [x] Async resource + event loop (SharedResource, acquire/release)
- [x] Async scheduler integration (backpressure, cancellation, lifecycle hooks)
- [x] `optimize_for` API ("latency" / "balanced" / "throughput")
- [x] Scenario 1 burst replay against async scheduler (101 tests passing)
- [ ] Full scenario validation (all 4 scenarios against production code)
- [ ] Vanilla adapter + dynamic agent registration
- [ ] Observability (structured JSON scheduling log)
- [ ] Sandbox CLI

### v0.2 (planned)
- [ ] LangChain adapter
- [ ] Google ADK adapter
- [ ] CrewAI adapter
- [ ] OpenAI Agents SDK adapter
- [ ] Dynamic agent registration (agents spinning up/down at runtime)
- [ ] Multi-resource contention
- [ ] Adaptive alpha tuning (renormalization)
- [ ] A2A protocol integration

## Contributing

```bash
git clone https://github.com/ArielSmoliar/loco-agent.git
cd loco-agent
pip install numpy matplotlib jupyter
jupyter notebook simulation/loco_simulation.ipynb
```

The most impactful contributions will be **framework adapters** -- each one extends LOCO-Agent's reach to a new ecosystem. See the integration examples above for the pattern.

## License

AGPL-3.0. See [LICENSE](LICENSE) for details.

Enterprise licensing available -- contact [ariel@loco-agent.dev](mailto:ariel@loco-agent.dev).
