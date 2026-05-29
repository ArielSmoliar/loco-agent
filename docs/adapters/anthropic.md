---
title: "Anthropic SDK"
description: "Schedule Claude API calls with LOCO-Agent"
---

# Anthropic SDK Adapter

Wraps `client.messages.create()` with LOCO scheduling and cost tracking.

## Setup

```python
import anthropic
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.anthropic import AnthropicAdapter

scheduler = AsyncLOCOScheduler([], SharedResource("llm_api", capacity=3))
adapter = AnthropicAdapter(scheduler, client=anthropic.AsyncAnthropic())
```

## Usage

```python
response = await adapter.create_message(
    "analyst",
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Analyze this data..."}],
)
```

The adapter:

1. Estimates weight from model tier (opus=5, sonnet=2, haiku=1) + prompt length
2. Submits a task to the scheduler
3. Acquires a resource slot via L(i) scoring
4. Calls `client.messages.create()`
5. Records actual token usage (input + output) for EMA weight tuning
6. Releases the resource slot

## Model Weights

| Model | Weight |
|-------|--------|
| claude-opus-4 | 5.0 |
| claude-sonnet-4 | 2.0 |
| claude-haiku-4.5 | 1.0 |
| Unknown model | 2.0 (default) |

Weight scales by prompt length: 2k+ tokens multiplies the base weight.

## Without a Client

If no `anthropic.AsyncAnthropic()` client is provided, the adapter returns a mock response. Useful for testing scheduling behavior without API keys.
