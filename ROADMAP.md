# LOCO-Agent Roadmap

> Development plan from v0.1 through v1.0. Solo founder timeline -- dates are targets, not commitments.
> Lead positioning: **cost governance surface, scheduler engine underneath.**

---

## Shipped

### v0.1 -- Core Scheduler (May 2026)

The async-first scheduling engine. Proved the 2011 thesis works for AI agent fleets.

- Load function with grant-time scoring: `L(i) = alpha * (Qi/Qmax) + (1-alpha) * (Dmax_i/Dmax_max)`
- Async acquire/release with priority wait queue, backpressure, cancellation
- `optimize_for` API ("latency" / "balanced" / "throughput")
- 4 validated scenarios (burst, fairness, webhook spike, MDASH security)
- Vanilla adapter, lifecycle hooks, structured JSON scheduling log
- Sandbox CLI, examples, AGPL-3.0 license

### v0.2 -- Ecosystem + Cost Visibility (May 2026)

Framework adapters, cost tracking, convenience API, PyPI distribution.

- **7 framework adapters:** Anthropic SDK, OpenAI Agents SDK, LangChain, Google ADK, CrewAI, AWS Bedrock, AutoGen
- **BudgetManager:** Per-agent spend limits with reject/alert/downgrade enforcement modes
- **Multi-resource contention:** Agents acquiring multiple resources simultaneously
- **Adaptive alpha:** Self-tuning alpha based on observed wait-time variance
- **A2A protocol:** Agent-to-Agent interoperability (agent card, task handling)
- **Convenience API:** `loco.configure()`, `loco.wrap()`, `loco.scheduled()`, `loco.set_budget()`
- **Pretty terminal output:** `LOCO_LOG=pretty` for colored human-readable scheduling events
- **CLI:** `loco doctor` (auto-detect frameworks), `loco version`
- **PyPI:** `pip install loco-agent` (v0.2.2)
- **Docs site:** MkDocs Material on GitHub Pages
- **Demos:** loco-adk-demo (live Gemini), loco-autogen-demo (AutoGen security pipeline)
- 289 tests across 17 test files

---

## In Progress

### v0.3 -- Cost Governance + Policy Engine (June-July 2026)

> The positioning pivot: cost governance is the product surface, the scheduler is the engine.
> Enterprises ask "who's spending the budget?" before "who goes next?"

Generalizes BudgetManager into a policy framework. Adds static execution plans (validated by
Anthropic's dynamic workflows -- they generate JS orchestration scripts, proving plan-as-code
works at scale). Adds security metadata to task envelopes (NVIDIA secure agent architecture).

**Why this order:** The CIO dinner signal (Levie, 5/19) says token costs are the #1 enterprise
concern. Microsoft AGT ships policy enforcement without scheduling. LOCO ships scheduling without
policy enforcement. v0.3 closes the gap -- cost governance + policy in one dispatch decision.

| Feature | What it is | Source |
|---------|------------|--------|
| **PolicyEnforcer** | Unified enforcement layer at dispatch point. Evaluates policies before granting resource access. Replaces `budget=` parameter (backward-compatible). | NVIDIA arXiv:2603.50016 |
| **BudgetPolicy** | BudgetManager refactored as a policy type. Same behavior, composable with other policies. Migration: `BudgetManager` stays as public alias. | Existing BudgetManager |
| **AccessPolicy** | Which tools/resources each agent can use. Static rules evaluated at dispatch. | NVIDIA "static access-control rules" |
| **RatePolicy** | Per-agent request rate limits (e.g., max 10 acquires/minute). | Enterprise request pattern |
| **Static Plan** | Immutable execution DAG submitted with a task batch. Steps with dependencies. Audit-friendly -- "what was the plan when this ran?" is always answerable. | Anthropic dynamic workflows (validation), NVIDIA Position 1 |
| **SecurityLabel** | Optional metadata on task inputs/outputs (`public`/`internal`/`confidential`). Logged in scheduling events. Flow enforcement deferred to v0.5. | NVIDIA IFC labels |
| **Delegation audit records** | Every grant emits structured record: who requested, what was dispatched, why this routing, what it cost. | O'Reilly delegation problem (Prakash) |
| **SLO error budgets** | State machine (HEALTHY -> WARNING -> CRITICAL -> EXHAUSTED) with burn-rate alerting. Replaces binary reject/alert/downgrade. | Microsoft AGT |

**API sketch:**

```python
from loco import Plan, Step, PolicyEnforcer, BudgetPolicy, AccessPolicy

plan = Plan(steps=[
    Step("fetch", agent="reader"),
    Step("analyze", agent="analyst", depends_on=["fetch"]),
    Step("respond", agent="writer", depends_on=["analyze"]),
])

enforcer = PolicyEnforcer(policies=[
    BudgetPolicy(limits={"analyst": 50.0, "writer": 20.0}),
    AccessPolicy(rules={"reader": {"resources": ["email_api"]}}),
])

scheduler = AsyncLOCOScheduler(
    agents=agents, resource=resource,
    plan=plan, enforcer=enforcer,
)
```

**Migration path:** `BudgetManager` stays as alias. `budget=` parameter continues to work
(internally wraps in PolicyEnforcer). Deprecation warning on `budget=` in v0.5.

**Stretch goal:** Security-aware feedback middleware (validate tool results through structured
checks before the orchestrator sees raw text -- blocks indirect prompt injection vector).

---

### v0.4 -- Enterprise Cost Dashboard + Observability (August-September 2026)

> The sellable surface. Platform engineers need to answer: "where are my tokens going?"

| Feature | What it is |
|---------|------------|
| **Prometheus / OTEL exporter** | Export scheduling metrics (wait times, utilization, cost per agent, policy violations) to standard observability stacks |
| **Cost attribution** | Per-team, per-workflow, per-model cost breakdown. Roll up from per-task cost records already in scheduling log |
| **Token-to-outcome tracking** | Was the token spend worth it? Link scheduling decisions to task outcomes (success/failure/quality score). Closes the loop Jaya Gupta's context graphs miss |
| **Trust scoring** | 0-1000 behavioral score per agent with time decay. Fast agents get priority, timeout-prone agents get deprioritized. Dynamic weight adjustment from observed behavior |
| **Multi-tenant isolation** | Separate scheduling domains within one process. Tenant A's agents can't starve Tenant B. Per-tenant cost ceilings |
| **Grafana template** | Pre-built dashboard for LOCO scheduling metrics. Ships as JSON template after Prometheus exporter |

**Enterprise tier line:** Cost attribution, multi-tenant isolation, and trust scoring are
enterprise features (commercial license). The Prometheus exporter and scheduling log stay open core.

---

## Planned

### v0.5 -- Dynamic Plans + Durable Execution (Q4 2026)

> Static plans (v0.3) prove the model. v0.5 makes plans mutable at runtime.

| Feature | What it is | Informed by |
|---------|------------|-------------|
| **Mutable plans** | Plans revised in-flight based on environment feedback. Agent hits a 410 Gone endpoint -- plan adapts. Harder to audit, but necessary for long-horizon agents | NVIDIA Position 1, Anthropic dynamic workflows |
| **Resumable workflows** | Interrupted workflows skip completed steps on restart. Completed results cached. | Anthropic dynamic workflow caching |
| **External state management** | Coordination state lives outside agent conversation contexts. Prevents context window saturation at scale | Anthropic dynamic workflows key insight |
| **Environment health signals** | Load function ingests environment health (container status, API health, dependency availability), not just cost/latency | Cursor cloud agent lessons |
| **Implementer/Verifier/Fixer template** | Built-in workflow pattern: implementer executes, verifier validates, fixer corrects. Ships as a reusable Plan template | Anthropic dynamic workflow pattern |
| **SecurityLabel flow enforcement** | No write-down from confidential to public. Enforced at dispatch, not just logged | NVIDIA IFC, v0.3 label foundation |
| **Saga compensation** | Structured rollback for multi-step pipelines when mid-pipeline budget cap hit. Not just an exception | Microsoft AGT |

---

### v0.6 -- Cross-Provider Intelligence (Q1 2027)

> The multi-provider moat. No single vendor solves cross-provider scheduling.

| Feature | What it is |
|---------|------------|
| **Model-tier routing** | Automatically select which model/provider to use based on task complexity, load, and budget. Route simple tasks to Flash, complex tasks to Opus/o3 |
| **Cross-provider cost normalization** | Normalize token costs across Claude, GPT, Gemini for apples-to-apples comparison and routing decisions |
| **Empirical weight adjustment** | After each call, record actual vs. predicted token usage. Auto-adjust future weight estimates via exponential moving average |
| **Provider failover** | If one provider rate-limits, transparently reroute to another with equivalent capability |
| **Streaming support** | Scheduling for streaming LLM responses (partial token consumption). Different resource hold model |

---

### v1.0 -- LOCO Cloud (2027)

> Managed scheduling layer. The Confluent to LOCO-Agent's Kafka.

| Feature | What it is |
|---------|------------|
| **Managed scheduling** | Cloud-hosted LOCO scheduler. Pay per scheduling decision or per agent-hour |
| **Fleet dashboard** | Web UI for real-time scheduling visualization, cost monitoring, policy management |
| **SSO / RBAC** | Enterprise identity integration. Role-based access to scheduling domains |
| **Aggregate quota management** | When 50 teams run dynamic workflow sessions simultaneously, manage the aggregate token spend and API quota across all of them |
| **Agent topology detection** | Hidden terminal problem -- detecting agents that can't see each other's load. Distributed protocol design (thesis extension) |

---

## Competitive Landscape (as of May 2026)

These signals shape prioritization. Every confirmed gap is a feature LOCO fills.

| Platform | Scheduling | Cost governance | Policy enforcement | LOCO integration |
|----------|-----------|----------------|-------------------|-----------------|
| **Anthropic Claude Code** | Dynamic workflows (JS orchestration, 1K agents, 16 concurrent). Single-model, single-session. Zero cost governance. | None | None | `PreToolUse` hook on "Agent" tool |
| **Anthropic Agent SDK** | `max_turns` / `max_budget_usd` (termination, not scheduling) | USD cap only | None | Dynamic `maxTurns` at spawn |
| **Google ADK / Managed Agents** | None. `ParallelAgent` fires all sub-agents simultaneously | None | None | `before_agent_callback` bypass |
| **AWS AgentCore / Bedrock** | Account-level service quotas only | None | None | `RETURN_CONTROL` action group |
| **Azure / AutoGen v0.4** | None. PTU fast-fails assume app-layer scheduler | None | AGT (separate toolkit) | Custom `AgentRuntime` |
| **OpenAI Agents SDK** | 1 knob: `max_function_tool_concurrency` | `service_tier: "flex"` | None | Custom `ModelProvider` |
| **Microsoft AGT** | None (out of scope) | On roadmap | Yes (0% violation rate) | Pre-scheduling hook |

**The universal finding:** Every platform has zero scheduling infrastructure. Orchestration is
emerging (Anthropic dynamic workflows), but cost governance and cross-provider scheduling
remain unaddressed. LOCO-Agent is the layer between orchestration and resource allocation.

---

## Design Principles (Carry Forward)

These principles are informed by what we've learned and apply to all future versions.

1. **Cost governance is the product surface.** The scheduler is the engine underneath. Lead with
   "set a $50K/month cap on the marketing team's agent fleet" not "load-aware priority scoring."

2. **Plan-as-code, not plan-as-chat.** Orchestration decisions should be expressed as executable
   structures (DAGs, policies), not LLM reasoning. The LLM reasons once about strategy;
   execution is mechanical. (Validated by Anthropic dynamic workflows.)

3. **Framework-agnostic, provider-agnostic.** Enterprises run mixed fleets. LOCO schedules across
   all of them through a single dispatch layer.

4. **The scheduler is the natural audit layer.** It's the only component that sees who requested,
   what was dispatched, why, what it cost, and what it produced -- all at a single decision point.

5. **Be a dial, not a gate.** Harness boundaries loosen as agents mature (Cursor lesson).
   LOCO should be easy to tune down, not rigid to rip out.

6. **External state, not conversation state.** Coordination state must live outside agent
   contexts to scale beyond one session. (Anthropic dynamic workflows key insight.)

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Solo bandwidth | High | Everything slips right | Keep v0.3 tight. Cut stretch goals first. Adapter maintenance is low-cost (thin wrappers) |
| Framework SDK breaking changes | Medium | Adapter rework | Pin SDK versions in tests. Adapters are thin -- rework is days not weeks |
| A2A spec churn | Medium | Rework | Build against stable subset. Gate on spec GA |
| Dynamic workflows commoditize orchestration | Low | Positioning pressure | LOCO is the cross-provider layer above orchestration. Dynamic workflows validate the problem, not compete with the solution |
| Enterprise sales cycle before revenue | High | Runway pressure | Open core model. Cost dashboard is first revenue conversation. Design partners before sales |
| Mutable plans (v0.5) open attack surface | Medium | Security regression | Ship static plans first (v0.3). Mutable plans require security review + adversarial testing |

---

## Use Cases by Version

| Use case | First supported | Key features |
|----------|----------------|-------------|
| Multi-agent API scheduling | v0.1 | Load function, async acquire/release |
| Framework-agnostic integration | v0.2 | 7 adapters, convenience API |
| Per-agent/team cost limits | v0.2 | BudgetManager |
| Security pipeline (auditor/debater/prover) | v0.2 | Weighted queue depth, multi-model |
| Policy-governed dispatch | v0.3 | PolicyEnforcer, AccessPolicy, RatePolicy |
| Compliance audit trail | v0.3 | Delegation audit records, SLO error budgets |
| Enterprise cost dashboard | v0.4 | Prometheus export, cost attribution, Grafana |
| Multi-tenant scheduling | v0.4 | Tenant isolation, per-tenant ceilings |
| Long-horizon agent workflows | v0.5 | Mutable plans, resumable workflows, saga compensation |
| GPU pool scheduling | v0.5 | Resource-agnostic load function (same contention model) |
| Cross-provider model routing | v0.6 | Model-tier routing, cost normalization, failover |
| Managed scheduling (SaaS) | v1.0 | LOCO Cloud, fleet dashboard, RBAC |
