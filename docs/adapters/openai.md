# OpenAI SDK Adapter

Wraps `client.chat.completions.create()` with LOCO scheduling and cost tracking.

## Setup

```python
import openai
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.openai import OpenAIAdapter

scheduler = AsyncLOCOScheduler([], SharedResource("llm_api", capacity=3))
adapter = OpenAIAdapter(scheduler, client=openai.AsyncOpenAI())
```

## Usage

```python
response = await adapter.create_chat(
    "assistant",
    model="gpt-4o",
    messages=[{"role": "user", "content": "Summarize this report..."}],
)
```

## Model Weights

| Model | Weight |
|-------|--------|
| gpt-4o | 3.0 |
| gpt-4o-mini | 1.0 |
| o3 | 5.0 |
| o3-mini | 2.0 |
| Unknown | 2.0 (default) |
