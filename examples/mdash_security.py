"""Scenario 4 — MDASH security: multi-model cost routing.

Inspired by Microsoft's MDASH system (100+ security agents). Three agent
roles with different model costs compete for a shared SOTA model resource:
- 20 auditors (weight=3, SOTA model)
- 30 debaters (weight=1, distilled model)
- 5 provers  (weight=5, SOTA model) — arrive at tick 20

Validates: weighted queue depth with realistic model-cost weights,
no starvation for cheap tasks, expensive tasks escalate via Dmax.

Run: python examples/mdash_security.py
"""


from loco import Agent
from loco.scheduler import LOCOScheduler

N_AUDITORS = 20
N_DEBATERS = 30
N_PROVERS = 5
PROVER_SPIKE_TICK = 20
N_TICKS = 200


def main():
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
    sched = LOCOScheduler(agents, optimize_for="balanced", seed=42)

    print(f"MDASH security: {len(agents)} agents, {N_TICKS} ticks")
    print(f"  Auditors: {N_AUDITORS} (weight=3, 2 tasks each)")
    print(f"  Debaters: {N_DEBATERS} (weight=1, 3 tasks each)")
    print(f"  Provers:  {N_PROVERS} (weight=5, 2 tasks each, arrive tick {PROVER_SPIKE_TICK})\n")

    # Tick 0: auditors and debaters get initial work
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

    service_by_type = {"auditor": 0, "debater": 0, "prover": 0}
    prover_first_serve = {}

    for t in range(1, N_TICKS):
        arrivals = {}
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

        # Print key moments
        if t in (1, PROVER_SPIKE_TICK, PROVER_SPIKE_TICK + 1) and result.selected_agent:
            scores = result.scores
            aid = result.selected_agent.agent_id
            print(f"  tick {t:3d}: served {aid} "
                  f"(type={result.selected_agent.agent_type}, "
                  f"L={scores.get(aid, 0):.3f})")

    # Results
    print("\nService by type:")
    for atype, count in service_by_type.items():
        print(f"  {atype}: {count}")

    print("\nProver escalation (ticks after arrival):")
    for aid in sorted(prover_first_serve):
        wait = prover_first_serve[aid] - PROVER_SPIKE_TICK
        print(f"  {aid}: first served at tick {prover_first_serve[aid]} "
              f"(waited {wait} ticks)")

    # Starvation check
    completions = {}
    for agent in agents:
        completions[agent.agent_id] = len(
            sched.get_agent(agent.agent_id).completed_tasks
        )
    starved = [aid for aid, c in completions.items() if c == 0]
    if starved:
        print(f"\nStarved agents: {starved}")
    else:
        print(f"\nNo starvation — all {len(agents)} agents served")


if __name__ == "__main__":
    main()
