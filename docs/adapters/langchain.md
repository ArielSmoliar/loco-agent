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
