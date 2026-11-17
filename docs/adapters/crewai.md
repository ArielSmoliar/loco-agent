---
title: "CrewAI"
description: "Schedule CrewAI agent calls with LOCO-Agent"
---

# CrewAI Adapter

Explicit before/after step hooks and coarse-grained crew-level scheduling. Your
integration must call the hooks around the action; a completion-only callback
cannot stop an action before it starts.

## Setup

```python
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.crewai import CrewAIAdapter

scheduler = AsyncLOCOScheduler([], SharedResource("llm_api", capacity=3))
adapter = CrewAIAdapter(scheduler)
```

## Usage

### Per-Step (fine-grained)

```python
from uuid import uuid4

step_id = uuid4().hex
await adapter.before_step("researcher", invocation_id=step_id)
try:
    await run_step()  # your application's step execution
finally:
    await adapter.after_step("researcher", invocation_id=step_id)
```

### Crew-Level (coarse-grained)

```python
result = await adapter.run_crew(crew, task_descriptions=["research", "analyze", "write"])
```

## Role Weights

| Role | Weight |
|------|--------|
| researcher | 3.0 |
| analyst | 3.0 |
| writer | 2.0 |
| reviewer | 2.0 |
| Unknown | 2.0 (default) |

Custom role weights can be passed to the adapter constructor.

## Invocation ownership

Use a distinct `invocation_id` for overlapping calls with the same role. End and
error hooks must use the same ID. `on_step_error(role, error, invocation_id=...)`
also releases the matching call. Duplicate completions for inactive IDs are
no-ops; an unknown ID never releases another call.

Existing calls without IDs remain sequential-only. An overlapping unidentified
start raises `RuntimeError` before it can overwrite a handle. IDs must not be
reused while late terminal callbacks for an earlier call could still arrive.

`run_crew()` now also cleans up the exact submitted task on kickoff errors or
admission rejection. See [Lifecycle guarantees](../task-lifecycle.md).
