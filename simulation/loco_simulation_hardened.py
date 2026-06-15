"""
LOCO scheduler simulation -- hardened for publication.

Addresses the methodology gaps Codex flagged on the original notebook:
  1. Multi-seed runs (N=20) with 95% CIs instead of a single seed.
  2. Jain's fairness computed over per-agent COMPLETION COUNTS (all agents,
     including zero-completion/starved ones), not over positive wait times only.
     The old metric silently excluded starved agents and overstated fairness.
  3. Starvation reported as a first-class number: agents with zero completions.
  4. A sustainable-load variant (arrivals < service) alongside the overloaded one,
     so "wait" is not dominated by guaranteed backlog growth.
  5. Scenario 3 utilization wording clarified (preload is separate from arrival rate).

Scheduler is identical to the original notebook: one task served per tick,
L(i) = alpha*(Qi/maxQ) + (1-alpha)*(Dmax_i/maxDmax). No live LLM calls; this is a
discrete scheduler model, not a production benchmark.
"""
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

N_SEEDS = 20
ALPHAS = [0.0, 0.25, 0.5, 0.75, 1.0]


@dataclass
class Task:
    weight: float
    age: int = 0


@dataclass
class Agent:
    agent_id: int
    agent_type: str = "default"
    tasks: List[Task] = field(default_factory=list)
    completed: List[Task] = field(default_factory=list)

    @property
    def q(self) -> float:
        return sum(t.weight for t in self.tasks)

    @property
    def dmax(self) -> float:
        return max((t.age for t in self.tasks), default=0.0)

    def serve_oldest(self) -> Optional[Task]:
        if not self.tasks:
            return None
        oldest = max(self.tasks, key=lambda t: t.age)
        self.tasks.remove(oldest)
        self.completed.append(oldest)
        return oldest


class LOCOScheduler:
    def __init__(self, agents: List[Agent], alpha: float, seed: int):
        self.agents = agents
        self.alpha = alpha
        self.rng = random.Random(seed)
        self.tick = 0

    def scores(self) -> Dict[int, float]:
        active = [a for a in self.agents if a.tasks]
        if not active:
            return {}
        mq = max(a.q for a in active) or 1.0
        md = max(a.dmax for a in active) or 1.0
        return {
            a.agent_id: self.alpha * (a.q / mq) + (1 - self.alpha) * (a.dmax / md)
            for a in active
        }

    def step(self, arrivals: Dict[int, List[Task]] = None):
        if arrivals:
            for aid, tasks in arrivals.items():
                self.agents[aid].tasks.extend(tasks)
        sc = self.scores()
        served = None
        if sc:
            m = max(sc.values())
            cands = [a for a in self.agents if sc.get(a.agent_id) == m]
            served = self.rng.choice(cands)
            served.serve_oldest()
        for a in self.agents:
            for t in a.tasks:
                t.age += 1
        self.tick += 1
        return served


def jains(values: List[float]) -> float:
    """Jain's index over ALL values, including zeros. 1.0 = perfectly equal."""
    n = len(values)
    s = sum(values)
    sq = sum(v * v for v in values)
    if sq == 0:
        return 1.0
    return (s * s) / (n * sq)


def ci95(samples: List[float]) -> float:
    a = np.array(samples, dtype=float)
    if len(a) < 2:
        return 0.0
    return 1.96 * a.std(ddof=1) / np.sqrt(len(a))


# ----------------------------------------------------------------------------
# Scenario 1: Burst -- conservation check across seeds
# ----------------------------------------------------------------------------
def scenario1():
    N = 8
    clear_ticks = []
    for seed in range(N_SEEDS):
        agents = [Agent(i) for i in range(N)]
        s = LOCOScheduler(agents, alpha=0.5, seed=seed)
        s.step({i: [Task(1.0) for _ in range(i + 1)] for i in range(N)})
        while sum(len(a.tasks) for a in agents) > 0:
            s.step()
        served = sum(len(a.completed) for a in agents)
        assigned = N * (N + 1) // 2
        assert served == assigned, f"conservation broken: {served} != {assigned}"
        clear_ticks.append(s.tick)
    return assigned, set(clear_ticks)


# ----------------------------------------------------------------------------
# Scenario 2: Fairness -- overloaded vs sustainable, multi-seed
# ----------------------------------------------------------------------------
def scenario2(rates, n_ticks, label):
    N = len(rates)
    rows = {}
    for alpha in ALPHAS:
        hi_w, lo_w, starved_n, jain_compl, jain_wait_old, completed_frac = [], [], [], [], [], []
        for seed in range(N_SEEDS):
            agents = [Agent(i) for i in range(N)]
            s = LOCOScheduler(agents, alpha=alpha, seed=seed)
            rng = np.random.default_rng(seed)
            arrived = 0
            for _ in range(n_ticks):
                arr = {}
                for i, rate in enumerate(rates):
                    nn = int(rng.poisson(rate))
                    if nn:
                        arr[i] = [Task(1.0) for _ in range(nn)]
                        arrived += nn
                s.step(arr)
            waits = [float(np.mean([t.age for t in a.completed])) if a.completed else 0.0
                     for a in agents]
            compl = [len(a.completed) for a in agents]
            hi_w.append(np.mean(waits[:5]))
            lo_w.append(np.mean(waits[5:]))
            starved_n.append(sum(1 for c in compl if c == 0))
            jain_compl.append(jains(compl))
            pos_waits = [w for w in waits if w > 0]
            jain_wait_old.append(jains(pos_waits) if pos_waits else 1.0)
            completed_frac.append(sum(compl) / arrived if arrived else 1.0)
        rows[alpha] = dict(
            hi=(np.mean(hi_w), ci95(hi_w)),
            lo=(np.mean(lo_w), ci95(lo_w)),
            starved=(np.mean(starved_n), ci95(starved_n)),
            jain_c=(np.mean(jain_compl), ci95(jain_compl)),
            jain_w_old=(np.mean(jain_wait_old), ci95(jain_wait_old)),
            done=(np.mean(completed_frac), ci95(completed_frac)),
        )
    return label, rows


# ----------------------------------------------------------------------------
# Scenario 3: Spike -- multi-seed webhook latency
# ----------------------------------------------------------------------------
def scenario3():
    SPIKE, NBG, NWH, RUN, TRICKLE, INIT = 30, 10, 5, 250, 0.07, 4
    rows = {}
    for alpha in ALPHAS:
        waits, served_counts = [], []
        for seed in range(N_SEEDS):
            bg = [Agent(i, "scheduled") for i in range(NBG)]
            wh = [Agent(NBG + i, "webhook") for i in range(NWH)]
            s = LOCOScheduler(bg + wh, alpha=alpha, seed=seed)
            rng = np.random.default_rng(seed)
            s.step({i: [Task(2.0) for _ in range(INIT)] for i in range(NBG)})
            first = {}
            for t in range(1, RUN):
                arr = {}
                for i in range(NBG):
                    if rng.random() < TRICKLE:
                        arr[i] = [Task(2.0)]
                if t == SPIKE:
                    for i in range(NWH):
                        arr[NBG + i] = [Task(1.0)]
                served = s.step(arr)
                if served and served.agent_type == "webhook" and served.agent_id not in first:
                    first[served.agent_id] = s.tick
            after = [tk - SPIKE for tk in first.values()]
            served_counts.append(len(first))
            if after:
                waits.append(np.mean(after))
        rows[alpha] = dict(
            wait=(np.mean(waits), ci95(waits)) if waits else (float("nan"), 0.0),
            served=(np.mean(served_counts), ci95(served_counts)),
        )
    return rows


def fmt(mc):
    m, c = mc
    return f"{m:6.1f} +/- {c:4.1f}"


if __name__ == "__main__":
    print(f"LOCO hardened simulation  |  {N_SEEDS} seeds  |  95% CIs\n")

    assigned, ticks = scenario1()
    print("=== Scenario 1: Burst (conservation) ===")
    print(f"  {assigned} tasks assigned; cleared in exactly {assigned} ticks on every seed: "
          f"{ticks == {assigned}} (clear-tick set: {ticks})\n")

    for label, rows in [
        scenario2([0.4] * 5 + [0.1] * 5, 500, "OVERLOADED (2.5 arr/tick vs 1 served)"),
        scenario2([0.1] * 5 + [0.04] * 5, 500, "SUSTAINABLE (0.7 arr/tick vs 1 served)"),
    ]:
        print(f"=== Scenario 2: Fairness -- {label} ===")
        print(f"  {'alpha':>5} | {'hi-wait':>14} | {'lo-wait':>14} | {'starved/10':>12} | "
              f"{'Jain(compl)':>12} | {'Jain(wait,old)':>14} | {'%done':>10}")
        for a in ALPHAS:
            r = rows[a]
            print(f"  {a:>5.2f} | {fmt(r['hi'])} | {fmt(r['lo'])} | "
                  f"{r['starved'][0]:5.2f} +/-{r['starved'][1]:4.2f} | "
                  f"{r['jain_c'][0]:6.3f} +/-{r['jain_c'][1]:.3f} | "
                  f"{r['jain_w_old'][0]:6.3f} +/-{r['jain_w_old'][1]:.3f} | "
                  f"{r['done'][0]*100:5.1f}% +/-{r['done'][1]*100:.1f}")
        print()

    print("=== Scenario 3: Urgent spike (webhook latency after spike) ===")
    print("  Note: '70% utilization' refers to background ARRIVAL rate (10*0.07);")
    print("  the 40-task preload (4 per bg agent at tick 0) is additional load.")
    s3 = scenario3()
    print(f"  {'alpha':>5} | {'ticks-after-spike':>20} | {'webhooks served/5':>18}")
    for a in ALPHAS:
        r = s3[a]
        print(f"  {a:>5.2f} | {fmt(r['wait']):>20} | "
              f"{r['served'][0]:4.2f} +/-{r['served'][1]:.2f}")
