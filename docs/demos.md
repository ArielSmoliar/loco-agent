# Demos

Working demo applications that showcase LOCO-Agent with real frameworks.

## Google ADK -- Customer Support

3 ADK agents (triage, support, escalation) sharing a bounded Gemini API pool. Live Gemini API calls with LOCO scheduling.

**Repo:** [github.com/ArielSmoliar/loco-adk-demo](https://github.com/ArielSmoliar/loco-adk-demo)

```bash
git clone https://github.com/ArielSmoliar/loco-adk-demo.git
cd loco-adk-demo && pip install -e .
python run_mock.py              # no API key needed
python run_mock.py --capacity 1 # heavy contention
```

| Agent | Model | Weight | Role |
|-------|-------|--------|------|
| triage | gemini-2.5-flash | 1.5 | Classify tickets |
| support | gemini-2.5-flash | 1.5 | Handle simple tickets |
| escalation | gemini-2.5-pro | 3.0 | Handle complex issues |

## AutoGen -- Enterprise Security Pipeline

8 AutoGen agents with per-agent budget enforcement. Shows cost governance in action -- investigators hit their budget cap, the scheduler rejects further work and frees slots for other agents.

**Repo:** [github.com/ArielSmoliar/loco-autogen-demo](https://github.com/ArielSmoliar/loco-autogen-demo)

```bash
git clone https://github.com/ArielSmoliar/loco-autogen-demo.git
cd loco-autogen-demo && pip install -e .
python run_mock.py                      # reject mode
python run_mock.py --budget-mode alert  # allow over-budget with warnings
python run_mock.py --capacity 1         # heavy PTU contention
```

| Role | Count | Model | Weight | Budget |
|------|-------|-------|--------|--------|
| Coordinator | 1 | gpt-4o | 3.0 | uncapped |
| Analyst | 4 | gpt-4o-mini | 1.0 | 20 each |
| Investigator | 2 | gpt-4o | 3.0 | 12 each |
| Responder | 1 | gpt-4o | 3.0 | 15 |

## Built-In Examples

```bash
cd loco-agent
python examples/burst.py           # 8 agents, simultaneous work arrival
python examples/fairness.py        # 10 agents, sustained load, Jain's fairness
python examples/webhook_spike.py   # Background load + urgent webhook spike
python examples/mdash_security.py  # Multi-model cost routing (55 agents)
```
