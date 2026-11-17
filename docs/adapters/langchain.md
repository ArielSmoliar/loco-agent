---
title: "LangChain"
description: "Schedule LangChain LLM calls with LOCO-Agent"
---

# LangChain Adapter

Callback handler that hooks into `on_llm_start` / `on_llm_end` for per-LLM-call scheduling.

## Setup

```python
from loco import AsyncLOCOScheduler, SharedResource
from loco.adapters.langchain import LOCOCallbackHandler

scheduler = AsyncLOCOScheduler([], SharedResource("llm_api", capacity=3))
callback = LOCOCallbackHandler(scheduler, agent_id="rag-pipeline")
```

## Usage

Attach the callback to your LLM:

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o", callbacks=[callback])
result = await llm.ainvoke("Summarize this...")
```

Each LLM call is automatically scheduled through LOCO. The callback extracts the model name from LangChain's serialized config and computes weight.

## Multiple Agents

Create one callback per agent:

```python
rag_callback = LOCOCallbackHandler(scheduler, agent_id="rag-pipeline")
qa_callback = LOCOCallbackHandler(scheduler, agent_id="qa-chain")

rag_llm = ChatOpenAI(callbacks=[rag_callback])
qa_llm = ChatOpenAI(callbacks=[qa_callback])
```

Both agents compete through the same scheduler.

## Invocation ownership

Start, end, and error callbacks are paired by `run_id`. Overlapping runs for the
same LOCO agent retain separate handles and tasks. Completion order does not
change their ownership; duplicate completion of an inactive ID does nothing.
Unknown IDs never release another run. An identified start requires the same ID
on completion; a missing ID raises `ValueError` while identified work is active.

The ID comes from LangChain's [callback contract](https://reference.langchain.com/python/langchain-core/callbacks/base/AsyncCallbackHandler/on_llm_start).
Direct calls without `run_id` still work sequentially; overlapping unidentified
starts raise `RuntimeError` before enqueueing another task. Supply unique run IDs
for concurrent calls, and ensure every admitted call gets an end/error callback,
including cancellation. Cancelling a pending start cleans up its own task.

See [Lifecycle guarantees](../task-lifecycle.md) for scope and test coverage.
