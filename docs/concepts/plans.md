---
title: "Execution Plans"
description: "Static DAG-based task orchestration with dependency tracking"
---

# Execution Plans

A Plan is a static DAG of Steps that defines an execution order with dependencies. Plans are standalone data structures in v0.3 -- you compose them with the scheduler manually.

## Quick Example

```python
from loco import Plan, Step, AsyncLOCOScheduler, Agent, Task, SharedResource

# Define the execution graph
plan = Plan(steps=[
    Step("fetch", agent="reader"),
    Step("analyze", agent="analyst", depends_on=["fetch"]),
    Step("summarize", agent="analyst", depends_on=["analyze"]),
    Step("respond", agent="writer", depends_on=["summarize"]),
])
plan.validate()  # checks for cycles, missing deps, duplicate IDs

# Execute with the scheduler
scheduler = AsyncLOCOScheduler(
    agents=[Agent(agent_id="reader"), Agent(agent_id="analyst"), Agent(agent_id="writer")],
    resource=SharedResource("llm_api", capacity=2),
)

completed = set()
while not plan.is_complete(completed):
    for step in plan.ready_steps(completed):
        task = Task(weight=step.weight, labels=step.labels)
        await scheduler.submit_task(step.agent, task)
        async with scheduler.acquire(step.agent):
            scheduler.get_agent(step.agent).serve_oldest_task()
            await do_work(step)
        completed.add(step.step_id)
```

## Plan Structure

A Plan is a list of Steps. Each Step has:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `step_id` | `str` | required | Unique identifier |
| `agent` | `str` | required | Agent ID that executes this step |
| `depends_on` | `list[str]` | `[]` | Step IDs that must complete first |
| `weight` | `float` | `1.0` | Cost weight for the task |
| `labels` | `dict` | `None` | Security labels for this step's data |

## DAG Operations

### Validation

```python
plan.validate()
# Raises ValueError on:
#   - Duplicate step IDs
#   - Missing dependencies (step depends on non-existent step)
#   - Cycles (a -> b -> c -> a)
```

### Topological Sort

```python
order = plan.topological_sort()
# ["fetch", "analyze", "summarize", "respond"]
# Raises ValueError if the DAG has cycles
```

### Ready Steps

```python
ready = plan.ready_steps(completed={"fetch"})
# Returns [Step("analyze")] -- its dependency "fetch" is done
```

### Completion Check

```python
plan.is_complete({"fetch", "analyze", "summarize", "respond"})  # True
```

## Parallel Execution

Steps without dependencies on each other can run in parallel:

```python
plan = Plan(steps=[
    Step("a", agent="x"),
    Step("b", agent="y"),          # no deps -- parallel with "a"
    Step("c", agent="x", depends_on=["a", "b"]),  # waits for both
])

completed = set()
while not plan.is_complete(completed):
    ready = plan.ready_steps(completed)
    # ready may contain multiple steps -- run them concurrently
    tasks = []
    for step in ready:
        tasks.append(run_step(scheduler, step))
    await asyncio.gather(*tasks)
    completed.update(s.step_id for s in ready)
```

## With Security Labels

Steps can carry security labels that flow through to tasks and are checked by AccessPolicy:

```python
from loco import SecurityLabel

plan = Plan(steps=[
    Step("fetch_pii", agent="reader", labels={"output": SecurityLabel.CONFIDENTIAL}),
    Step("anonymize", agent="sanitizer", depends_on=["fetch_pii"],
         labels={"input": SecurityLabel.CONFIDENTIAL, "output": SecurityLabel.INTERNAL}),
    Step("analyze", agent="analyst", depends_on=["anonymize"],
         labels={"input": SecurityLabel.INTERNAL}),
])
```

## Diamond DAG Pattern

The most common multi-agent pattern -- fan out, then join:

```
    fetch
   /     \
analyze  enrich
   \     /
   combine
```

```python
plan = Plan(steps=[
    Step("fetch", agent="reader"),
    Step("analyze", agent="analyst", depends_on=["fetch"]),
    Step("enrich", agent="enricher", depends_on=["fetch"]),
    Step("combine", agent="writer", depends_on=["analyze", "enrich"]),
])
```
