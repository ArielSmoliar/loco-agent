---
title: "AWS Bedrock"
description: "Schedule AWS Bedrock InvokeModel calls with LOCO-Agent"
---

# AWS Bedrock Adapter

Wraps Bedrock `invoke_model()` with LOCO scheduling.

## Setup

```python
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.aws_bedrock import BedrockAdapter

scheduler = AsyncLOCOScheduler([], SharedResource("bedrock_api", capacity=3))
adapter = BedrockAdapter(scheduler, client=bedrock_runtime_client)
```

## Usage

```python
response = await adapter.invoke(
    "security-scanner",
    model_id="anthropic.claude-sonnet-4-20250514-v1:0",
    body={"messages": [{"role": "user", "content": "Scan this..."}]},
)
```

## Model Weights

| Model Family | Weight |
|-------------|--------|
| Claude Opus | 5.0 |
| Claude Sonnet | 2.0 |
| Claude Haiku | 1.0 |
| Llama 3 70B | 3.0 |
| Llama 3 8B | 1.0 |
| Titan | 1.0 |
| Unknown | 2.0 (default) |

## RETURN_CONTROL Pattern

For Bedrock Agents with action groups, the adapter supports the `RETURN_CONTROL` pattern where the orchestration loop pauses and LOCO decides when to resume.
