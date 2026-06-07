---
title: "Trust Scoring"
description: "Adaptive trust scores for agent scheduling priority"
---

# Trust Scoring

Trust scoring adjusts agent scheduling priority based on historical behavior. Agents that complete tasks reliably earn higher trust; agents that error or timeout lose trust and get deprioritized.

## Signals

The scorer tracks five signals:

| Signal | Points | Trigger |
|--------|--------|---------|
| Success | +15 | Task completed without error |
| Fast completion | +10 | Wait time below SLO target |
| SLO violation | -25 | Wait time exceeded SLO target |
| Error | -50 | Task raised an exception |
| Timeout | -80 | Task timed out |

## Score Range

Scores range from 0 to 1000, with 500 as the baseline. New agents start at 500. Over time, scores decay back toward 500 -- a bad run does not permanently penalize an agent, and a good run does not permanently elevate one.

## Decay

Scores decay toward the baseline using an exponential half-life. The default half-life is 3600 seconds (one hour). This means an agent that stops receiving signals will return to neutral priority within a few hours.

## Integration

Create a scorer and pass it to the scheduler:

```python
from loco import TrustScorer, AsyncLOCOScheduler

scorer = TrustScorer(slo_target=20.0, decay_half_life=3600.0)
scheduler = AsyncLOCOScheduler(..., trust_scorer=scorer)
```

The scheduler uses `priority_multiplier()` (range 0.8 to 1.2) to adjust the load function. High-trust agents get a small priority boost; low-trust agents get a small penalty.

## Querying Scores

```python
scorer.score("agent_a")              # current score (0-1000)
scorer.priority_multiplier("agent_a") # multiplier (0.8-1.2)
scorer.stats("agent_a")              # detailed breakdown
scorer.scores()                      # all agents
```

## When to Use

Trust scoring is most useful when you have agents with uneven reliability -- for example, agents calling flaky external APIs or agents with varying error rates across model providers.
