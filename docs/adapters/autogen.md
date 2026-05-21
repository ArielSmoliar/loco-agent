# Azure / AutoGen Adapter

Wraps AutoGen v0.4 message delivery with LOCO scheduling. Supports both `send_message()` (point-to-point) and `publish_message()` (pub/sub).

## Setup

```python
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.autogen import AutoGenAdapter

scheduler = AsyncLOCOScheduler([], SharedResource("azure_openai", capacity=3))
adapter = AutoGenAdapter(scheduler, default_model="gpt-4o")
```

## Usage

### Point-to-Point

```python
result = await adapter.send_message(
    sender="coordinator",
    recipient="analyst",
    content="Analyze this security event",
    model="gpt-4o-mini",
)
```

### Pub/Sub

```python
results = await adapter.publish_message(
    sender="coordinator",
    topic="security-alerts",
    content="New threat detected",
    subscribers=["analyst-0", "analyst-1", "analyst-2"],
)
```

Each subscriber delivery is scheduled independently through LOCO.

## Model Weights

| Model | Weight |
|-------|--------|
| gpt-4o | 3.0 |
| gpt-4o-mini | 1.0 |
| gpt-4 | 3.0 |
| gpt-35-turbo | 1.0 |
| Unknown | 2.0 (default) |

## Demo

See [loco-autogen-demo](https://github.com/ArielSmoliar/loco-autogen-demo) -- 8 AutoGen agents in an enterprise security pipeline with per-agent budget enforcement. Shows reject, alert, and downgrade modes.
