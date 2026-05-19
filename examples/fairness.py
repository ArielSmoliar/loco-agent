"""Scenario 2 — Fairness under sustained load.

10 agents at different arrival rates for 500 ticks. Demonstrates:
- alpha=0: near-perfect fairness (Jain's >= 0.98)
- alpha>=0.75: starvation (some agents get zero service)
- alpha=1: wait-time inversion (high-load agents wait longer)

Run: python examples/fairness.py
"""

import numpy as np

from loco import Agent
from loco.metrics import jains_fairness
from loco.scheduler import LOCOScheduler

N_AGENTS = 10
N_TICKS = 500
ARRIVAL_RATES = [0.4] * 5 + [0.1] * 5  # high-load + low-load


def run_fairness(alpha: float, seed: int = 42):
    agents = [Agent(agent_id=f"agent-{i}") for i in range(N_AGENTS)]
    sched = LOCOScheduler(agents, alpha=alpha, seed=seed)
    rng = np.random.default_rng(seed=seed)

    for _ in range(N_TICKS):
        arrivals = {}
        for i, rate in enumerate(ARRIVAL_RATES):
            n_new = rng.poisson(rate)
            if n_new > 0:
                arrivals[f"agent-{i}"] = [
                    sched.new_task(weight=1.0) for _ in range(n_new)
                ]
        sched._step(arrivals=arrivals)

    mean_waits = {
        f"agent-{i}": sched.mean_wait_time(f"agent-{i}")
        for i in range(N_AGENTS)
    }
    completions = {
        f"agent-{i}": len(sched.get_agent(f"agent-{i}").completed_tasks)
        for i in range(N_AGENTS)
    }
    return mean_waits, completions


def main():
    print(f"Fairness: {N_AGENTS} agents, {N_TICKS} ticks")
    print(f"High-load (agents 0-4): lambda=0.4 tasks/tick")
    print(f"Low-load  (agents 5-9): lambda=0.1 tasks/tick\n")

    for alpha in [0.0, 0.25, 0.5, 0.75, 1.0]:
        mean_waits, completions = run_fairness(alpha)
        fairness = jains_fairness(list(mean_waits.values()))
        min_comp = min(completions.values())
        starved = sum(1 for c in completions.values() if c == 0)

        avg_high = np.mean([mean_waits[f"agent-{i}"] for i in range(5)])
        avg_low = np.mean([mean_waits[f"agent-{i}"] for i in range(5, 10)])

        print(f"alpha={alpha:.2f} | Jain's={fairness:.3f} | "
              f"min_completions={min_comp} | starved={starved} | "
              f"wait high={avg_high:.1f} low={avg_low:.1f}")

    print("\nKey findings:")
    print("  - alpha=0: Dmax-only scheduling gives near-perfect equity")
    print("  - alpha>=0.75: low-load agents starve (Dmax term suppressed)")
    print("  - alpha=1: high-load agents paradoxically wait LONGER")
    print("  - Recommended: alpha=0.25 (optimize_for='balanced')")


if __name__ == "__main__":
    main()
