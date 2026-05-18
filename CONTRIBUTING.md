# Contributing to LOCO-Agent

## Quick Start (< 5 minutes)

```bash
git clone https://github.com/ArielSmoliar/loco-agent.git
cd loco-agent
python -m venv .venv && source .venv/bin/activate
pip install numpy matplotlib jupyter
jupyter notebook simulation/loco_simulation.ipynb
```

Run the notebook. See the load function in action. You're ready.

## What We Need Most

**Framework adapters.** Each adapter extends LOCO-Agent to a new ecosystem. This is the highest-impact contribution you can make.

| Adapter | Framework | Status |
|---------|-----------|--------|
| Vanilla | Plain async Python | v0.1 (planned) |
| LangChain | LangChain / LangGraph | Open |
| Google ADK | Google Agent Development Kit | Open |
| CrewAI | CrewAI | Open |
| OpenAI SDK | OpenAI Agents SDK | Open |

Each adapter implements `BaseAdapter` from `loco/adapters/base.py`. See [SPEC.md](SPEC.md) for the interface definition.

## How to Contribute

### 1. Pick an issue

Look for issues labeled `good first issue`. Each one has:
- Background context
- Acceptance criteria
- Pointer to reference code
- Which tests to write

### 2. Fork and branch

```bash
git fork
git checkout -b your-feature-branch
```

### 3. Write tests

Every new feature needs tests. Use the testing utilities in `loco/testing.py` (once available) to validate your work against the scheduler.

### 4. Submit a PR

- Fork, branch, PR against `main`
- CI must pass (pytest + ruff on Python 3.10-3.12)
- Include tests for new functionality
- One feature per PR -- keep them small and reviewable

## Code Style

- **Linter:** ruff (`ruff check .`)
- **Type hints:** required on all public APIs
- **Tests:** required for all new functionality
- **Docstrings:** required on public methods

## Architecture

The project has three layers:

```
Adapters (framework-specific)
    ↓
LOCOScheduler (async acquire/release)
    ↓
Scoring Core (compute_load_scores / select_agent)
```

The scoring core is a pure function. The async layer manages resources. Adapters translate framework-specific patterns into the acquire/release lifecycle.

See [PLAN.md](PLAN.md) for the full architecture with diagrams.

## Questions?

Open a [Discussion](https://github.com/ArielSmoliar/loco-agent/discussions) for questions, ideas, or design proposals. Use Issues for bugs and feature requests.
