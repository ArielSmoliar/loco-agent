---
title: "SLO Error Budgets"
description: "Monitor scheduling quality with state machine-based error budget tracking"
---

# SLO Error Budgets

Track wait-time SLO violations with a state machine. SLOBudget is an observability primitive -- it monitors completed tasks and tells you when your scheduling quality is degrading.

## Quick Setup

```python
from loco import SLOBudget, SLOState

slo = SLOBudget(
    target_wait=20.0,  # max acceptable wait time in ticks
    window=100,        # rolling observation window
)
```

## How It Works

After each task completes, call `slo.record()` with the agent and task. The SLOBudget checks if the task's wait time (age) exceeded the target and tracks the violation rate over a rolling window.

```python
from loco import AsyncLOCOScheduler

scheduler = AsyncLOCOScheduler(
    agents, resource,
    on_task_completed=lambda agent_id, task, _: slo.record(agent_id, task),
)
```

## State Machine

The SLO state transitions based on what fraction of your error budget has been consumed:

```
HEALTHY  -->  WARNING  -->  CRITICAL  -->  EXHAUSTED
  <--           <--           <--
```

| State | Default Threshold | Meaning |
|-------|-------------------|---------|
| `HEALTHY` | violation rate < 75% | Error budget is mostly intact |
| `WARNING` | violation rate >= 75% | Error budget is burning fast |
| `CRITICAL` | violation rate >= 90% | Nearly out of error budget |
| `EXHAUSTED` | violation rate = 100% | Every task is violating the SLO |

States can improve as violations slide out of the rolling window.

## Checking State

```python
slo.state              # SLOState.HEALTHY
slo.violation_rate     # 0.12 (12% of tasks violated)
slo.budget_remaining   # 0.88 (88% of error budget left)
slo.total_violations   # 47 (lifetime, not just window)
slo.total_observations # 389
```

## Custom Thresholds

```python
slo = SLOBudget(
    target_wait=10.0,
    window=50,
    warn=0.5,      # WARNING at 50% violation rate
    critical=0.8,  # CRITICAL at 80%
)
```

## Example: Alert on State Change

```python
prev_state = SLOState.HEALTHY

def on_task_done(agent_id, task, _):
    global prev_state
    new_state = slo.record(agent_id, task)
    if new_state != prev_state:
        print(f"SLO state changed: {prev_state} -> {new_state}")
        if new_state in (SLOState.CRITICAL, SLOState.EXHAUSTED):
            send_alert(f"SLO degraded to {new_state}")
        prev_state = new_state

scheduler = AsyncLOCOScheduler(
    agents, resource,
    on_task_completed=on_task_done,
)
```

## Recovery

As good observations enter the rolling window and violations drop out, the state improves automatically:

```python
# Window of 5, all violations -> EXHAUSTED
# Then 3 good observations push out 3 violations
# Window: [violation, violation, pass, pass, pass] -> 40% -> HEALTHY
```

## Reset

```python
slo.reset()  # Clear all observations, back to HEALTHY
```

Use this for daily/weekly SLO budget cycles.
