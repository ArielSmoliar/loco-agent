# Changelog

All notable changes to LOCO-Agent are documented in this file.

## v0.4.0 -- 2026-06-07

Enterprise Cost Dashboard + Observability. The sellable surface: platform engineers can now
answer "where are my tokens going?"

### Added

- **Prometheus exporter:** `loco/exporters/prometheus.py` -- 16 metrics (gauges, counters, histograms) with HTTP scrape endpoint
- **Cost attribution:** `loco/cost_attribution.py` -- per-team, per-workflow, per-model cost breakdowns via `CostAttribution` class
- **Trust scoring:** `loco/trust.py` -- 0-1000 behavioral score per agent with time decay, integrated into grant priority via `TrustScorer`
- **Multi-tenant isolation:** `loco/tenant.py` -- `MultiTenantScheduler` with per-tenant agent pools, cost ceilings, and starvation prevention
- **Token-to-outcome tracking:** `loco/outcomes.py` -- `OutcomeTracker` links token spend to task outcomes for ROI attribution
- **Grafana dashboard template:** `grafana/loco-agent-dashboard.json` -- importable dashboard for LOCO scheduling metrics
- **Grafana dashboard mock:** `docs/grafana-mock.html` -- visual HTML mock of the dashboard
- Task attribution fields: `team`, `workflow`, `model` on Task dataclass
- `loco.enable_prometheus(port=9090)` convenience API
- `trust_scorer=` parameter on `AsyncLOCOScheduler` for trust-based priority adjustment
- `prometheus` optional dependency: `pip install loco-agent[prometheus]`
- 486 tests across 27 test files

### Enterprise tier line

- Open core: Prometheus exporter, scheduling log, Grafana template
- Enterprise: Cost attribution, trust scoring, multi-tenant isolation, token-to-outcome tracking

## v0.3.0 -- 2026-06-05

Cost governance + policy engine. The positioning pivot: cost governance is the product surface,
the scheduler is the engine underneath.

### Added

- **Policy engine:** `Policy` base class, `PolicyEnforcer` composable enforcement layer at dispatch point
- **BudgetPolicy:** `BudgetManager` refactored as a `Policy` subclass (backward-compatible alias kept)
- **AccessPolicy:** Label-based access control per agent (open by default, restrict explicitly)
- **RatePolicy:** Token bucket rate limiter per agent
- **PolicyViolationError:** Base exception for all policy violations; `BudgetExceededError` is now a subclass
- **Static Plan/Step DAG:** `Plan` and `Step` dataclasses with topological sort, cycle detection, `ready_steps()`, `validate()`
- **SecurityLabel:** Enum (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`) as optional metadata on tasks; logged in scheduling events
- **SLO error budgets:** `SLOBudget` state machine (HEALTHY -> WARNING -> CRITICAL -> EXHAUSTED) with rolling window
- **Session cost tracking:** Tag tasks with `session_id`, query `cost_by_session()`, `cost_by_session_and_agent()`
- `Task.labels` field for security metadata
- `enforcer=` parameter on `AsyncLOCOScheduler` (replaces `budget=`, which still works)
- Structured logging for policy checks and violations
- Interactive learning guide for contributor onboarding (38 topics, 9 sections)
- 399 tests across 22 test files

### Changed

- `BudgetExceededError` is now a subclass of `PolicyViolationError`
- Both `acquire()` context manager and `acquire_start()`/`release_handle()` paths enforce policies

### Migration

- `BudgetManager` continues to work as a public alias for `BudgetPolicy`
- `budget=` parameter on the scheduler continues to work (internally wrapped in `PolicyEnforcer`)
- No breaking changes from v0.2

## v0.2.2 -- 2026-05-21

Ecosystem expansion + cost visibility. Framework adapters, budget management, PyPI distribution.

### Added

- **7 framework adapters:** Anthropic SDK, OpenAI Agents SDK, LangChain, Google ADK, CrewAI, AWS Bedrock, AutoGen
- **BudgetManager:** Per-agent spend limits with reject/alert/downgrade enforcement modes
- **Multi-resource contention:** Agents acquiring multiple resources simultaneously with deadlock prevention
- **Adaptive alpha:** `AdaptiveAlphaTuner` auto-tunes latency/throughput tradeoff from observed wait-time variance
- **A2A protocol:** Agent-to-Agent interoperability (agent card, task handling)
- **Convenience API:** `loco.configure()`, `loco.wrap()`, `loco.scheduled()`, `loco.set_budget()`
- **Pretty terminal output:** `LOCO_LOG=pretty` for colored human-readable scheduling events
- **CLI:** `loco doctor` (auto-detect frameworks), `loco version`
- **Empirical cost tuning:** EMA-based weight adjustment from actual token usage
- **Docs site:** MkDocs Material on GitHub Pages
- **Demos:** loco-adk-demo (live Gemini), loco-autogen-demo (security pipeline)
- Published to PyPI: `pip install loco-agent`
- 289 tests across 17 test files

## v0.1.0 -- 2026-05-19

Initial release. Async-first scheduling engine with proven convergence from 4 validated scenarios.

### Added

- **Load function:** `L(i) = alpha * (Qi / max Qj) + (1-alpha) * (Dmax_i / max Dmax_j)`
- **Async acquire/release:** Grant-time scoring, priority wait queue, logical ticks
- **`optimize_for` API:** `"latency"` / `"balanced"` / `"throughput"` maps to alpha internally
- **Backpressure:** `max_waiters` cap prevents unbounded queue growth
- **Cancellation:** `asyncio.timeout()` on acquire with clean removal from wait queue
- **Graceful shutdown:** `shutdown(timeout)` drains in-flight, cancels waiters
- **4 validated scenarios:** Burst, fairness (Jain's >= 0.98), webhook spike, MDASH security
- **Vanilla adapter:** Reference implementation for plain Python async callables
- **Structured JSON logging:** Per-event scheduling records with cost tracking
- **Metrics API:** `cost_by_agent()`, `total_cost()`, `wait_time_by_agent()`, `resource_utilization()`
- **Testing utilities:** `SyncTestScheduler`, `mock_agent()`, `mock_resource()`, `Scenario`
- **Sandbox CLI:** `python sandbox.py --scenario webhook_spike`
- AGPL-3.0 license
- 189 tests
