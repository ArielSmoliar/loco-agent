"""Scenario 3 — Webhook spike: urgency emerges from the math.

10 background agents at 70% utilization, then 5 urgent webhooks arrive
at tick 30. Their Dmax grows each tick they wait, naturally crossing
over background priority. No rules, no manual assignment.

Run: python examples/webhook_spike.py
"""

import numpy as np

from loco import Agent
from loco.scheduler import LOCOScheduler

N_BACKGROUND = 10
N_WEBHOOKS = 5
SPIKE_TICK = 30
RUN_TICKS = 250
TRICKLE_RATE = 0.07
INIT_TASKS = 4


def run_spike(alpha: float, seed: int = 42):
    bg_agents = [
        Agent(agent_id=f"bg-{i}", agent_type="scheduled")
        for i in range(N_BACKGROUND)
    ]
    wh_agents = [
        Agent(agent_id=f"wh-{i}", agent_type="webhook")
        for i in range(N_WEBHOOKS)
    ]
    sched = LOCOScheduler(bg_agents + wh_agents, alpha=alpha, seed=seed)
    rng = np.random.default_rng(seed=seed)

    # Pre-load background agents
    sched._step(arrivals={
        f"bg-{i}": [
            sched.new_task(weight=2.0, task_type="scheduled")
            for _ in range(INIT_TASKS)
        ]
        for i in range(N_BACKGROUND)
    })

    webhook_first_serve = {}

    for t in range(1, RUN_TICKS):
        arrivals = {}
        for i in range(N_BACKGROUND):
            if rng.random() < TRICKLE_RATE:
                arrivals[f"bg-{i}"] = [
                    sched.new_task(weight=2.0, task_type="scheduled")
                ]
        if t == SPIKE_TICK:
            for i in range(N_WEBHOOKS):
                arrivals[f"wh-{i}"] = [
                    sched.new_task(weight=1.0, task_type="webhook")
                ]

        result = sched._step(arrivals=arrivals)
        if result.selected_agent and result.selected_agent.agent_type == "webhook":
            aid = result.selected_agent.agent_id
            if aid not in webhook_first_serve:
                webhook_first_serve[aid] = sched.tick

    return {aid: tick - SPIKE_TICK for aid, tick in webhook_first_serve.items()}


def main():
    print(f"Webhook spike: {N_BACKGROUND} background + {N_WEBHOOKS} webhooks")
    print(f"Background: weight=2, trickle={TRICKLE_RATE}/tick (~70% utilization)")
    print(f"Webhooks: weight=1, arrive at tick {SPIKE_TICK}\n")

    for alpha in [0.0, 0.25, 0.5, 1.0]:
        waits = run_spike(alpha)
        n_served = len(waits)
        avg_wait = np.mean(list(waits.values())) if waits else float("inf")
        max_wait = max(waits.values()) if waits else float("inf")

        print(f"alpha={alpha:.2f} | served={n_served}/{N_WEBHOOKS} | "
              f"avg_wait={avg_wait:.0f} ticks | max_wait={max_wait:.0f} ticks")

    print("\nKey findings:")
    print("  - alpha=0: webhooks served fastest (Dmax escalation)")
    print("  - alpha=1: webhooks deprioritized (low Qi vs background)")
    print("  - No priority rules needed — urgency emerges from waiting")


if __name__ == "__main__":
    main()
