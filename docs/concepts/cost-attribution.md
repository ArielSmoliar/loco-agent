---
title: "Cost Attribution"
description: "Track costs by team, workflow, and model"
---

# Cost Attribution

Cost attribution lets you break down scheduler spend by team, workflow, and model -- the three dimensions that matter for chargebacks and optimization.

## Task Fields

Every task can carry attribution metadata:

```python
from loco import Task

task = Task(
    weight=2.0,
    team="marketing",
    workflow="weekly-report",
    model="claude-opus-4",
)
```

All three fields are optional. Tasks without attribution fields still track cost by agent and session as before.

## Querying Costs

Attribution data is accessed through `scheduler.metrics.attribution`:

```python
attr = scheduler.metrics.attribution

attr.cost_by_team()        # {"marketing": 47.5, "eng": 120.0}
attr.cost_by_workflow()     # {"weekly-report": 31.2}
attr.cost_by_model()        # {"claude-opus-4": 68.0, "claude-sonnet-4": 15.0}
```

## Drill-Down

Use `team_breakdown()` to drill into a single team:

```python
attr.team_breakdown("eng")
# {"by_agent": {"analyst": 80.0, "reviewer": 40.0},
#  "by_model": {"claude-opus-4": 100.0, "claude-sonnet-4": 20.0},
#  "by_workflow": {"code-review": 70.0, "triage": 50.0}}
```

## Top Costs

Find the most expensive items in any dimension:

```python
attr.top_costs("model", n=5)   # top 5 models by spend
attr.top_costs("team", n=3)    # top 3 teams by spend
```

## Summary

Call `attr.summary()` for a combined view of all dimensions -- useful for dashboards and periodic reports.
