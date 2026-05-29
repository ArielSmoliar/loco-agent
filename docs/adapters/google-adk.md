---
title: "Google ADK"
description: "Schedule Google ADK agent calls with LOCO-Agent"
---

# Google ADK Adapter

Hooks into ADK's `before_model_callback` / `after_model_callback` for per-LLM-call scheduling.

## Setup

```python
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.google_adk import ADKAdapter

scheduler = AsyncLOCOScheduler([], SharedResource("gemini_api", capacity=3))
adapter = ADKAdapter(scheduler)
```

## Usage

Wire the adapter's callbacks into your ADK agent:

```python
from google.adk import Agent

agent = Agent(
    name="support",
    model="gemini-2.5-flash",
    before_model_callback=adapter.before_model,
    after_model_callback=adapter.after_model,
)
```

The adapter uses split acquire/release -- `before_model` acquires, `after_model` releases.

## Model Weights

| Model | Weight |
|-------|--------|
| gemini-2.5-pro | 3.0 |
| gemini-2.5-flash | 1.5 |
| gemini-2.0-flash | 1.0 |
| Unknown | 2.0 (default) |

## Demo

See [loco-adk-demo](https://github.com/ArielSmoliar/loco-adk-demo) -- 3 ADK agents (triage, support, escalation) sharing a bounded Gemini API pool with live API calls.
