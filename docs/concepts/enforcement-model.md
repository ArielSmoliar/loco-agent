---
title: "Enforcement Model"
description: "How LOCO-Agent enforces budgets across three deployment modes -- from cooperative library to hard server-side enforcement"
---

# Enforcement Model

The most common question about LOCO-Agent: *"If it's a client-side library, what stops a developer from bypassing the budget?"*

Short answer: **nothing stops them in library mode -- that's not the only mode.** LOCO is a policy engine. Where you run it determines how hard the enforcement is.

## Three deployment modes

### 1. Library mode -- cooperative enforcement

The default. You `pip install loco-agent`, import it, and route calls through adapters. The PolicyEnforcer checks budgets before every LLM call inside your Python process.

```
Developer code
    └── import loco
         └── adapter.create()
              ├── PolicyEnforcer.check_all()  ← budget checked here
              └── LLM API call
```

A developer *could* bypass this by calling the LLM API directly -- just like they could bypass any library. This mode is useful when:

- **The team agrees to use LOCO.** Most internal teams don't sabotage their own guardrails.
- **Accidents, not malice, are the risk.** A runaway loop or misconfigured retry burns budget. LOCO catches that even if everyone cooperates.
- **You need visibility before walls.** See who spends what before deciding where to put limits.

Think of it like Python's `logging` module -- it works because everyone uses it, not because it's enforced by the OS.

### 2. Gateway mode -- hard enforcement

This is how you make budgets mandatory. The gateway holds the API keys; developers never touch them. Any proxy works -- LiteLLM, a custom service, nginx. LOCO runs server-side inside it.

```
Developer code (any language, any framework)
    └── HTTP request to gateway
         └── Gateway (LiteLLM, custom proxy, nginx, etc.)
              ├── LOCO PolicyEnforcer runs server-side
              ├── Budget/rate/access policies evaluated
              └── If allowed: forwards to LLM API using real key
                  If rejected: returns 429 / budget error

Developers never hold raw API keys.
The gateway holds the keys.
```

This is the same pattern behind every production API system:

- You can write any SQL you want, but the database enforces row-level security.
- You can send any HTTP request, but the API gateway enforces rate limits.
- You can write any LLM call you want, but the gateway enforces the budget.

**What changes from library mode:**

| | Library mode | Gateway mode |
|---|---|---|
| API keys | Developers hold keys | Gateway holds keys |
| Enforcement | In-process, cooperative | Server-side, mandatory |
| Bypass | Call the API directly | Can't -- no keys |
| Setup cost | `pip install` | Deploy a proxy + LOCO |
| Best for | Internal teams, prototyping | Production, multi-team orgs |

**Practical setup -- minimal FastAPI gateway (copy-paste starter):**

You don't need a dedicated gateway product. A lightweight FastAPI service with LOCO as middleware is enough to get hard enforcement:

```python
# gateway.py -- 30-line LLM gateway with LOCO budget enforcement
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import httpx

from loco.policy import PolicyEnforcer, PolicyViolationError
from loco.budget import BudgetPolicy
from loco.task import Task

app = FastAPI()
client = httpx.AsyncClient()

# Configure policies once at startup
budget = BudgetPolicy(default_limit=50.0)  # $50/agent/day
budget.set_limit("expensive-agent", 200.0)
enforcer = PolicyEnforcer(policies=[budget])

LLM_API = "https://api.openai.com"  # or api.anthropic.com
API_KEY = "sk-..."  # the real key -- developers never see this


@app.post("/v1/chat/completions")
async def proxy(request: Request):
    body = await request.json()
    agent_id = request.headers.get("X-Agent-Id", "unknown")
    task = Task(weight=1.0, task_type="llm_call")

    try:
        enforcer.check_all(agent_id, task)
    except PolicyViolationError as e:
        return JSONResponse(
            status_code=429,
            content={"error": f"Policy rejected: {e.detail}"},
        )

    # Forward to the real LLM API with the real key
    resp = await client.post(
        f"{LLM_API}/v1/chat/completions",
        json=body,
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    enforcer.record_all(agent_id, task)
    return JSONResponse(status_code=resp.status_code, content=resp.json())
```

Developers point their code at `http://your-gateway:8000` instead of `api.openai.com`. They never hold API keys. Budget enforcement is mandatory.

**Or plug LOCO into an existing gateway:**

If you already run LiteLLM Proxy, a custom nginx setup, or any reverse proxy:

1. Deploy LiteLLM (or your proxy) as the LLM gateway
2. Add LOCO as the policy layer in the proxy's middleware
3. Issue proxy-scoped tokens to developers (not raw API keys)
4. LOCO's PolicyEnforcer runs inside the proxy process
5. Developers call the proxy endpoint; budget is enforced before the request ever reaches OpenAI/Anthropic

The point: **you don't write a gateway from scratch.** Either use the 30-line starter above, or plug LOCO into whatever proxy you already run.

For a complete, copy-paste LiteLLM setup -- the `CustomLogger` callback, the `config.yaml`, and the honest multi-worker caveat -- see [LiteLLM Gateway Integration](litellm-gateway.md).

#### Why not just use a gateway alone?

A gateway without LOCO can enforce a dollar cap. But a dollar cap is a blunt instrument. Here's what LOCO adds at the gateway that a simple proxy can't do on its own:

| Capability | Plain gateway | Gateway + LOCO |
|---|---|---|
| "Reject calls over $500/day" | Yes | Yes |
| "Agent A is over budget -- give the slot to Agent B" | No | **L(i) load-aware scheduling** |
| "This agent keeps failing -- deprioritize it" | No | **Trust scoring** |
| "Alert on overspend but don't block; downgrade the model tier instead" | No | **Three enforcement modes** (reject, alert, downgrade) |
| "Show me cost by team, workflow, model, and session" | No | **4D cost attribution** |
| "Compose budget + rate limit + access control in one pipeline" | No | **PolicyEnforcer chain** |
| "Re-score all waiting agents when a slot opens" | No | **Dynamic contention resolution** |

A gateway decides *whether* a request passes. LOCO decides *which* request should go next, *what* should happen when budgets are tight, and *who* spent what after the fact. The gateway is the lock on the door. LOCO is the brain that decides who gets the key.

### 3. Managed mode -- LOCO Cloud (roadmap)

The hosted version where enforcement, dashboards, and audit trails move entirely server-side. Developers interact through the SDK, but:

- Fleet-wide budgets enforced centrally
- SSO and per-tenant cost ceilings
- Audit trail with cryptographic proof of enforcement
- No proxy to self-host

This is on the [roadmap](https://github.com/ArielSmoliar/loco-agent) for v1.0.

## Which mode should I use?

| Situation | Mode |
|---|---|
| Solo developer or small team | Library |
| Internal platform, shared budget | Library or gateway |
| Multi-team org, real dollar limits | Gateway |
| Compliance/audit requirements | Gateway or managed |
| "Developers must not exceed $X/day" | Gateway (keys at gateway) |

## The key insight

Any team can put a proxy in front of their LLM APIs and enforce a dollar cap. That's a solved problem. The unsolved problem is what happens *at* the dispatch point when multiple agents compete for expensive capacity under budget pressure.

LOCO-Agent is not a gateway. It's the **policy engine that runs inside one.** The gateway makes enforcement mandatory (keys stay server-side). LOCO makes enforcement intelligent:

- **Scheduling under contention.** When 10 agents want 3 slots, LOCO's load function decides who goes next -- not FIFO, not random, but scored by queue depth, wait time, priority, and trust.
- **Budget as a decision, not just a wall.** Reject, alert, or downgrade. Per agent, per team, per tenant. Composable with rate limits and access control.
- **Attribution after the fact.** The gateway knows "a request came in." LOCO knows it was the analyst agent, on the SOC team, running the incident-review workflow, using opus, in session req-abc123.

The deployment topology decides whether enforcement is cooperative or mandatory. LOCO decides what "enforcement" actually means.

- **In your app process** -- cooperative, useful, not tamper-proof.
- **In a gateway you control** -- mandatory, tamper-proof, developers never touch keys.
- **In LOCO Cloud** -- managed, tamper-proof, zero infra on your side.

The code is the same in all three cases.

## FAQ

**Q: Why ship library mode at all if it's bypassable?**

Because most teams start with visibility, not enforcement. You need to know who spends what *before* you can set meaningful budgets. Library mode gives you cost attribution, queue observability, and policy prototyping with a single `pip install`. When you're ready for hard limits, move the same policy engine behind a gateway.

**Q: Can I run library mode and gateway mode together?**

Yes. Library mode gives you in-app observability (queue depth, wait times, trust scores). Gateway mode gives you hard budget enforcement. The two are complementary -- the library surfaces detail the gateway can't see (like which internal agent is responsible for a call), and the gateway prevents bypass the library can't enforce.

**Q: What about multi-tenant isolation?**

LOCO's `MultiTenantScheduler` isolates agent pools and cost ceilings per tenant. In gateway mode, map each tenant to their proxy credentials. The tenant can't exceed their ceiling even if they write arbitrary code -- the gateway rejects calls once the ceiling is hit. See [Multi-Tenant Isolation](multi-tenant.md).
