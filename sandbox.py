#!/usr/bin/env python3
"""LOCO-Agent Sandbox — see contention resolution in action.

Run a scenario and watch tick-by-tick scheduling decisions.

Usage:
    python sandbox.py --scenario burst
    python sandbox.py --scenario webhook_spike --optimize-for latency
    python sandbox.py --scenario fairness --alpha 0.5 --ticks 100
    python sandbox.py --scenario mdash_security
"""

from __future__ import annotations

import argparse

import numpy as np

from loco import Agent
from loco.metrics import jains_fairness
from loco.scheduler import LOCOScheduler


def run_burst(sched: LOCOScheduler, n_agents: int, **_):
    """8 agents, agent i gets (i+1) tasks. All arrive at tick 0."""
    arrivals = {
        f"agent-{i}": [sched.new_task(weight=1.0) for _ in range(i + 1)]
        for i in range(n_agents)
    }
    sched._step(arrivals=arrivals)
    while sched.total_tasks_remaining() > 0:
        sched._step()


def run_fairness(sched: LOCOScheduler, n_agents: int, ticks: int, seed: int, **_):
    """Sustained load: agents 0-4 high (0.4), agents 5-9 low (0.1)."""
    rng = np.random.default_rng(seed=seed)
    rates = [0.4] * (n_agents // 2) + [0.1] * (n_agents - n_agents // 2)
    for _ in range(ticks):
        arrivals = {}
        for i, rate in enumerate(rates):
            n_new = rng.poisson(rate)
            if n_new > 0:
                arrivals[f"agent-{i}"] = [
                    sched.new_task(weight=1.0) for _ in range(n_new)
                ]
        sched._step(arrivals=arrivals)


def run_webhook_spike(sched: LOCOScheduler, n_agents: int, ticks: int, seed: int, **_):
    """Background agents + webhook spike at tick 30."""
    n_bg = n_agents
    n_wh = max(n_agents // 2, 1)
    # Add webhook agents
    for i in range(n_wh):
        aid = f"webhook-{i}"
        sched.agents[aid] = Agent(agent_id=aid, agent_type="webhook")

    rng = np.random.default_rng(seed=seed)
    sched._step(arrivals={
        f"agent-{i}": [sched.new_task(weight=2.0) for _ in range(4)]
        for i in range(n_bg)
    })
    for t in range(1, ticks):
        arrivals = {}
        for i in range(n_bg):
            if rng.random() < 0.07:
                arrivals[f"agent-{i}"] = [sched.new_task(weight=2.0)]
        if t == 30:
            for i in range(n_wh):
                arrivals[f"webhook-{i}"] = [sched.new_task(weight=1.0, task_type="webhook")]
        sched._step(arrivals=arrivals)


def run_mdash_security(sched: LOCOScheduler, ticks: int, **_):
    """20 auditors + 30 debaters + 5 provers. Provers arrive at tick 20."""
    for i in range(20):
        aid = f"auditor-{i}"
        sched.agents[aid] = Agent(agent_id=aid, agent_type="auditor")
    for i in range(30):
        aid = f"debater-{i}"
        sched.agents[aid] = Agent(agent_id=aid, agent_type="debater")
    for i in range(5):
        aid = f"prover-{i}"
        sched.agents[aid] = Agent(agent_id=aid, agent_type="prover")

    initial = {}
    for i in range(20):
        initial[f"auditor-{i}"] = [sched.new_task(weight=3.0) for _ in range(2)]
    for i in range(30):
        initial[f"debater-{i}"] = [sched.new_task(weight=1.0) for _ in range(3)]
    sched._step(arrivals=initial)

    for t in range(1, ticks):
        arrivals = {}
        if t == 20:
            for i in range(5):
                arrivals[f"prover-{i}"] = [sched.new_task(weight=5.0) for _ in range(2)]
        sched._step(arrivals=arrivals)


SCENARIOS = {
    "burst": run_burst,
    "fairness": run_fairness,
    "webhook_spike": run_webhook_spike,
    "mdash_security": run_mdash_security,
}


def print_results(sched: LOCOScheduler, scenario: str):
    """Print summary metrics."""
    print(f"\n{'='*60}")
    print(f"Results — {scenario}")
    print(f"{'='*60}")
    print(f"Total ticks: {sched.tick}")
    print(f"Total tasks served: {sum(len(a.completed_tasks) for a in sched.agents.values())}")

    # Per-agent summary
    print(f"\n{'Agent':<20} {'Served':>8} {'Mean Wait':>10} {'Type':<12}")
    print("-" * 54)
    for aid in sorted(sched.agents):
        agent = sched.agents[aid]
        served = len(agent.completed_tasks)
        wait = sched.mean_wait_time(aid)
        print(f"{aid:<20} {served:>8} {wait:>10.1f} {agent.agent_type:<12}")

    # Fairness
    waits = [sched.mean_wait_time(aid) for aid in sched.agents]
    fairness = jains_fairness(waits)
    print(f"\nJain's fairness index: {fairness:.3f}")

    # Starvation check
    starved = [aid for aid, a in sched.agents.items() if not a.completed_tasks]
    if starved:
        print(f"Starved agents ({len(starved)}): {', '.join(starved[:10])}")
    else:
        print(f"No starvation — all {len(sched.agents)} agents served")

    # Recent scheduling decisions
    print("\nLast 10 scheduling decisions:")
    for h in list(sched.history)[-10:]:
        aid = h["served_agent_id"] or "(none)"
        print(f"  tick {h['tick']:4d}: {aid}")


def main():
    parser = argparse.ArgumentParser(
        description="LOCO-Agent Sandbox — see contention resolution in action.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n"
               "  python sandbox.py --scenario burst\n"
               "  python sandbox.py --scenario webhook_spike --optimize-for latency\n"
               "  python sandbox.py --scenario fairness --alpha 0.5 --ticks 100\n"
               "  python sandbox.py --scenario mdash_security\n",
    )
    parser.add_argument(
        "--scenario", required=True,
        choices=list(SCENARIOS.keys()),
        help="Which scenario to run",
    )
    alpha_group = parser.add_mutually_exclusive_group()
    alpha_group.add_argument("--alpha", type=float, help="Raw alpha value (0.0-1.0)")
    alpha_group.add_argument(
        "--optimize-for",
        choices=["latency", "balanced", "throughput"],
        help="Preset alpha mapping",
    )
    parser.add_argument("--agents", type=int, default=8, help="Number of agents (default: 8)")
    parser.add_argument("--ticks", type=int, default=250, help="Number of ticks (default: 250)")
    parser.add_argument("--capacity", type=int, default=1, help="Resource capacity (default: 1)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed (default: 42)")

    args = parser.parse_args()

    # Build scheduler
    agents = [Agent(agent_id=f"agent-{i}") for i in range(args.agents)]
    sched = LOCOScheduler(
        agents,
        alpha=args.alpha,
        optimize_for=args.optimize_for,
        seed=args.seed,
    )

    print("LOCO-Agent Sandbox")
    print(f"Scenario: {args.scenario}")
    print(f"Alpha: {sched.alpha} (optimize_for={args.optimize_for or 'custom'})")
    print(f"Agents: {args.agents}, Ticks: {args.ticks}, Capacity: {args.capacity}")
    print(f"Seed: {args.seed}")

    # Run
    scenario_fn = SCENARIOS[args.scenario]
    scenario_fn(
        sched,
        n_agents=args.agents,
        ticks=args.ticks,
        capacity=args.capacity,
        seed=args.seed,
    )

    print_results(sched, args.scenario)


if __name__ == "__main__":
    main()
