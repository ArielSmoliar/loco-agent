# Contributing to LOCO-Agent

## Quick Start (< 5 minutes)

```bash
git clone https://github.com/ArielSmoliar/loco-agent.git
cd loco-agent
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest                         # 167 tests, all should pass
```

See the scheduler in action:

```bash
python sandbox.py --scenario webhook_spike --optimize-for latency
python examples/burst.py
```

## What We Need Most

**Framework adapters.** Each adapter extends LOCO-Agent to a new ecosystem. This is the highest-impact contribution you can make.

| Adapter | Framework | Status |
|---------|-----------|--------|
| Vanilla | Plain async Python | Shipped (v0.1) |
| LangChain | LangChain / LangGraph | Open |
| Google ADK | Google Agent Development Kit | Open |
| CrewAI | CrewAI | Open |
| OpenAI SDK | OpenAI Agents SDK | Open |
| Anthropic SDK | Claude API | Open |
| AWS Bedrock | AWS Bedrock Agents / AgentCore | Open |
| Azure / AutoGen | Azure Foundry / AutoGen v0.4 | Open |

Each adapter implements `BaseAdapter` from `loco/adapters/base.py`. See `loco/adapters/vanilla.py` as the reference implementation.

Two integration patterns:
- **Direct wrap:** `async with scheduler.acquire()` around the API call (Anthropic, OpenAI)
- **Callback-based:** `acquire_start()` / `release_handle()` across two callbacks (ADK, LangChain, CrewAI)

See [docs/sdk_integration_plans.md](docs/sdk_integration_plans.md) for detailed integration guides per platform.

## How to Contribute

### 1. Pick an issue

Look for issues labeled `good first issue`. Each one has:
- Background context
- Acceptance criteria
- Pointer to reference code
- Which tests to write

### 2. Write your first test

Use the testing utilities — 10 lines or less:

```python
from loco.testing import SyncTestScheduler, mock_agent

def test_my_agent_gets_priority():
    agents = [mock_agent("mine", pending_tasks=10),
              mock_agent("other", pending_tasks=2)]
    scheduler = SyncTestScheduler(agents, alpha=0.5, seed=42)
    result = scheduler.step()
    assert result.selected_agent.agent_id == "mine"
```

### 3. Submit a PR

- Fork, branch, PR against `main`
- CI must pass (pytest + ruff on Python 3.10-3.12)
- Include tests for new functionality
- One feature per PR -- keep them small and reviewable

## Code Style

- **Linter:** ruff (`ruff check .`)
- **Type hints:** required on all public APIs
- **Tests:** required for all new functionality

## Architecture

```
Adapters (framework-specific)
    ↓
AsyncLOCOScheduler (acquire/release + split acquire_start/release_handle)
    ↓
LOCOScheduler (compute_load_scores / select_agent — sync scoring core)
    ↓
SharedResource (capacity slots, waiters, grant-time scoring)
```

See [PLAN.md](PLAN.md) for the full architecture with diagrams, and [ROADMAP.md](ROADMAP.md) for v0.2 plans.

## Questions?

Open a [Discussion](https://github.com/ArielSmoliar/loco-agent/discussions) for questions, ideas, or design proposals. Use Issues for bugs and feature requests.
