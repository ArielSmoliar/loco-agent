---
title: "LiteLLM Gateway Integration"
description: "Run LOCO-Agent as a policy layer inside LiteLLM Proxy -- hard budget enforcement at the gateway, with the alert/downgrade/access logic a plain proxy can't do"
---

# LiteLLM Gateway Integration

[LiteLLM Proxy](https://docs.litellm.ai/docs/simple_proxy) is the most widely deployed open-source LLM gateway. It holds your provider keys, exposes one OpenAI-compatible endpoint, and forwards to 100+ models. This page shows how to run LOCO-Agent's policy engine **inside** LiteLLM as a custom callback, so budget and access policies are enforced server-side before any request reaches the model.

This is the concrete version of [gateway mode](enforcement-model.md#2-gateway-mode-hard-enforcement). Developers point their code at the proxy, never touch raw keys, and LOCO decides what happens when a budget is tight.

## What this gives you -- and what it doesn't

Be clear about the boundary up front. The LiteLLM integration ports LOCO's **enforcement** layer. It does **not** port the **scheduling** layer.

| Capability | Runs in LiteLLM via LOCO? |
|---|---|
| Hard per-agent budget caps (reject) | Yes |
| Alert mode (log overspend, allow) | Yes |
| Downgrade mode (swap to a cheaper model instead of blocking) | Yes |
| Rate limiting per agent | Yes |
| Security-label access control | Yes |
| Composable policy chains (budget + rate + access in one pipeline) | Yes |
| 4D cost attribution (agent / team / workflow / model) | Yes |
| **Load-function scheduling under contention (`L(i)`)** | **No -- see below** |
| **Trust-adjusted priority** | **No -- see below** |

The [load function](load-function.md) decides *which of N waiting agents goes next when slots are scarce*. That needs a shared queue and a single view of all waiters. A LiteLLM callback fires per-request, in whatever worker process handled it -- there is no cross-request queue to score against. So this integration is for **enforcement and attribution at the gateway**, not distributed scheduling. If contention scheduling is what you need, run the [`AsyncLOCOScheduler`](../quickstart.md) in your orchestrator process today. Distributed scheduling at the gateway is the [managed-mode roadmap item](enforcement-model.md#3-managed-mode-loco-cloud-roadmap).

## Step 1 -- write the callback

LiteLLM lets you subclass `CustomLogger` and register an instance. The `async_pre_call_hook` runs before the request is forwarded and can reject it; `async_log_success_event` runs after a successful call and gives you the real token cost LiteLLM computed.

```python
# loco_litellm.py -- LOCO policy engine as a LiteLLM proxy callback
from typing import Any, Literal, Optional

from fastapi import HTTPException
from litellm.integrations.custom_logger import CustomLogger

from loco.policy import PolicyEnforcer, PolicyViolationError, RatePolicy
from loco.budget import BudgetPolicy
from loco.task import Task

# --- Configure policies once at import time ---

# Budget in dollars. "downgrade" = don't block, fall back to a cheaper model.
budget = BudgetPolicy(default_limit=50.0, on_exceeded="downgrade")
budget.set_limit("expensive-agent", 200.0)

# 60 requests/min per agent, token-bucket.
rate = RatePolicy(default_limit=60, period=60.0)

enforcer = PolicyEnforcer(policies=[rate])  # budget checked separately (dollars)

# Cheaper tier to fall back to in downgrade mode.
DOWNGRADE_MAP = {
    "gpt-4o": "gpt-4o-mini",
    "claude-opus-4": "claude-haiku-4-5",
}

# Rough per-call dollar estimate, used for the pre-call budget check.
# Actual spend is recorded after the call from LiteLLM's response_cost.
TIER_ESTIMATE = {"opus": 0.20, "gpt-4o": 0.05, "sonnet": 0.03}


def _agent_id(data: dict, user_api_key_dict: Any) -> str:
    # Prefer an explicit agent id in request metadata; fall back to the key's user.
    meta = data.get("metadata") or {}
    return meta.get("agent_id") or getattr(user_api_key_dict, "user_id", None) or "unknown"


def _estimate(model: str) -> float:
    for tier, cost in TIER_ESTIMATE.items():
        if tier in model:
            return cost
    return 0.01


class LOCOHandler(CustomLogger):
    async def async_pre_call_hook(
        self,
        user_api_key_dict: Any,
        cache: Any,
        data: dict,
        call_type: Literal[
            "completion", "text_completion", "embeddings",
            "image_generation", "moderation", "audio_transcription",
        ],
    ) -> Optional[dict]:
        agent_id = _agent_id(data, user_api_key_dict)
        model = data.get("model", "")
        task = Task(weight=max(_estimate(model) * 100, 1.0), task_type="llm_call", model=model)

        # Rate + access + any composed policies. Raises on reject.
        try:
            enforcer.check_all(agent_id, task)
        except PolicyViolationError as e:
            raise HTTPException(status_code=429, detail=f"Policy rejected: {e.detail}")

        # Budget (dollars). Returns False in alert/downgrade mode instead of raising.
        within_budget = budget.check(agent_id, _estimate(model))
        if not within_budget:
            if budget.on_exceeded == "downgrade" and model in DOWNGRADE_MAP:
                data["model"] = DOWNGRADE_MAP[model]   # serve cheaper, don't block
            elif budget.on_exceeded == "reject":
                raise HTTPException(status_code=429, detail=f"Budget exceeded for {agent_id}")
            # "alert" mode: fall through and allow

        return data  # pass (possibly with a downgraded model)

    async def async_log_success_event(
        self, kwargs: dict, response_obj: Any, start_time: Any, end_time: Any
    ) -> None:
        # LiteLLM computes the real dollar cost; record actual spend, not the estimate.
        data = kwargs.get("litellm_params", {}).get("metadata", {})
        agent_id = data.get("agent_id", "unknown")
        actual_cost = kwargs.get("response_cost") or 0.0
        budget.record_spend(agent_id, actual_cost)


proxy_handler_instance = LOCOHandler()
```

## Step 2 -- register it in the proxy config

```yaml
# config.yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

litellm_settings:
  callbacks: loco_litellm.proxy_handler_instance
```

```bash
litellm --config config.yaml
```

## Step 3 -- developers call the proxy

Developers point at the proxy and pass their agent id in metadata. They never hold a provider key.

```python
import openai

client = openai.OpenAI(base_url="http://your-proxy:4000", api_key="sk-proxy-token")

client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Summarize this incident."}],
    metadata={"agent_id": "analyst", "team": "soc", "workflow": "incident-review"},
)
```

The pre-call hook checks the budget for `analyst`. If over and the budget is in `downgrade` mode, the request silently runs on `gpt-4o-mini` instead of being rejected. After the call, the real cost is recorded. That reject/alert/downgrade choice is the thing a plain proxy can't make -- LiteLLM alone gives you a hard cap or nothing.

## The multi-worker caveat (read this before production)

LOCO's `BudgetPolicy` keeps spend in an **in-process dict** (`loco/budget.py`). LiteLLM Proxy runs with multiple uvicorn workers (`--num_workers`) and often multiple replicas. Each worker process gets its own copy of the LOCO state, so:

- **Single worker, single replica** (`litellm --num_workers 1`): LOCO's budget counter is globally accurate.
- **Multiple workers or replicas**: each process counts only the traffic it handled. LOCO will **undercount** global spend -- a `$50` cap could allow `$50 x num_workers` before any single worker trips.

Two honest options for multi-worker deployments today:

1. **Hard dollar cap -> LiteLLM native budgets.** LiteLLM already stores per-key/per-team budgets in Redis/Postgres, so its caps are correct across workers. Use those for the global dollar ceiling.
2. **Decision logic -> LOCO.** Use the LOCO callback for what LiteLLM can't express: alert vs downgrade vs reject, composable budget+rate+access chains, and security-label access control. Combine the two -- LiteLLM holds the global cap, LOCO decides what happens around it.

Globally-consistent LOCO enforcement across workers needs externalized state (Redis-backed counters) plus a single accounting authority. That is not built into the open-source package yet; it is the [LOCO Cloud / managed mode](enforcement-model.md#3-managed-mode-loco-cloud-roadmap) roadmap.

## See also

- [Enforcement Model](enforcement-model.md) -- library vs gateway vs managed, and why
- [Load Function](load-function.md) -- the scheduling layer that runs in-process, not at the gateway
- [Policy Engine](policies.md) -- composing budget, rate, and access policies
- [Cost Attribution](cost-attribution.md) -- the 4D breakdown the `metadata` fields feed
