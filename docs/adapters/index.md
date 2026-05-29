---
title: "Framework Adapters"
description: "Integrate LOCO-Agent with Anthropic, OpenAI, Google ADK, LangChain, CrewAI, AWS Bedrock, and AutoGen"
---

# Framework Adapters

LOCO-Agent ships 7 framework adapters. Each one wraps LLM calls in LOCO scheduling so your agent code doesn't change.

## Supported Frameworks

| Framework | Adapter | Integration Pattern | Weight Source |
|-----------|---------|-------------------|--------------|
| [Anthropic SDK](anthropic.md) | `AnthropicAdapter` | Wrap `messages.create()` | Model tier + prompt length |
| [OpenAI SDK](openai.md) | `OpenAIAdapter` | Wrap `chat.completions.create()` | Model tier + prompt length |
| [Google ADK](google-adk.md) | `ADKAdapter` | `before_model` / `after_model` callbacks | Gemini model tier |
| [LangChain](langchain.md) | `LOCOCallbackHandler` | `on_llm_start` / `on_llm_end` | Extracted from serialized config |
| [CrewAI](crewai.md) | `CrewAIAdapter` | `step_callback` per agent | Agent role |
| [AWS Bedrock](aws-bedrock.md) | `BedrockAdapter` | Wrap `invoke()` | Bedrock model family |
| [AutoGen](autogen.md) | `AutoGenAdapter` | Wrap `send_message()` / `publish_message()` | Azure OpenAI model tier |

## Which Adapter Do I Need?

- **Direct SDK calls** (Anthropic, OpenAI, Bedrock): Use the SDK adapter. It wraps your client calls.
- **Callback-based frameworks** (ADK, LangChain, CrewAI): Use the callback adapter. It hooks into framework events.
- **Message-passing frameworks** (AutoGen): Use the message adapter. It wraps message delivery.
- **Any async code**: Use `loco.wrap()` directly -- no adapter needed.

## Cross-Framework Scheduling

All adapters point to the same scheduler. Agents from different frameworks compete through the same L(i) scoring:

```python
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.anthropic import AnthropicAdapter
from loco.adapters.langchain import LOCOCallbackHandler

# One scheduler for all frameworks
scheduler = AsyncLOCOScheduler([], SharedResource("llm_api", capacity=3))

# Anthropic agents
anthropic_adapter = AnthropicAdapter(scheduler, client=anthropic_client)

# LangChain agents
langchain_callback = LOCOCallbackHandler(scheduler, agent_id="rag-pipeline")

# Both compete for the same 3 slots
```

## Auto-Registration

All adapters auto-register agents on first contact. You don't need to pre-declare agents:

```python
# This agent doesn't exist yet -- it's created automatically
await anthropic_adapter.create_message("new-agent", model="claude-sonnet-4-20250514", ...)
```

## Detect Your Frameworks

```bash
loco doctor
```

Shows which frameworks are installed and prints integration code for each.
