# Load Function

The load function is the core equation that decides which agent gets the resource next.

## The Equation

```
L(i) = alpha * (Qi / max Qj) + (1 - alpha) * (Dmax_i / max Dmax_j)
```

| Term | What it is |
|------|-----------|
| `Qi` | Weighted queue depth -- sum of `task.weight` in agent i's queue |
| `Dmax_i` | Age of the oldest waiting task (measured in ticks) |
| `alpha` | Tradeoff: 0.0 = latency-first, 0.5 = throughput-first |

Both terms are normalized across all competing agents. An agent with Q=10 when everyone else has Q=10 scores the same as Q=1 when everyone else has Q=1. Relative load, not absolute.

The agent with the **highest** L(i) gets the resource next.

## Ticks

A tick is one unit of work completed -- not wall clock time. Each `release()` increments the tick counter and ages all waiting tasks by 1.

- Under heavy load: ticks fire fast, priority shifts quickly
- Under low load: ticks fire slowly, priority barely shifts
- No contention: no scoring needed, immediate grant

Priority only shifts when there's actual contention. This is by design -- scheduling overhead is zero when the system isn't loaded.

## Alpha

Alpha controls the tradeoff between latency (serve longest-waiting agents) and throughput (serve deepest-backlog agents).

| Setting | alpha | Behavior | Use when |
|---------|-------|----------|----------|
| `"latency"` | 0.0 | Serve longest-waiting agents first | Webhooks, user-facing requests |
| `"balanced"` | 0.25 | Default | Most workloads |
| `"throughput"` | 0.5 | Serve deepest-backlog agents first | Batch processing, ETL |

```python
from loco import AsyncLOCOScheduler

# Using the string API
scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

# Using the numeric API
scheduler = AsyncLOCOScheduler(agents, resource, alpha=0.25)
```

!!! warning "Do not use alpha > 0.5 in production"
    Simulation proves that alpha >= 0.75 causes starvation -- some agents complete zero tasks. The Dmax term is load-bearing for fairness.

## Adaptive Alpha

With `auto_tune=True`, the scheduler adjusts alpha automatically based on observed wait-time variance:

- High wait-time variance across agents: alpha nudges down (toward latency/fairness)
- Growing queue depths: alpha nudges up (toward throughput)
- Clamped to [0.0, 0.5] safe range

```python
scheduler = AsyncLOCOScheduler(agents, resource, auto_tune=True)
```

## Task Weight

Task weight is a cost proxy set at submit time. The scheduler uses it for queue depth scoring.

| Model tier | Typical weight |
|-----------|---------------|
| haiku / gpt-4o-mini / gemini-flash | 1.0 |
| sonnet / gpt-4o / gemini-pro | 2.0--3.0 |
| opus / o1 | 5.0 |

With the convenience API:

```python
await loco.wrap(fn, agent_id="analyst", weight=2.0, ...)
```

With the full API:

```python
await scheduler.submit_task("analyst", Task(weight=2.0))
```

Framework adapters compute weight automatically from model name and prompt length.

## Scoring at Grant Time

A critical design choice: scores are computed when a resource slot becomes available (grant time), not when the agent first calls `acquire()` (request time).

This prevents priority inversion. An agent that has been waiting for 10 ticks will have a higher Dmax than one that just arrived, even if the newcomer has a deeper queue. The waiting agent's urgency grows over time.
