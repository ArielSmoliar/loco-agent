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
    on_model_error_callback=adapter.on_model_error,
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

## Invocation ownership

Handles are keyed by `(agent_name, invocation_id)` rather than agent name alone.
Different invocations for one agent can overlap. A second active model call with
the same pair is rejected; the invocation may make another model call after the
previous call finishes. IDs identify a request-response cycle, not necessarily
every model call, so callers must not deliver stale completion callbacks after
starting another call with the same pair.

Before, after, and error methods accept `callback_context` by keyword, following
[ADK's callback parameter contract](https://adk.dev/callbacks/types-of-callbacks/).
Wire the error callback as well as the success callback. If your runtime does
not deliver a terminal callback on cancellation, call the cleanup hook from
`finally`. Missing invocation IDs support sequential calls only.

See [Lifecycle guarantees](../task-lifecycle.md) for scope and test coverage.
