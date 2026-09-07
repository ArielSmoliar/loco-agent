# Contributing to LOCO-Agent

> **New here?** Start with the [Interactive Learning Guide](https://arielsmoliar.github.io/loco-agent/learning-guide/): 38 topics covering the load function, core entities, scheduler layers, policies, adapters, testing, and more. Each topic includes real code, mental models, and hands-on exercises.

## Quick Start (< 5 minutes)

```bash
git clone https://github.com/ArielSmoliar/loco-agent.git
cd loco-agent
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest                         # 486 tests should pass
```

See the scheduler in action:

```bash
python sandbox.py --scenario webhook_spike --optimize-for latency
python examples/burst.py
```

## Where contributions matter now

LOCO has a working scheduling and cost-governance foundation. The next stage needs evidence, sharper interfaces, and adversarial review more than another broad feature list.

| Track | Useful first contribution |
|-------|---------------------------|
| **Scheduling evidence** | Add one reproducible FIFO, round-robin, static-priority, semaphore, or random baseline to the benchmark harness |
| **Metric correctness** | Define and test starvation-aware fairness, wait percentiles, utilization, and cost per successful outcome |
| **Monitor contracts** | Review or prototype framework-neutral action events, risk findings, and trajectory state |
| **Security experiments** | Model one containment failure, authorization bypass, monitor outage, or campaign-limit scenario in an isolated test |
| **Ecosystem integrations** | Maintain one of the seven shipped adapters or add a framework with a clear interception boundary |
| **Observability** | Improve metrics, replay, dashboards, or the link between a scheduling decision and its downstream outcome |

The monitoring-aware control plane is a research direction, not a shipped security product. Read the [roadmap](ROADMAP.md) and [threat model](THREAT_MODEL.md) before proposing security-sensitive behavior.

### Shipped adapters

| Adapter | Integration pattern |
|---------|---------------------|
| Vanilla, Anthropic, OpenAI, AWS Bedrock | Direct wrap around the provider call |
| Google ADK, LangChain, CrewAI | Framework lifecycle callbacks |
| Azure / AutoGen | Runtime message interception |

Each adapter implements `BaseAdapter` from `loco/adapters/base.py`. See `loco/adapters/vanilla.py` as the smallest reference implementation and [the adapter documentation](docs/adapters/index.md) for current usage.

The two common integration patterns are:
- **Direct wrap:** `async with scheduler.acquire()` around the API call (Anthropic, OpenAI)
- **Callback-based:** `acquire_start()` / `release_handle()` across two callbacks (ADK, LangChain, CrewAI)

See [docs/sdk_integration_plans.md](docs/sdk_integration_plans.md) for implementation notes by platform.

## How to Contribute

### 1. Pick an issue

Look for issues labeled [`good first issue`](https://github.com/ArielSmoliar/loco-agent/labels/good%20first%20issue). Each one should have:
- Background context
- Acceptance criteria
- Pointer to reference code
- Which tests to write

### 2. Write your first test

Use the testing utilities in 10 lines or less:

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
- One feature per PR; keep them small and reviewable

## Code Style

- **Linter:** ruff (`ruff check .`)
- **Type hints:** required on all public APIs
- **Tests:** required for all new functionality

## Architecture

```
Adapters (framework-specific)
    |
AsyncLOCOScheduler (acquire/release + split acquire_start/release_handle)
    |
LOCOScheduler (compute_load_scores / select_agent, sync scoring core)
    |
SharedResource (capacity slots, waiters, grant-time scoring)
```

See [PLAN.md](PLAN.md) for the architecture and [ROADMAP.md](ROADMAP.md) for the current development direction.

## Questions?

Open a [Discussion](https://github.com/ArielSmoliar/loco-agent/discussions) for questions, ideas, or design proposals. Use Issues for bugs and feature requests.
