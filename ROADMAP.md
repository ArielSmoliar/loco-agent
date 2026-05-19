# LOCO-Agent Roadmap

> Ship schedule, scope, and dependencies for v0.1 through v0.2.

## v0.1 — Core Scheduler (shipping May 28, 2026)

The async-first scheduling engine. Proves the thesis works for AI agents.

| Status | Feature |
|--------|---------|
| Done | Load function validation (simulation notebook, 3 scenarios) |
| Done | Package scaffolding, Task/Agent/Scheduler/Resource classes |
| Done | Async acquire/release with grant-time scoring |
| Done | Backpressure, cancellation, lifecycle hooks |
| Done | `optimize_for` API ("latency" / "balanced" / "throughput") |
| Done | Full scenario validation — 4 scenarios, 120 tests |
| In progress | Vanilla adapter + split acquire/release + dynamic agent registration |
| In progress | Observability (structured JSON scheduling log, metrics API) |
| In progress | Examples, sandbox CLI, documentation |
| In progress | CI, release, SDK integration test plans (7 platforms) |

---

## v0.2 — Ecosystem + Enterprise

Framework adapters, enterprise features, and cross-platform integration. Phased into three drops so value ships incrementally.

### v0.2.0 — Direct-wrap adapters + cost tracking

> 3-4 weeks after v0.1

The two SDKs that work with the context-manager API today, plus the feedback loop on weight estimates.

| Feature | What it is | Estimate |
|---------|------------|----------|
| Anthropic SDK adapter | Wrap `client.messages.create()` in acquire/release. Compute weight from model tier + prompt tokens. | 1-2 days |
| OpenAI Agents SDK adapter | Custom `ModelProvider` wrapper. Sits between agent loop and API. Token accounting via `GenerationSpanData`. | 3-4 days |
| Empirical cost tracking | After each call completes, record actual token usage. Auto-adjust future weight estimates using exponential moving average. | 1 week |
| PyPI package | `pip install loco-agent` works. Proper versioning, release automation, CI publish. | 2-3 days |

**Why these first:** Anthropic and OpenAI use direct API calls — no callback boundary problem. Empirical cost tracking closes the weight estimation loop (static tiers become a bootstrap, not the steady state). PyPI makes adoption frictionless.

**Dependencies:** v0.1 shipped.

### v0.2.1 — Callback-based framework adapters + adaptive alpha

> 4-5 weeks after v0.2.0

The frameworks that need split acquire/release to hook into per-LLM-call callbacks.

| Feature | What it is | Estimate |
|---------|------------|----------|
| LangChain adapter | `BaseCallbackHandler.on_llm_start` / `on_llm_end`. Extracts model name from `serialized`, prompt length from `prompts`. Auto-registers agents on first callback. | 2-3 days |
| Google ADK adapter | `before_model_callback` / `after_model_callback`. Reads `ctx.model` and `ctx.agent_name`. Handles ADK's `ParallelAgent` (multiple concurrent sub-agents). | 2-3 days |
| CrewAI adapter | `step_callback` on Agent for per-step scheduling. `task_callback` on Crew for task-level events. Weight from tool type or model config. | 2-3 days |
| Adaptive alpha tuning | Nudge alpha based on observed wait-time variance (renormalization from thesis). When wait times diverge across agents, shift alpha toward latency. When queues grow unboundedly, shift toward throughput. | 1 week |

**Why this group:** All three callback-based frameworks share the same integration pattern (split acquire/release). Once one works, the others follow the template. Adaptive alpha makes the scheduler self-tuning — removes the last manual knob.

**Dependencies:** Split acquire/release API (v0.1 Day 8).

**Integration hooks per framework:**

| Framework | Pre-LLM hook | Post-LLM hook | Agent discovery |
|-----------|-------------|---------------|----------------|
| LangChain | `on_llm_start(serialized, prompts)` | `on_llm_end(response)` | Callback instance per agent |
| Google ADK | `before_model_callback(ctx, req)` | `after_model_callback(ctx, resp)` | `ctx.agent_name` |
| CrewAI | `step_callback(step_output)` | Implicit (step completes) | Agent role/name |

### v0.2.2 — Cloud platform adapters + enterprise features

> 5-6 weeks after v0.2.1

Enterprise-grade: cloud provider integration, multi-resource scheduling, budget enforcement.

| Feature | What it is | Estimate |
|---------|------------|----------|
| AWS Bedrock adapter | `RETURN_CONTROL` action group pauses the orchestration loop. LOCO-Agent decides when to resume via `InvokeAgent` with `returnControlInvocationResults`. AgentCore OTEL telemetry for passive metering. | 4-5 days |
| Azure / AutoGen adapter | AutoGen v0.4 custom `AgentRuntime` — the most scheduler-friendly surface in the ecosystem. Wraps `SingleThreadedAgentRuntime`, adds load-aware dispatch before message delivery. Foundry Responses API proxy as alternative path. | 4-5 days |
| Multi-resource contention | Agents acquiring multiple resources simultaneously (LLM + DB + GPU). Deadlock prevention via resource ordering. New scoring: `L(i, r)` per resource. | 2 weeks |
| Budget ceilings | Per-agent spend limits with enforcement. `BudgetExceededError` when cumulative cost exceeds threshold. Configurable action: reject, downgrade model tier, or alert. | 1 week |
| A2A protocol integration | Register LOCO-Agent as an A2A participant. Expose scheduling state via A2A agent card. Accept task submissions via A2A protocol from any compliant framework. | 2 weeks |
| Prometheus / OTEL exporter | Export scheduling metrics (wait times, utilization, cost per agent) to standard observability stacks. | 3-4 days |

**Why last:** Cloud adapters need real cloud accounts to test. Multi-resource contention is research-grade (thesis covers single-channel only). A2A spec is still stabilizing (v0.3 preview on Azure). Budget ceilings depend on empirical cost tracking (v0.2.0).

**Platform integration hooks:**

| Platform | Scheduling gate | Telemetry source | Agent discovery |
|----------|----------------|-----------------|----------------|
| AWS Bedrock | `RETURN_CONTROL` action group | AgentCore OTEL → CloudWatch | Action group registration |
| AWS AgentCore | A2A protocol | OTEL traces | AgentCore Registry |
| Azure Foundry | Responses API proxy | Azure Monitor / App Insights | Entra Agent Registry |
| AutoGen v0.4 | Custom `AgentRuntime` | Runtime message traces | Topic/subscription registration |

---

## Timeline summary

```
May 28          v0.1.0   Core scheduler ships
  |               |
  3-4 weeks       |
  |               v
Jun 25          v0.2.0   Anthropic + OpenAI adapters, empirical cost, PyPI
  |               |
  4-5 weeks       |
  |               v
Aug 1           v0.2.1   LangChain + ADK + CrewAI adapters, adaptive alpha
  |               |
  5-6 weeks       |
  |               v
Sep 12          v0.2.2   AWS + Azure adapters, multi-resource, A2A, budgets
```

Solo timeline. With a second contributor, v0.2.1 and v0.2.2 can overlap (adapters are independent of core engine work).

| Milestone | Solo | 2-person |
|-----------|------|----------|
| v0.2.0 | Jun 25 | Jun 20 |
| v0.2.1 | Aug 1 | Jul 15 |
| v0.2.2 | Sep 12 | Aug 15 |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Multi-resource deadlock prevention is hard | High | v0.2.2 slips | Start with resource ordering (simple, proven). Defer general deadlock detection to v0.3. |
| A2A spec churn (currently v0.3 preview) | Medium | Rework | Build against stable subset. Gate A2A release on spec GA. |
| Framework SDK breaking changes | Medium | Adapter rework | Pin SDK versions in tests. Adapters are thin — rework is days not weeks. |
| Cloud testing needs real accounts | Low | Delays AWS/Azure adapters | Use LocalStack for AWS. Use AutoGen local runtime for Azure. Cloud validation in CI with secrets. |
| Adaptive alpha tuning doesn't converge | Medium | Feature cut | Ship as experimental flag. Static alpha (v0.1) is the safe fallback. |
| Solo bandwidth | High | Everything slips | Prioritize adapters by ecosystem size: LangChain > OpenAI > ADK > CrewAI > AWS > Azure. Cut A2A first if needed. |

---

## What's explicitly NOT in v0.2

- **Agent topology / hidden terminal problem** — detecting agents that can't see each other's load. Requires distributed protocol design. v0.3+.
- **Multi-tenant scheduling** — separate scheduling domains within one process. Enterprise tier, needs design.
- **Model-tier routing** — automatically selecting which model to use based on load and budget. Depends on budget ceilings + empirical cost tracking. v0.3.
- **Streaming support** — scheduling for streaming LLM responses (partial token consumption). Needs different resource model. v0.3.
- **GUI dashboard** — visual scheduling monitor. After Prometheus exporter ships, this becomes a Grafana template. v0.3.
