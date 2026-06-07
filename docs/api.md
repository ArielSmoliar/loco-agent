---
title: "API Reference"
description: "Every class, method, and parameter in LOCO-Agent"
---

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
from loco import PolicyEnforcer, BudgetPolicy, AccessPolicy, RatePolicy

scheduler = AsyncLOCOScheduler(
    agents=[Agent(agent_id="a"), Agent(agent_id="b")],
    resource=SharedResource("llm_api", capacity=3),
    alpha=0.25,                          # or optimize_for="balanced"
    max_waiters=100,
    seed=42,                             # deterministic tie-breaking
    on_task_started=callback,            # lifecycle hook
    on_task_completed=callback,
    auto_tune=True,
    budget=BudgetPolicy(on_exceeded="reject"),  # v0.2 compat
    enforcer=PolicyEnforcer([...]),       # v0.3 policy composition
    trust_scorer=scorer,                  # v0.4 trust scoring
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
| `trust_scorer` | `TrustScorer | None` | Trust scorer (if configured) |

---

## Task

```python
from loco import Task, SecurityLabel

task = Task(weight=3.0, task_type="anthropic:opus")
task_with_labels = Task(
    weight=2.0,
    labels={"input": SecurityLabel.CONFIDENTIAL, "output": SecurityLabel.INTERNAL},
)
```

| Field | Type | Default | Description |
|-------|------|---------|------------|
| `weight` | `float` | `1.0` | Cost proxy for scheduling |
| `task_type` | `str` | `""` | Label (e.g., `"anthropic:sonnet"`) |
| `age` | `int` | `0` | Ticks waited. Auto-incremented. |
| `task_id` | `str` | auto | Unique identifier |
| `labels` | `dict[str, SecurityLabel] \| None` | `None` | Security labels for task data |
| `session_id` | `str \| None` | `None` | Session/workflow ID for cost attribution |
| `team` | `str \| None` | `None` | Team name for cost rollup |
| `workflow` | `str \| None` | `None` | Workflow name for cost rollup |
| `model` | `str \| None` | `None` | Model identifier for cost rollup |

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

Session cost tracking:

```python
scheduler.metrics.cost_by_session()                        # {"session-abc": 17.0}
scheduler.metrics.session_cost("session-abc")              # 17.0
scheduler.metrics.cost_by_session_and_agent("session-abc") # {"analyst": 12.0, "reviewer": 5.0}
scheduler.metrics.sessions()                               # ["session-abc", "session-def"]
```

Also: `record_actual_tokens()`, `empirical_weight()`, `actual_tokens_by_agent()`, `total_actual_tokens()`.

---

## PolicyEnforcer

```python
from loco import PolicyEnforcer, BudgetPolicy, AccessPolicy, RatePolicy

enforcer = PolicyEnforcer([
    BudgetPolicy(default_limit=50.0),
    AccessPolicy(rules={"analyst": {"labels": ["public", "internal"]}}),
    RatePolicy(limits={"batch": 10.0}, period=60.0),
])
```

| Method | Description |
|--------|------------|
| `check_all(agent_id, task)` | Run all policies. Short-circuits on first rejection. Returns list of passed policy names. |
| `record_all(agent_id, task)` | Record task completion to all policies. |
| `add_policy(policy)` | Append a policy. |
| `remove_policy(name)` | Remove by name. Returns the policy or None. |
| `get_policy(name)` | Look up by name. |
| `summary()` | Summary dict from all policies. |

---

## AccessPolicy

```python
from loco import AccessPolicy

policy = AccessPolicy(rules={
    "analyst": {"labels": ["public", "internal"]},
    "auditor": {"labels": ["public", "internal", "confidential"]},
})
```

Open by default -- agents not in rules are allowed. Tasks without labels always pass.

---

## RatePolicy

```python
from loco import RatePolicy

policy = RatePolicy(limits={"batch": 10.0, "realtime": 100.0}, period=60.0)
policy.remaining("batch")  # tokens left in bucket
```

Token bucket algorithm with automatic refill. Unlimited for agents not in `limits`.

---

## SecurityLabel

```python
from loco import SecurityLabel

SecurityLabel.PUBLIC        # "public"
SecurityLabel.INTERNAL      # "internal"
SecurityLabel.CONFIDENTIAL  # "confidential"
```

String-based enum for JSON serialization. Used in Task labels and AccessPolicy rules.

---

## Plan / Step

```python
from loco import Plan, Step

plan = Plan(steps=[
    Step("fetch", agent="reader"),
    Step("analyze", agent="analyst", depends_on=["fetch"]),
])
plan.validate()                    # check for cycles, missing deps
plan.topological_sort()            # ["fetch", "analyze"]
plan.ready_steps(completed=set())  # [Step("fetch")]
plan.is_complete({"fetch", "analyze"})  # True
```

See [Execution Plans](concepts/plans.md) for usage patterns.

---

## SLOBudget

```python
from loco import SLOBudget, SLOState

slo = SLOBudget(target_wait=20.0, window=100, warn=0.75, critical=0.90)
state = slo.record("agent_a", completed_task)  # SLOState.HEALTHY
slo.violation_rate    # 0.0 - 1.0
slo.budget_remaining  # 1.0 - 0.0
slo.reset()
```

See [SLO Error Budgets](concepts/slo.md) for details.

---

## Prometheus Exporter (v0.4)

```python
from loco.exporters.prometheus import PrometheusExporter

exporter = PrometheusExporter(scheduler)
exporter.start(port=9090)
exporter.snapshot()  # dict of current metric values
exporter.stop()

# Or via convenience API:
import loco
loco.configure(capacity=3)
loco.enable_prometheus(port=9090)
```

Requires: `pip install loco-agent[prometheus]`

---

## CostAttribution (v0.4)

```python
# Accessed via scheduler.metrics.attribution
scheduler.metrics.attribution.cost_by_team()        # {"marketing": 47.5}
scheduler.metrics.attribution.cost_by_workflow()     # {"weekly-report": 31.2}
scheduler.metrics.attribution.cost_by_model()        # {"claude-opus-4": 68.0}
scheduler.metrics.attribution.team_breakdown("eng")  # by_agent, by_model, by_workflow
scheduler.metrics.attribution.top_costs("model", n=5)
scheduler.metrics.attribution.summary()
```

Task attribution fields:

| Field | Type | Description |
|-------|------|------------|
| `team` | `str \| None` | Team name for cost rollup |
| `workflow` | `str \| None` | Workflow name for cost rollup |
| `model` | `str \| None` | Model identifier for cost rollup |

---

## TrustScorer (v0.4)

```python
from loco import TrustScorer

scorer = TrustScorer(slo_target=20.0, decay_half_life=3600.0)
scorer.record_success("agent_a", wait_ticks=3)
scorer.record_error("agent_a")
scorer.record_timeout("agent_a")
scorer.score("agent_a")              # 0-1000
scorer.priority_multiplier("agent_a") # 0.8-1.2
scorer.stats("agent_a")              # detailed breakdown
scorer.scores()                      # all agents

# Wire into scheduler
scheduler = AsyncLOCOScheduler(..., trust_scorer=scorer)
```

Score signals: success (+15), fast completion bonus (+10), SLO violation (-25), error (-50), timeout (-80). Scores decay toward 500 (baseline) over time.

---

## MultiTenantScheduler (v0.4)

```python
from loco import MultiTenantScheduler
from loco.resource import SharedResource

mt = MultiTenantScheduler(resource=SharedResource("llm", capacity=10))
mt.register_tenant("acme", max_agents=20, cost_ceiling=500.0)
mt.register_agent("acme", Agent(agent_id="acme_analyst"))
await mt.submit_task("acme", "acme_analyst", task)
async with mt.acquire("acme", "acme_analyst"):
    await do_work()

mt.tenant_stats("acme")    # cost, agents, ceiling, remaining
mt.tenant_cost("acme")     # cumulative cost
mt.all_tenants()           # stats for all tenants
```

| Exception | When |
|-----------|------|
| `TenantCostExceededError` | Task would exceed tenant cost ceiling |
| `TenantLimitError` | Tenant has reached max_agents |

---

## OutcomeTracker (v0.4)

```python
# Accessed via scheduler.metrics.outcomes
scheduler.metrics.outcomes.record("agent_a", task, "success", quality_score=0.92)
scheduler.metrics.outcomes.outcome_rates()       # {"success": 0.85, "failure": 0.15}
scheduler.metrics.outcomes.cost_per_outcome("success")
scheduler.metrics.outcomes.quality_by_model()    # {"opus": 0.95, "sonnet": 0.75}
scheduler.metrics.outcomes.roi_by_agent()        # cost-effectiveness per agent
scheduler.metrics.outcomes.roi_by_model()        # cost-effectiveness per model
scheduler.metrics.outcomes.summary()
```

---

## Exceptions

| Exception | When |
|-----------|------|
| `BackpressureError` | `acquire()` when waiters >= max_waiters |
| `ShutdownError` | `submit_task()` or `acquire()` after shutdown |
| `PolicyViolationError` | `acquire()` when any policy rejects |
| `BudgetExceededError` | `acquire()` when budget exceeded (subclass of PolicyViolationError) |
| `TimeoutError` | `acquire(timeout=N)` when timeout expires |
| `TenantCostExceededError` | Task would exceed tenant cost ceiling |
| `TenantLimitError` | Tenant has reached max_agents |

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
