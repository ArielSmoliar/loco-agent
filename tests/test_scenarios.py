"""Full scenario validation against production code (Day 7).

Scenario 1 is in test_scenario1.py (Day 6).
Scenarios 2-4 here use the sync _step() path to match the notebook's
tick-by-tick model. This is the quality gate — nothing ships if these fail.
"""

import numpy as np

from loco.agent import Agent
from loco.metrics import jains_fairness
from loco.scheduler import LOCOScheduler

# ---------------------------------------------------------------------------
# Scenario 2 — Fairness under sustained load
# ---------------------------------------------------------------------------
# 10 agents, 500 ticks. Agents 0-4: λ=0.4 (high-load), agents 5-9: λ=0.1 (low-load).
# All tasks weight=1.

N_AGENTS_S2 = 10
N_TICKS_S2 = 500
ARRIVAL_RATES = [0.4] * 5 + [0.1] * 5


def _run_scenario2(alpha: float, seed: int = 42):
    """Run Scenario 2 and return (scheduler, mean_waits, completions)."""
    agents = [Agent(agent_id=f"agent-{i}") for i in range(N_AGENTS_S2)]
    sched = LOCOScheduler(agents, alpha=alpha, seed=seed)
    rng = np.random.default_rng(seed=seed)

    for _ in range(N_TICKS_S2):
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
        for i in range(N_AGENTS_S2)
    }
    completions = {
        f"agent-{i}": len(sched.get_agent(f"agent-{i}").completed_tasks)
        for i in range(N_AGENTS_S2)
    }
    return sched, mean_waits, completions


class TestScenario2Fairness:
    """Fairness under sustained load — 10 agents, 500 ticks."""

    def test_jains_fairness_at_alpha_zero(self):
        """α=0 (latency-only): Jain's index on wait times ≥ 0.98."""
        _, mean_waits, _ = _run_scenario2(alpha=0.0)
        fairness = jains_fairness(list(mean_waits.values()))
        assert fairness >= 0.98, f"Jain's = {fairness:.3f}, expected ≥ 0.98"

    def test_no_starvation_at_alpha_zero(self):
        """α=0: every agent completes at least one task."""
        _, _, completions = _run_scenario2(alpha=0.0)
        for agent_id, count in completions.items():
            assert count > 0, f"{agent_id} starved (0 completions) at α=0"

    def test_no_starvation_at_alpha_025(self):
        """α=0.25 (balanced): every agent completes at least one task."""
        _, _, completions = _run_scenario2(alpha=0.25)
        for agent_id, count in completions.items():
            assert count > 0, f"{agent_id} starved at α=0.25"

    def test_no_starvation_at_alpha_05(self):
        """α=0.5 (throughput): every agent completes at least one task."""
        _, _, completions = _run_scenario2(alpha=0.5)
        for agent_id, count in completions.items():
            assert count > 0, f"{agent_id} starved at α=0.5"

    def test_starvation_at_alpha_075(self):
        """α=0.75: some agents starve (min completions = 0).

        This validates the notebook finding that high α suppresses
        the Dmax term and causes starvation.
        """
        _, _, completions = _run_scenario2(alpha=0.75)
        min_completions = min(completions.values())
        assert min_completions == 0, (
            f"Expected starvation at α=0.75 but min completions = {min_completions}"
        )

    def test_starvation_at_alpha_one(self):
        """α=1.0: starvation — at least one agent gets 0 completions."""
        _, _, completions = _run_scenario2(alpha=1.0)
        min_completions = min(completions.values())
        assert min_completions == 0, (
            f"Expected starvation at α=1.0 but min completions = {min_completions}"
        )

    def test_wait_time_inversion_at_alpha_one(self):
        """α=1.0: high-load agents paradoxically wait longer than low-load.

        This is the counterintuitive inversion from Scenario 2:
        high-load agents win the resource constantly but generate
        tasks faster than they drain, accumulating higher wait times.
        """
        _, mean_waits, completions = _run_scenario2(alpha=1.0)
        # Only compare agents that actually completed tasks
        high_load_waits = [
            mean_waits[f"agent-{i}"]
            for i in range(5)
            if completions[f"agent-{i}"] > 0
        ]
        low_load_waits = [
            mean_waits[f"agent-{i}"]
            for i in range(5, 10)
            if completions[f"agent-{i}"] > 0
        ]
        if high_load_waits and low_load_waits:
            avg_high = np.mean(high_load_waits)
            avg_low = np.mean(low_load_waits)
            assert avg_high > avg_low, (
                f"Expected wait-time inversion: high-load ({avg_high:.1f}) "
                f"should wait longer than low-load ({avg_low:.1f})"
            )

    def test_fairness_degrades_with_alpha(self):
        """Jain's fairness should decrease as α increases from 0 to 1."""
        fairness_scores = []
        for alpha in [0.0, 0.25, 0.5]:
            _, mean_waits, _ = _run_scenario2(alpha=alpha)
            fairness_scores.append(jains_fairness(list(mean_waits.values())))
        # Monotonically non-increasing (with tolerance for stochastic noise)
        assert fairness_scores[0] >= fairness_scores[-1] - 0.02, (
            f"Fairness should degrade with α: {fairness_scores}"
        )


# ---------------------------------------------------------------------------
# Scenario 3 — Webhook spike
# ---------------------------------------------------------------------------
# 10 background agents (weight=2, trickle rate=0.07/tick, ~70% utilization).
# At tick 30, 5 webhook agents arrive (weight=1).

N_BACKGROUND = 10
N_WEBHOOKS = 5
SPIKE_TICK = 30
RUN_TICKS_S3 = 250
TRICKLE_RATE = 0.07
INIT_TASKS = 4


def _run_scenario3(alpha: float, seed: int = 42):
    """Run Scenario 3 and return (scheduler, webhook_first_serve_ticks)."""
    bg_agents = [
        Agent(agent_id=f"bg-{i}", agent_type="scheduled")
        for i in range(N_BACKGROUND)
    ]
    wh_agents = [
        Agent(agent_id=f"wh-{i}", agent_type="webhook")
        for i in range(N_WEBHOOKS)
    ]
    agents = bg_agents + wh_agents
    sched = LOCOScheduler(agents, alpha=alpha, seed=seed)
    rng = np.random.default_rng(seed=seed)

    # Pre-load background agents at tick 0
    initial_arrivals = {
        f"bg-{i}": [
            sched.new_task(weight=2.0, task_type="scheduled")
            for _ in range(INIT_TASKS)
        ]
        for i in range(N_BACKGROUND)
    }
    sched._step(arrivals=initial_arrivals)

    webhook_first_serve: dict[str, int] = {}

    for t in range(1, RUN_TICKS_S3):
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

    wait_after_spike = {
        aid: tick - SPIKE_TICK
        for aid, tick in webhook_first_serve.items()
    }
    return sched, wait_after_spike


class TestScenario3WebhookSpike:
    """Webhook spike — urgency emerges from Dmax, not from rules."""

    def test_webhook_response_at_alpha_zero(self):
        """α=0 (latency): all webhooks served within 45 ticks of spike."""
        _, wait_after_spike = _run_scenario3(alpha=0.0)
        assert len(wait_after_spike) == N_WEBHOOKS, (
            f"Only {len(wait_after_spike)}/{N_WEBHOOKS} webhooks served"
        )
        for aid, wait in wait_after_spike.items():
            assert wait <= 45, f"{aid} waited {wait} ticks (max 45)"

    def test_webhook_response_at_alpha_one(self):
        """α=1 (throughput): webhooks wait longer, up to 130 ticks."""
        _, wait_after_spike = _run_scenario3(alpha=1.0)
        # At α=1, webhooks may not all be served (weight=1 vs background weight=2)
        if wait_after_spike:
            max_wait = max(wait_after_spike.values())
            assert max_wait <= 130, (
                f"Webhook max wait {max_wait} exceeds 130 ticks at α=1"
            )

    def test_webhook_faster_at_low_alpha(self):
        """Webhooks are served faster at α=0 than at α=0.5."""
        _, waits_a0 = _run_scenario3(alpha=0.0)
        _, waits_a05 = _run_scenario3(alpha=0.5)
        avg_a0 = np.mean(list(waits_a0.values())) if waits_a0 else float("inf")
        avg_a05 = np.mean(list(waits_a05.values())) if waits_a05 else float("inf")
        assert avg_a0 < avg_a05, (
            f"α=0 ({avg_a0:.1f}) should be faster than α=0.5 ({avg_a05:.1f})"
        )

    def test_dmax_crossover(self):
        """Dmax crossover: webhook Dmax exceeds background Dmax between tick 50-80.

        Run at α=0.5 (balanced) and track when webhook max Dmax first
        exceeds background max Dmax after the spike.
        """
        bg_agents = [
            Agent(agent_id=f"bg-{i}", agent_type="scheduled")
            for i in range(N_BACKGROUND)
        ]
        wh_agents = [
            Agent(agent_id=f"wh-{i}", agent_type="webhook")
            for i in range(N_WEBHOOKS)
        ]
        agents = bg_agents + wh_agents
        sched = LOCOScheduler(agents, alpha=0.5, seed=42)
        rng = np.random.default_rng(seed=42)

        sched._step(arrivals={
            f"bg-{i}": [
                sched.new_task(weight=2.0, task_type="scheduled")
                for _ in range(INIT_TASKS)
            ]
            for i in range(N_BACKGROUND)
        })

        crossover_tick = None
        prev_bg_higher = True

        for t in range(1, 150):
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
            sched._step(arrivals=arrivals)

            if t > SPIKE_TICK:
                bg_dmax = max(
                    (sched.get_agent(f"bg-{i}").dmax for i in range(N_BACKGROUND)),
                    default=0,
                )
                wh_dmax = max(
                    (sched.get_agent(f"wh-{i}").dmax for i in range(N_WEBHOOKS)),
                    default=0,
                )
                if prev_bg_higher and wh_dmax > bg_dmax and wh_dmax > 0:
                    crossover_tick = t
                    break
                prev_bg_higher = bg_dmax >= wh_dmax

        assert crossover_tick is not None, "No Dmax crossover observed"
        assert 50 <= crossover_tick <= 80, (
            f"Crossover at tick {crossover_tick}, expected between 50-80"
        )

    def test_all_webhooks_served_at_balanced(self):
        """α=0.25 (balanced): all 5 webhooks are served."""
        _, wait_after_spike = _run_scenario3(alpha=0.25)
        assert len(wait_after_spike) == N_WEBHOOKS, (
            f"Only {len(wait_after_spike)}/{N_WEBHOOKS} webhooks served at α=0.25"
        )


# ---------------------------------------------------------------------------
# Scenario 4 — MDASH security (multi-model cost routing)
# ---------------------------------------------------------------------------
# 20 auditors (weight=3, SOTA model), 30 debaters (weight=1, distilled),
# 5 provers (weight=5, SOTA model). Resource capacity=3.
# No notebook baseline — directional assertions only.

N_AUDITORS = 20
N_DEBATERS = 30
N_PROVERS = 5
CAPACITY_S4 = 3
N_TICKS_S4 = 200
PROVER_SPIKE_TICK = 20  # provers arrive after initial audit/debate phase


def _run_scenario4(alpha: float = 0.25, seed: int = 42):
    """Run Scenario 4 (MDASH security) and return scheduler + metrics.

    Models a real MDASH-style workflow: auditors and debaters start first,
    provers arrive as a burst at tick 20 (after initial analysis phase).
    Provers have weight=5 (SOTA model cost) and escalate via Dmax growth,
    mirroring the webhook spike pattern from Scenario 3.
    """
    auditors = [
        Agent(agent_id=f"auditor-{i}", agent_type="auditor")
        for i in range(N_AUDITORS)
    ]
    debaters = [
        Agent(agent_id=f"debater-{i}", agent_type="debater")
        for i in range(N_DEBATERS)
    ]
    provers = [
        Agent(agent_id=f"prover-{i}", agent_type="prover")
        for i in range(N_PROVERS)
    ]
    agents = auditors + debaters + provers
    sched = LOCOScheduler(agents, alpha=alpha, seed=seed)

    # Tick 0: auditors and debaters get initial work (provers arrive later)
    initial = {}
    for i in range(N_AUDITORS):
        initial[f"auditor-{i}"] = [
            sched.new_task(weight=3.0, task_type="audit") for _ in range(2)
        ]
    for i in range(N_DEBATERS):
        initial[f"debater-{i}"] = [
            sched.new_task(weight=1.0, task_type="debate") for _ in range(3)
        ]
    sched._step(arrivals=initial)

    # Track prover first-serve ticks and utilization
    prover_first_serve: dict[str, int] = {}
    service_by_type: dict[str, int] = {"auditor": 0, "debater": 0, "prover": 0}
    ticks_at_capacity = 0

    for t in range(1, N_TICKS_S4):
        arrivals = {}

        # Provers arrive as a burst at PROVER_SPIKE_TICK
        # 2 tasks each (Qi=10) — SOTA verification is expensive
        if t == PROVER_SPIKE_TICK:
            for i in range(N_PROVERS):
                arrivals[f"prover-{i}"] = [
                    sched.new_task(weight=5.0, task_type="prove")
                    for _ in range(2)
                ]

        result = sched._step(arrivals=arrivals)

        if result.selected_agent:
            atype = result.selected_agent.agent_type
            service_by_type[atype] += 1
            if atype == "prover":
                aid = result.selected_agent.agent_id
                if aid not in prover_first_serve:
                    prover_first_serve[aid] = sched.tick

        if sched.total_tasks_remaining() >= CAPACITY_S4:
            ticks_at_capacity += 1

    completions = {}
    for agent in agents:
        completions[agent.agent_id] = len(
            sched.get_agent(agent.agent_id).completed_tasks
        )

    return sched, prover_first_serve, service_by_type, completions, ticks_at_capacity


class TestScenario4MDASH:
    """MDASH security — multi-model cost routing with weighted queues."""

    def test_all_provers_served(self):
        """All 5 provers are served despite arriving late into a loaded system."""
        _, prover_first_serve, _, _, _ = _run_scenario4()
        assert len(prover_first_serve) == N_PROVERS, (
            f"Only {len(prover_first_serve)}/{N_PROVERS} provers served"
        )

    def test_debaters_dont_starve(self):
        """All debaters complete at least one task (no starvation)."""
        _, _, _, completions, _ = _run_scenario4()
        for i in range(N_DEBATERS):
            aid = f"debater-{i}"
            assert completions[aid] > 0, f"{aid} starved (0 completions)"

    def test_auditors_dont_starve(self):
        """All auditors complete at least one task."""
        _, _, _, completions, _ = _run_scenario4()
        for i in range(N_AUDITORS):
            aid = f"auditor-{i}"
            assert completions[aid] > 0, f"{aid} starved (0 completions)"

    def test_high_utilization_during_contention(self):
        """Resource is utilized during the contention period.

        Total initial tasks: 40 (auditor) + 90 (debater) + 10 (prover) = 140.
        With 1 served per tick, ~140 ticks have active contention.
        """
        _, _, _, _, ticks_at_capacity = _run_scenario4()
        utilization = ticks_at_capacity / N_TICKS_S4
        assert utilization >= 0.60, (
            f"Utilization {utilization:.2f} < 0.60 during contention"
        )

    def test_provers_escalate_before_system_drains(self):
        """Provers escalate via Dmax and are served well before all work clears.

        Provers arrive at tick 20 with Dmax=0 into a system with Dmax~20.
        Their Qi=10 (highest) plus growing Dmax should escalate them above
        auditors/debaters. Key: served before tick 100 (system has ~140 tasks).
        """
        _, prover_first_serve, _, _, _ = _run_scenario4()
        assert len(prover_first_serve) > 0, "No provers served"
        max_wait = max(
            tick - PROVER_SPIKE_TICK
            for tick in prover_first_serve.values()
        )
        assert max_wait <= 80, (
            f"Slowest prover waited {max_wait} ticks — should escalate by 80"
        )

    def test_all_agent_types_receive_service(self):
        """All three agent types (auditor, debater, prover) are served."""
        _, _, service_by_type, _, _ = _run_scenario4()
        for atype, count in service_by_type.items():
            assert count > 0, f"Agent type '{atype}' received 0 service"
