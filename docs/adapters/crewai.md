---
title: "CrewAI"
description: "Schedule CrewAI agent calls with LOCO-Agent"
---

# CrewAI Adapter

Per-step scheduling via `step_callback` and coarse-grained crew-level scheduling.

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
adapter.before_step("researcher", role="researcher")
# ... step executes ...
adapter.after_step("researcher")
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
