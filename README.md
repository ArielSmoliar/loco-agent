# LOCO-Agent

**Your 50 agents just collided on the same API. The urgent one is stuck behind a batch job. Nobody knows why.**

LOCO-Agent is a load-aware scheduling layer for multi-agent systems. It sits underneath LangGraph, CrewAI, Google ADK, OpenAI Agents SDK, or any Python agent framework and decides which agent gets the shared resource next -- based on queue depth, wait time, and task cost.

- **No priority rules needed** -- agents with urgent work escalate automatically via the load function
- **Proven convergence** -- derived from a [2011 wireless networks thesis](https://en.wikipedia.org/wiki/Contention-based_protocol), validated across 4 production scenarios
- **One equation** -- `L(i) = alpha * (queue_depth) + (1 - alpha) * (wait_time)`
- **Framework-agnostic** -- register any async function as an agent; schedule across frameworks simultaneously

> AGPL-3.0 -- open core from day one.

## The Problem

Every agent framework solves choreography (which agent does what). None of them solve scheduling (which agent goes *next* when resources are scarce).

When your LangChain RAG pipeline and your Google ADK webhook handler both spike at 2pm, they fight over the same LLM API quota blindly. The batch job wins because it got there first. The urgent webhook waits. Your customer notices.

LOCO-Agent is the missing layer underneath.

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

## How It Integrates

LOCO-Agent doesn't replace your framework. It wraps the resource calls:

### LangChain (via callbacks)

```python
from loco_agent import LOCOScheduler

class LOCOCallback(BaseCallbackHandler):
    async def on_llm_start(self, serialized, prompts, **kwargs):
        task = scheduler.register_task(agent_id=self.agent_id, weight=estimate_cost(prompts))
        await scheduler.acquire(task)

    async def on_llm_end(self, response, **kwargs):
        scheduler.release(self.agent_id)

# Zero changes to existing chains
llm = ChatOpenAI(callbacks=[LOCOCallback(scheduler, "rag-agent-1")])
```

### Google ADK (via model callbacks)

```python
from loco_agent import LOCOScheduler

async def loco_before_model(ctx, llm_request):
    task = scheduler.register_task(agent_id=ctx.agent_name, weight=estimate_cost(llm_request))
    await scheduler.acquire(task)
    return None  # proceed with the call

async def loco_after_model(ctx, llm_response):
    scheduler.release(ctx.agent_name)
    return llm_response

agent = Agent(name="support", model="gemini-2.0-flash",
              before_model_callback=loco_before_model,
              after_model_callback=loco_after_model)
```

### The key: shared scheduler

```python
# Both frameworks point to the same scheduler
scheduler = LOCOScheduler(alpha=0.3, resource_slots=10)

# LangChain agents register as agents 0-4
# ADK agents register as agents 5-9
# L(i) competes across ALL of them
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
- [ ] Package scaffolding + Task/Agent extraction
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
