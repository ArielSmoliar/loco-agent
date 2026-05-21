# API Reference

## Convenience API

The fastest way to use LOCO. Configure once, wrap calls with one line.

### `loco.configure()`

```python
loco.configure(
    capacity=3,                    # concurrent resource slots
    optimize_for="balanced",       # "latency" | "balanced" | "throughput"
    resource_name="llm_api",       # name for the shared resource
    auto_tune=True,                # adaptive alpha tuning
    max_waiters=100,               # backpressure limit
    budget_mode="reject",          # "reject" | "alert" | "downgrade" | None
)
```

Creates a module-level singleton scheduler. Call once at app startup. Agents auto-register on first use.

### `loco.wrap()`

```python
result = await loco.wrap(
    fn,                  # async callable to wrap
    agent_id="analyst",  # agent ID for scheduling
    weight=2.0,          # task weight (cost proxy)
    **kwargs,            # passed through to fn()
)
```

Submits a task, acquires the resource, calls `fn(**kwargs)`, dequeues the task, and releases. On exception: dequeues the task and re-raises. Budget spend is not recorded on error.

### `loco.scheduled()`

```python
@loco.scheduled(agent_id="webhook", weight=1.0)
async def handle_webhook(payload):
    return await call_llm(payload)
```

Decorator that wraps an async function with LOCO scheduling.

### `loco.set_budget()`

```python
loco.set_budget("analyst", max_cost=50.0)
```

Set a budget limit for an agent. Requires `configure(budget_mode=...)` first.

### `loco.get_scheduler()`

Returns the global `AsyncLOCOScheduler` instance.

### `loco.reset()`

Reset the global scheduler. For testing.

---

## AsyncLOCOScheduler

The full scheduler API for maximum control.

### Constructor

```python
from loco import Agent, AsyncLOCOScheduler, SharedResource
from loco.budget import BudgetManager

scheduler = AsyncLOCOScheduler(
    agents=[Agent(agent_id="a"), Agent(agent_id="b")],
    resource=SharedResource("llm_api", capacity=3),
    alpha=0.25,                          # or optimize_for="balanced"
    max_waiters=100,
    seed=42,                             # deterministic tie-breaking
    on_task_started=callback,            # lifecycle hook
    on_task_completed=callback,
    auto_tune=True,
    budget=BudgetManager(on_exceeded="reject"),
)
```

### Methods

| Method | Description |
|--------|------------|
| `await submit_task(agent_id, task)` | Enqueue a task. Auto-registers unknown agents. |
| `async with acquire(agent_id, timeout=None)` | Context manager. Blocks until L(i) wins a slot. |
| `await acquire_start(agent_id, timeout=None)` | Returns `AcquireHandle` for split acquire/release. |
| `await release_handle(handle)` | Release via handle. Safe to call multiple times. |
| `register_agent(agent)` | Register a new agent at runtime. |
| `unregister_agent(agent_id)` | Remove an agent. Raises if holding or waiting. |
| `get_agent(agent_id)` | Get the Agent object. |
| `await shutdown(timeout=30.0)` | Cancel waiters, drain in-flight holders. |

### Properties

| Property | Type | Description |
|----------|------|------------|
| `agents` | `dict[str, Agent]` | All registered agents |
| `alpha` | `float` | Current alpha value |
| `logical_tick` | `int` | Current tick counter |
| `resource` | `SharedResource` | The shared resource |
| `metrics` | `SchedulerMetrics` | Cost and fairness metrics |
| `budget` | `BudgetManager | None` | Budget manager (if configured) |

---

## Task

```python
from loco import Task

task = Task(weight=3.0, task_type="anthropic:opus")
```

| Field | Type | Default | Description |
|-------|------|---------|------------|
| `weight` | `float` | `1.0` | Cost proxy for scheduling |
| `task_type` | `str` | `""` | Label (e.g., `"anthropic:sonnet"`) |
| `age` | `int` | `0` | Ticks waited. Auto-incremented. |
| `task_id` | `str` | auto | Unique identifier |

---

## Agent

```python
from loco import Agent

agent = Agent(agent_id="fraud-detector", agent_type="batch")
```

| Property | Description |
|----------|------------|
| `agent_id` | Unique identifier |
| `agent_type` | Label (e.g., `"webhook"`, `"batch"`) |
| `tasks` | Pending task queue |
| `completed_tasks` | Completed task list |
| `queue_depth_weighted` | Sum of task weights (Qi) |
| `dmax` | Age of oldest task (Dmax_i) |
| `serve_oldest_task()` | Pop and complete the oldest task |

---

## SharedResource

```python
from loco import SharedResource

resource = SharedResource(name="llm_api", capacity=3)
```

| Property | Description |
|----------|------------|
| `capacity` | Max concurrent holders |
| `utilization` | `holder_count / capacity` (0.0 to 1.0) |
| `available_slots` | `capacity - holder_count` |
| `holder_count` | Currently holding agents |
| `waiter_count` | Currently waiting agents |

---

## BudgetManager

```python
from loco.budget import BudgetManager, BudgetExceededError

budget = BudgetManager(default_limit=100.0, on_exceeded="reject")
```

| Method | Description |
|--------|------------|
| `set_limit(agent_id, max_cost)` | Set budget ceiling |
| `remove_limit(agent_id)` | Remove limit (becomes uncapped) |
| `get_limit(agent_id)` | Get limit (returns default if not set) |
| `check(agent_id, task_cost)` | Check if task fits budget |
| `record_spend(agent_id, cost)` | Record spend |
| `spent(agent_id)` | Cumulative spend |
| `remaining(agent_id)` | Budget remaining (None if uncapped) |
| `reset(agent_id)` | Reset spend to 0 |
| `reset_all()` | Reset all agents |
| `summary()` | Full state dict |
| `alerts` | List of exceeded events |

---

## SchedulerMetrics

```python
scheduler.metrics.cost_by_agent()     # {"analyst": 47.5, "batch": 12.0}
scheduler.metrics.total_cost()        # 59.5
scheduler.metrics.agent_cost("analyst")  # 47.5
```

Also: `record_actual_tokens()`, `empirical_weight()`, `actual_tokens_by_agent()`, `total_actual_tokens()`.

---

## Exceptions

| Exception | When |
|-----------|------|
| `BackpressureError` | `acquire()` when waiters >= max_waiters |
| `ShutdownError` | `submit_task()` or `acquire()` after shutdown |
| `BudgetExceededError` | `acquire()` when agent exceeds budget (reject mode) |
| `TimeoutError` | `acquire(timeout=N)` when timeout expires |

---

## Pretty Output

```python
import loco.pretty
loco.pretty.install()
```

Or set `LOCO_LOG=pretty` environment variable.

---

## CLI

```bash
loco doctor    # Detect installed frameworks, show integration guide
loco version   # Show version
```
