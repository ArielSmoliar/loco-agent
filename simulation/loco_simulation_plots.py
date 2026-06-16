"""
Publication figures for the LOCO scheduler simulation, Article 2.

Renders three PNGs from the HARDENED multi-seed results (20 seeds, 95% CIs),
overwriting the stale single-seed images from the original notebook. Numbers
come from loco_simulation_hardened.py; this file only draws them. No live LLM
or network calls; this is a discrete scheduler model.

Run from the simulation/ directory:
    .venv/bin/python loco_simulation_plots.py
"""
import numpy as np
import matplotlib.pyplot as plt

from loco_simulation_hardened import (
    Agent,
    LOCOScheduler,
    scenario1,
    scenario2,
    scenario3,
    ALPHAS,
    N_SEEDS,
)

plt.rcParams["figure.dpi"] = 130
plt.rcParams["axes.spines.top"] = False
plt.rcParams["axes.spines.right"] = False
plt.rcParams["font.size"] = 10

OVER = "#d7191c"   # overloaded regime
SUST = "#2c7bb6"   # sustainable regime
ACCENT = "#555555"


def means_cis(rows, key):
    """Pull (means[], cis[]) across ALPHAS for one stat key in a scenario2 row dict."""
    m = np.array([rows[a][key][0] for a in ALPHAS])
    c = np.array([rows[a][key][1] for a in ALPHAS])
    return m, c


# ----------------------------------------------------------------------------
# Figure 1: Scenario 1 -- burst conservation (representative seed + seed-robust note)
# ----------------------------------------------------------------------------
def fig_scenario1():
    assigned, clear_ticks = scenario1()  # deterministic: {36} across all seeds

    # Replay one representative seed to visualize the drain. The scheduler is
    # identical to the hardened module; all 20 seeds clear in exactly `assigned`
    # ticks, so any seed is representative for the queue-drain shape.
    from loco_simulation_hardened import Task
    N = 8
    agents = [Agent(i) for i in range(N)]
    s = LOCOScheduler(agents, alpha=0.5, seed=0)
    s.step({i: [Task(1.0) for _ in range(i + 1)] for i in range(N)})
    depth_hist = [[len(a.tasks) for a in s.agents]]
    while sum(len(a.tasks) for a in s.agents) > 0:
        s.step()
        depth_hist.append([len(a.tasks) for a in s.agents])
    depth_hist = np.array(depth_hist)  # (ticks+1, N)
    served_counts = [len(a.completed) for a in s.agents]

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.2))
    fig.suptitle(
        f"Scenario 1: Burst conservation (8 agents, alpha=0.5)\n"
        f"All {N_SEEDS} seeds cleared {assigned} tasks in exactly "
        f"{sorted(clear_ticks)[0]} ticks: nothing dropped, nothing double-served",
        fontsize=11, fontweight="bold",
    )

    colors = plt.cm.viridis(np.linspace(0.1, 0.9, N))

    ax = axes[0]
    for i in range(N):
        ax.plot(range(depth_hist.shape[0]), depth_hist[:, i],
                color=colors[i], linewidth=1.7, label=f"A{i} (Q0={i+1})")
    ax.set_xlabel("Tick")
    ax.set_ylabel("Queue depth")
    ax.set_title("Queue drains monotonically (representative seed)")
    ax.legend(fontsize=7, ncol=2)

    ax = axes[1]
    x = np.arange(N)
    ax.bar(x, served_counts, color=colors, alpha=0.85, label="Times served")
    ax.plot(x, [i + 1 for i in range(N)], "o--", color=OVER,
            linewidth=1.5, markersize=6, label="Tasks assigned")
    ax.set_xlabel("Agent")
    ax.set_ylabel("Count")
    ax.set_title("Served exactly equals assigned (per agent)")
    ax.set_xticks(x)
    ax.legend(fontsize=8)

    fig.tight_layout(rect=[0, 0, 1, 0.90])
    fig.savefig("scenario1_burst.png", bbox_inches="tight")
    plt.close(fig)
    print("wrote scenario1_burst.png")


# ----------------------------------------------------------------------------
# Figure 2: Scenario 2 -- fairness, overloaded vs sustainable (the centerpiece)
# ----------------------------------------------------------------------------
def fig_scenario2():
    _, over = scenario2([0.4] * 5 + [0.1] * 5, 500, "overloaded")
    _, sust = scenario2([0.1] * 5 + [0.04] * 5, 500, "sustainable")

    fig, axes = plt.subplots(1, 3, figsize=(16, 4.6))
    fig.suptitle(
        "Scenario 2: Queue-depth-only scheduling starves the quiet agents "
        "(10 agents, 500 ticks, 20 seeds, 95% CIs)",
        fontsize=12, fontweight="bold",
    )
    a = np.array(ALPHAS)

    # Panel A: starvation vs alpha
    ax = axes[0]
    m, c = means_cis(over, "starved")
    ax.errorbar(a, m, yerr=c, color=OVER, marker="o", linewidth=2,
                capsize=4, label="Overloaded (2.5 arr/tick)")
    m, c = means_cis(sust, "starved")
    ax.errorbar(a, m, yerr=c, color=SUST, marker="s", linewidth=2,
                capsize=4, label="Sustainable (0.7 arr/tick)")
    ax.set_xlabel("alpha  (0 = latency, 1 = queue depth)")
    ax.set_ylabel("Starved agents (zero completions) / 10")
    ax.set_title("Starvation rises as alpha -> queue-depth-only")
    ax.set_ylim(bottom=-0.2)
    ax.legend(fontsize=8)

    # Panel B: Jain(completions) vs alpha
    ax = axes[1]
    m, c = means_cis(over, "jain_c")
    ax.errorbar(a, m, yerr=c, color=OVER, marker="o", linewidth=2,
                capsize=4, label="Overloaded")
    m, c = means_cis(sust, "jain_c")
    ax.errorbar(a, m, yerr=c, color=SUST, marker="s", linewidth=2,
                capsize=4, label="Sustainable")
    ax.set_xlabel("alpha  (0 = latency, 1 = queue depth)")
    ax.set_ylabel("Jain fairness of completion counts")
    ax.set_title("Completion fairness collapses (0.72 -> 0.49)")
    ax.set_ylim(0.4, 1.0)
    ax.legend(fontsize=8)

    # Panel C: mean wait, overloaded hi/lo vs sustainable
    ax = axes[2]
    m, c = means_cis(over, "hi")
    ax.errorbar(a, m, yerr=c, color=OVER, marker="o", linewidth=2,
                capsize=4, label="Overloaded, busy agents")
    m, c = means_cis(over, "lo")
    ax.errorbar(a, m, yerr=c, color=OVER, marker="^", linewidth=2,
                linestyle="--", capsize=4, label="Overloaded, quiet agents")
    m, c = means_cis(sust, "hi")
    ax.errorbar(a, m, yerr=c, color=SUST, marker="s", linewidth=2,
                capsize=4, label="Sustainable, busy agents")
    ax.set_xlabel("alpha  (0 = latency, 1 = queue depth)")
    ax.set_ylabel("Mean wait of completed tasks (ticks)")
    ax.set_title("Quiet-agent wait looks low partly because they starve\n"
                 "(starved agents have no completed tasks to average)",
                 fontsize=9.5)
    ax.legend(fontsize=7.5)

    fig.tight_layout(rect=[0, 0, 1, 0.92])
    fig.savefig("scenario2_fairness.png", bbox_inches="tight")
    plt.close(fig)
    print("wrote scenario2_fairness.png")


# ----------------------------------------------------------------------------
# Figure 3: Scenario 3 -- urgent spike latency vs alpha
# ----------------------------------------------------------------------------
def fig_scenario3():
    rows = scenario3()
    a = np.array(ALPHAS)
    wait_m = np.array([rows[al]["wait"][0] for al in ALPHAS])
    wait_c = np.array([rows[al]["wait"][1] for al in ALPHAS])
    served_m = np.array([rows[al]["served"][0] for al in ALPHAS])

    fig, ax = plt.subplots(1, 1, figsize=(8, 5))
    fig.suptitle(
        "Scenario 3: Urgency self-escalates without priority rules\n"
        "(5 webhook agents spike at tick 30; 20 seeds, 95% CIs)",
        fontsize=11, fontweight="bold",
    )
    ax.errorbar(a, wait_m, yerr=wait_c, color=OVER, marker="o", linewidth=2,
                capsize=4)
    for x, y, n in zip(a, wait_m, served_m):
        ax.annotate(f"{n:.0f}/5 served", (x, y), textcoords="offset points",
                    xytext=(0, 9), ha="center", fontsize=8, color=ACCENT)
    ax.set_xlabel("alpha  (0 = latency, 1 = queue depth)")
    ax.set_ylabel("Ticks after spike until a webhook is first served")
    ax.set_title("Latency-tuned scheduling (low alpha) serves urgent work ~3x faster",
                 fontsize=10)
    ax.set_ylim(bottom=0)
    fig.tight_layout(rect=[0, 0, 1, 0.90])
    fig.savefig("scenario3_spike.png", bbox_inches="tight")
    plt.close(fig)
    print("wrote scenario3_spike.png")


if __name__ == "__main__":
    print(f"Rendering hardened figures ({N_SEEDS} seeds, 95% CIs)...")
    fig_scenario1()
    fig_scenario2()
    fig_scenario3()
    print("done.")
