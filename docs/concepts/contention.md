---
title: "Contention Resolution"
description: "How the scheduler resolves contention when multiple agents compete for resources"
---

# Contention Resolution

When multiple agents call `acquire()` and the resource is full, the scheduler resolves contention through a score-and-grant cycle.

## How It Works

1. Agent calls `acquire()` -- if a slot is available, granted immediately
2. If no slot: agent joins the wait queue
3. When any agent calls `release()`:
    - Tick counter increments
    - All waiting tasks age by 1 (Dmax grows)
    - All waiters are re-scored using L(i)
    - Highest scorer gets the slot

```
Agent A (L=0.9) ─── acquire() ──→ [slot available] ──→ granted
Agent B (L=0.6) ─── acquire() ──→ [full] ──→ wait queue
Agent C (L=0.3) ─── acquire() ──→ [full] ──→ wait queue

              ... tasks age each tick ...

Agent A ──── release() ──→ tick++ / re-score all waiters
              B: L=0.7, C: L=0.5 ──→ grant B (highest)

Agent B ──── release() ──→ tick++ / re-score
              C: L=0.8 ──→ grant C
```

## Key Properties

**Not FIFO.** The wait queue is re-scored on every release. An agent that joined second can be granted first if its load score is higher.

**Starvation-proof.** The Dmax term grows every tick an agent waits. Even a low-backlog agent will eventually cross over higher-backlog agents. Urgency emerges from waiting, not from manual rules.

**Backpressure.** If the wait queue exceeds `max_waiters` (default 100), new `acquire()` calls raise `BackpressureError`.

```python
from loco import BackpressureError

try:
    async with scheduler.acquire("agent"):
        await call_llm()
except BackpressureError:
    # System is overloaded -- back off or shed load
    pass
```

**Guaranteed release.** The `async with` context manager ensures the resource is freed even if the agent raises an exception.

## Split Acquire/Release

For callback-based frameworks (ADK, LangChain) where acquire and release happen in separate callbacks:

```python
# In on_llm_start callback:
handle = await scheduler.acquire_start(agent_id)

# In on_llm_end callback:
await scheduler.release_handle(handle)
```

The `AcquireHandle` carries the agent ID and serving task. Safe to call `release_handle()` multiple times -- subsequent calls are no-ops.

## Capacity

`SharedResource(capacity=N)` controls how many agents can hold the resource simultaneously.

| Capacity | Behavior |
|----------|----------|
| 1 | Fully serialized -- one agent at a time |
| 3 | Up to 3 concurrent LLM calls |
| 10 | High concurrency -- minimal contention |

Match capacity to your LLM API rate limit or PTU allocation.
