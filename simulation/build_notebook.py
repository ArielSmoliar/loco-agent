"""
Build loco_simulation.ipynb as a reproducibility wrapper around the validated
hardened scheduler. Run from simulation/ with the venv python:

    ../.venv/bin/python build_notebook.py

This writes the source notebook (no outputs). Execute it separately to embed
the 20-seed tables and the canonical PNG figures.
"""
import nbformat as nbf

nb = nbf.v4.new_notebook()
md = nbf.v4.new_markdown_cell
code = nbf.v4.new_code_cell

cells = []

cells.append(md(r"""# LOCO-Agent: Load Function Validation

This notebook validates the core scheduling behavior of LOCO-Agent: a load-aware contention protocol that prioritizes agents under varying workload. It is a discrete scheduler model. One task is served per tick. There are no LLM calls, no network, and no real latency. It validates the behavior of the load function, not production throughput.

Every result below is the mean of 20 random seeds with 95% confidence intervals. The runs come from `loco_simulation_hardened.py`, the same code that produced the figures in the article series. The figures embedded here are the exact PNGs that the article references.

## The load function

$$L(i) = \alpha \cdot \frac{Q_i}{\max_j Q_j} + (1 - \alpha) \cdot \frac{D^{max}_i}{\max_j D^{max}_j}$$

| Term | Meaning |
|---|---|
| $Q_i$ | Weighted queue depth of agent $i$ (sum of task costs) |
| $D^{max}_i$ | Age of the oldest waiting task in agent $i$'s queue |
| $\alpha$ | Tuning weight: 1 = throughput-optimized, 0 = latency-optimized |

All values are normalized across competing agents, so the score is relative priority, not absolute cost. A single scheduler computes the scores each tick and serves one task from the highest-scoring agent, with a random tie-break.

## Scenarios

1. **Burst**: 8 agents receive work simultaneously. Does the load function surface high-backlog agents and conserve every task?
2. **Fairness under sustained load**: 10 agents generating work at different rates across alpha in {0, 0.25, 0.5, 0.75, 1.0}, run in two regimes (overloaded and sustainable). Who waits, and who starves?
3. **Urgent spike**: 10 background agents plus 5 urgent webhook agents that fire fresh at tick 30. Does the wait-time term escalate urgency on its own?

Trust scoring and adaptive alpha (renormalization) are deferred. This run validates the base load function: queue depth and wait time only."""))

cells.append(code("""import inspect

from loco_simulation_hardened import (
    Agent, LOCOScheduler,
    scenario1, scenario2, scenario3,
    jains, ci95, fmt,
    ALPHAS, N_SEEDS,
)
from IPython.display import Image, display

print(f"Loaded hardened scheduler module: {N_SEEDS} seeds, alphas = {ALPHAS}")"""))

cells.append(md("""## Core scheduler

The scheduler used below is the exact code in `loco_simulation_hardened.py`. Each tick it computes `L(i)` for every agent with a non-empty queue, serves one task from the highest scorer (random tie-break), then ages all remaining tasks. Jain's fairness is computed over per-agent completion counts, including agents with zero completions, so starved agents are counted honestly."""))

cells.append(code("""print(inspect.getsource(LOCOScheduler))
print(inspect.getsource(jains))"""))

cells.append(md("""---
## Scenario 1: Burst

**Setup:** 8 agents are idle. At tick 0, agent i receives i+1 tasks at once (1 through 8), 36 tasks total. This is a spike where every agent becomes active simultaneously.

**Claim to validate:** the scheduler surfaces high-backlog agents first and conserves every task. Service count per agent must equal tasks assigned exactly."""))

cells.append(code("""assigned, clear_ticks = scenario1()
print(f"Scenario 1: {assigned} tasks assigned.")
print(f"Cleared in exactly {sorted(clear_ticks)} ticks on every one of {N_SEEDS} seeds.")
print(f"Conservation holds (served == assigned) on all seeds: {clear_ticks == {assigned}}")"""))

cells.append(code('display(Image("scenario1_burst.png"))'))

cells.append(md("""**What the results show:** all 36 tasks clear in exactly 36 ticks on every seed. Nothing is dropped and nothing is served twice. Each agent is served exactly as many times as it had tasks, and the busiest agents drain first. This is the correctness floor: before any tradeoff, the scheduler conserves work and surfaces the largest backlogs."""))

cells.append(md("""---
## Scenario 2: Fairness under sustained load

**Setup:** 10 agents over 500 ticks. Agents 0 to 4 are high-arrival, agents 5 to 9 are low-arrival. Swept across alpha in {0, 0.25, 0.5, 0.75, 1.0}, run in two regimes:

- **Overloaded:** 2.5 tasks arrive per tick against 1 served per tick. The system cannot keep up, by construction.
- **Sustainable:** 0.7 tasks arrive per tick against 1 served. The system keeps up.

**Claim to validate:** alpha controls a real throughput-versus-fairness tradeoff under contention. The honest fairness metric is Jain's index over per-agent completion counts (which includes starved agents). "Starved" means an agent with zero completions in the window."""))

cells.append(code("""for label, rows in [
    scenario2([0.4] * 5 + [0.1] * 5, 500, "OVERLOADED (2.5 arr/tick vs 1 served)"),
    scenario2([0.1] * 5 + [0.04] * 5, 500, "SUSTAINABLE (0.7 arr/tick vs 1 served)"),
]:
    print(f"=== {label} ===")
    print(f"  {'alpha':>5} | {'hi-wait':>14} | {'lo-wait':>14} | "
          f"{'starved/10':>11} | {'Jain(compl)':>13} | {'%done':>7}")
    for a in ALPHAS:
        r = rows[a]
        print(f"  {a:>5.2f} | {fmt(r['hi'])} | {fmt(r['lo'])} | "
              f"{r['starved'][0]:5.2f} +/-{r['starved'][1]:4.2f} | "
              f"{r['jain_c'][0]:6.3f} +/-{r['jain_c'][1]:.3f} | "
              f"{r['done'][0]*100:5.1f}%")
    print()"""))

cells.append(code('display(Image("scenario2_fairness.png"))'))

cells.append(md("""**What the results show:**

- **Overloaded regime, the knob decides who suffers.** As alpha rises from 0 to 1, the number of starved agents (zero completions) rises from 0 to about 3.7 of 10, and Jain's fairness over completion counts drops from 0.72 to 0.49. Both effects are tight across 20 seeds.
- **The wait-time term is the fairness mechanism.** Throughput-only scheduling (alpha = 1) concentrates service on the deepest queues and starves most of the low-arrival agents. The (1 - alpha) * Dmax term is what prevents that.
- **Read the wait numbers carefully.** At high alpha the low-arrival agents' average wait looks small, but that is partly because starved agents have no completed tasks to average. The honest headline is the starvation count and the completion-fairness collapse, not a wait-time story.
- **Sustainable regime, alpha is moot.** When the system keeps up, every agent is served in about one tick at every alpha, nothing starves, 99.8% of work clears, and fairness sits flat near 0.82. Scheduling policy is a scarcity tool.

The system is capacity-bound in the overloaded regime: 1 served per tick over 500 ticks clears 500 of roughly 1250 arrivals, about 40% at every alpha. Scheduling decides who waits, not whether the system clears. A scheduler does not add capacity."""))

cells.append(md("""---
## Scenario 3: Urgent spike

**Setup:** 10 background agents running steadily (weight 2, trickle rate 0.07/tick) plus a 40-task preload at tick 0. At tick 30, 5 urgent webhook agents fire fresh (weight 1, age 0, no priority flag).

**Claim to validate:** the wait-time term escalates webhook priority on its own as they wait, with no manual priority rule. Note: the 70% figure refers to background arrival rate only; the 40-task preload is additional load on top."""))

cells.append(code("""s3 = scenario3()
print("=== Scenario 3: ticks after spike until a webhook is first served ===")
print(f"  {'alpha':>5} | {'ticks-after-spike':>20} | {'webhooks served/5':>18}")
for a in ALPHAS:
    r = s3[a]
    print(f"  {a:>5.2f} | {fmt(r['wait']):>20} | "
          f"{r['served'][0]:4.2f} +/-{r['served'][1]:.2f}")"""))

cells.append(code('display(Image("scenario3_spike.png"))'))

cells.append(md("""**What the results show:** all five urgent webhooks are served at every alpha. Latency-tuned scheduling (low alpha) serves them about 3x faster, roughly 33 ticks after the spike versus about 103 ticks at high alpha. Nobody set a priority: a fresh webhook's wait climbs every tick until it outranks the fat background queue, then it wins a slot. Urgency escalates out of the wait-time term. The caveat from Scenario 2 still holds: if arrivals exceed capacity forever, no scheduler saves you. This is responsiveness under pressure, not added capacity."""))

cells.append(md("""---
## Summary

| Scenario | Validates | Finding (20 seeds, 95% CIs) |
|---|---|---|
| 1. Burst | Conservation and backlog surfacing | 36 tasks cleared in exactly 36 ticks on every seed; service count equals tasks assigned |
| 2. Fairness | alpha shapes a throughput/fairness tradeoff under contention | Overloaded: starvation rises 0 to 3.7 of 10 and Jain (completions) drops 0.72 to 0.49 as alpha goes 0 to 1. Sustainable: alpha is moot, no starvation, ~1-tick waits |
| 3. Spike | Wait-time term escalates urgency without rules | All 5 webhooks served at every alpha; low alpha serves them ~3x faster (33 vs 103 ticks) |

### What this validates

The wait-time term (the (1 - alpha) * Dmax half of the load function) is the primary fairness mechanism. Suppress it (alpha = 1) and a third of the fleet can starve under sustained overload. It also escalates fresh urgent work without any manual priority flag. The tradeoff is real and bounded: it only bites under contention. With spare capacity, the choice of alpha barely matters.

### What this does NOT validate (deferred)

- **Trust scoring**: deprioritizing an agent stuck in a failure loop
- **Adaptive alpha (renormalization)**: updating alpha from the live load distribution
- **Multi-resource contention**: multiple shared resources at once
- **Dynamic task-cost estimation**: learned weights instead of static tiers
- **Real LLM throughput**: this is a discrete scheduler model, not a production benchmark"""))

nb["cells"] = cells
nb["metadata"] = {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python"},
}

with open("loco_simulation.ipynb", "w") as f:
    nbf.write(nb, f)
print(f"wrote loco_simulation.ipynb with {len(cells)} cells")
