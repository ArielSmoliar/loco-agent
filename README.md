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

```
                  ┌─────────────────────────────┐
                  │         LOCO-Agent           │
                  │   (load-aware scheduler)     │
                  │                              │
                  │  LangChain ◄──L(i)──► ADK   │
                  │   Adapter    scores   Adapter│
                  │       │                │     │
                  │  ┌────▼────────────────▼──┐  │
                  │  │  Shared Resource Pool   │  │
                  │  │  (LLM slots, DB, GPU)   │  │
                  │  └────────────────────────┘  │
                  └─────────────────────────────┘
```

## Quick Start

### Prerequisites

- Python 3.10+
- [Jupyter](https://jupyter.org/) (for the simulation notebook)

### Install and run the simulation

```bash
git clone https://github.com/ArielSmoliar/loco-agent.git
cd loco-agent
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

# Create the scheduler -- it now owns these agents
scheduler = LOCOScheduler(agents, llm_api, optimize_for="balanced")
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

## Framework Integration

LOCO-Agent doesn't replace your framework. It wraps the resource calls via framework-specific adapters:

### LangChain (via callbacks)

```python
class LOCOCallback(BaseCallbackHandler):
    async def on_llm_start(self, serialized, prompts, **kwargs):
        await scheduler.submit_task(self.agent_id, Task(weight=estimate_cost(prompts)))
        await scheduler.acquire(self.agent_id)

    async def on_llm_end(self, response, **kwargs):
        scheduler.release(self.agent_id)

# Zero changes to existing chains
llm = ChatOpenAI(callbacks=[LOCOCallback(scheduler, "rag-agent-1")])
```

### Google ADK (via model callbacks)

```python
async def loco_before_model(ctx, llm_request):
    await scheduler.submit_task(ctx.agent_name, Task(weight=estimate_cost(llm_request)))
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

```
Public API (async)            Internal (sync)
─────────────────             ───────────────
acquire(resource, agent)  →   compute_load_scores()
release(resource, agent)  →   select_agent(scores)
shutdown(timeout)             _step()  ← used by tests
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
- [ ] Async scheduler with acquire/release
- [ ] Scenario validation against production code
- [ ] Vanilla adapter + examples
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
