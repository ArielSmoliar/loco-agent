"""Tests for LOCOScheduler scoring core."""

import pytest

from loco.agent import Agent
from loco.metrics import jains_fairness
from loco.scheduler import LOCOScheduler, StepResult
from loco.task import Task


def make_agents(*specs: tuple[str, list[tuple[float, int]]]) -> list[Agent]:
    """Helper: create agents with pre-loaded tasks.

    specs: (agent_id, [(weight, age), ...])
    """
    agents = []
    for agent_id, tasks in specs:
        a = Agent(agent_id=agent_id)
        for i, (w, age) in enumerate(tasks):
            a.tasks.append(Task(task_id=f"{agent_id}-t{i}", weight=w, age=age))
        agents.append(a)
    return agents


# --- Test 1: Single agent, no contention ---
def test_single_agent_always_selected():
    agents = make_agents(("a1", [(1.0, 0)]))
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)
    scores = sched.compute_load_scores()
    selected = sched.select_agent(scores)
    assert selected is not None
    assert selected.agent_id == "a1"


# --- Test 2: All agents empty ---
def test_all_agents_empty_returns_none():
    agents = [Agent(agent_id="a1"), Agent(agent_id="a2")]
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)
    scores = sched.compute_load_scores()
    assert scores == {}
    assert sched.select_agent(scores) is None


# --- Test 3: Equal load, tie-break is random ---
def test_equal_load_tie_break_distributed():
    agents = make_agents(("a1", [(1.0, 5)]), ("a2", [(1.0, 5)]))
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)

    counts = {"a1": 0, "a2": 0}
    for _ in range(100):
        scores = sched.compute_load_scores()
        selected = sched.select_agent(scores)
        counts[selected.agent_id] += 1

    # Both agents should be selected at least once (random tie-break)
    assert counts["a1"] > 0
    assert counts["a2"] > 0


# --- Test 4: alpha=0, highest Dmax wins ---
def test_alpha_zero_highest_dmax_wins():
    agents = make_agents(
        ("low_dmax", [(1.0, 2)]),
        ("high_dmax", [(1.0, 20)]),
    )
    sched = LOCOScheduler(agents, alpha=0.0, seed=42)
    scores = sched.compute_load_scores()
    selected = sched.select_agent(scores)
    assert selected.agent_id == "high_dmax"


# --- Test 5: alpha=1, deepest queue wins ---
def test_alpha_one_deepest_queue_wins():
    agents = make_agents(
        ("shallow", [(1.0, 100)]),  # high dmax but low queue
        ("deep", [(3.0, 1), (3.0, 1), (3.0, 1)]),  # low dmax but heavy queue
    )
    sched = LOCOScheduler(agents, alpha=1.0, seed=42)
    scores = sched.compute_load_scores()
    selected = sched.select_agent(scores)
    assert selected.agent_id == "deep"


# --- Test 6: alpha=0.25, mixed priority matches hand calculation ---
def test_alpha_025_score_ordering():
    # Agent A: Qi=4.0, Dmax=10
    # Agent B: Qi=2.0, Dmax=20
    agents = make_agents(
        ("a", [(2.0, 10), (2.0, 5)]),  # Qi=4, Dmax=10
        ("b", [(2.0, 20)]),             # Qi=2, Dmax=20
    )
    sched = LOCOScheduler(agents, alpha=0.25, seed=42)
    scores = sched.compute_load_scores()

    # Hand calculation:
    # max_q=4, max_d=20
    # L(a) = 0.25*(4/4) + 0.75*(10/20) = 0.25 + 0.375 = 0.625
    # L(b) = 0.25*(2/4) + 0.75*(20/20) = 0.125 + 0.75 = 0.875
    assert abs(scores["a"] - 0.625) < 1e-9
    assert abs(scores["b"] - 0.875) < 1e-9

    selected = sched.select_agent(scores)
    assert selected.agent_id == "b"  # higher score wins


# --- Test 7: Task weights affect scoring at alpha=1 ---
def test_task_weights_affect_scoring():
    agents = make_agents(
        ("light", [(1.0, 5)]),     # Qi=1
        ("heavy", [(3.0, 5)]),     # Qi=3
    )
    sched = LOCOScheduler(agents, alpha=1.0, seed=42)
    scores = sched.compute_load_scores()
    assert scores["heavy"] > scores["light"]


# --- Test 8: _step with no arrivals doesn't crash, ages tasks ---
def test_step_no_arrivals_ages_tasks():
    agents = make_agents(("a1", [(1.0, 0)]))
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)

    # Add a second task that won't be served this tick
    sched.agents["a1"].tasks.append(Task(task_id="extra", weight=1.0, age=0))

    result = sched._step()

    # One task served, one remains
    assert result.selected_agent.agent_id == "a1"
    assert result.served_task is not None

    # Remaining task's age should have been incremented
    remaining = sched.agents["a1"].tasks
    assert len(remaining) == 1
    assert remaining[0].age == 1  # aged by 1


# --- Test 9: _step serves exactly one task per call ---
def test_step_serves_one_task():
    agents = make_agents(("a1", [(1.0, 0), (1.0, 0), (1.0, 0)]))
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)

    assert sched.total_tasks_remaining() == 3
    sched._step()
    assert sched.total_tasks_remaining() == 2
    sched._step()
    assert sched.total_tasks_remaining() == 1


# --- Test 10: Jain's fairness = 1.0 for equal values ---
def test_jains_fairness_equal():
    assert jains_fairness([5.0, 5.0, 5.0]) == 1.0


# --- Test 11: Jain's fairness < 1.0 for skewed values ---
def test_jains_fairness_skewed():
    f = jains_fairness([1.0, 100.0])
    assert 0.0 < f < 1.0


# --- Additional tests ---

def test_jains_fairness_empty():
    assert jains_fairness([]) == 1.0


def test_jains_fairness_filters_zeros():
    assert jains_fairness([0.0, 5.0, 5.0]) == 1.0


def test_alpha_validation():
    agents = [Agent(agent_id="a1")]
    with pytest.raises(ValueError, match="alpha must be"):
        LOCOScheduler(agents, alpha=1.5)
    with pytest.raises(ValueError, match="alpha must be"):
        LOCOScheduler(agents, alpha=-0.1)


def test_get_agent_unknown():
    sched = LOCOScheduler([Agent(agent_id="a1")], seed=42)
    with pytest.raises(ValueError, match="Unknown agent"):
        sched.get_agent("nonexistent")


def test_mean_wait_time():
    agents = make_agents(("a1", [(1.0, 5), (1.0, 15)]))
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)

    # Serve both tasks
    sched._step()
    sched._step()

    # Mean of ages at serve time
    mwt = sched.mean_wait_time("a1")
    assert mwt > 0


def test_mean_wait_time_empty():
    sched = LOCOScheduler([Agent(agent_id="a1")], seed=42)
    assert sched.mean_wait_time("a1") == 0.0


def test_new_task_auto_increments():
    sched = LOCOScheduler([Agent(agent_id="a1")], seed=42)
    t1 = sched.new_task(weight=1.0)
    t2 = sched.new_task(weight=2.0)
    assert t1.task_id == "0"
    assert t2.task_id == "1"
    assert t2.weight == 2.0


def test_step_with_arrivals():
    agents = [Agent(agent_id="a1"), Agent(agent_id="a2")]
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)

    t1 = sched.new_task(weight=1.0)
    t2 = sched.new_task(weight=1.0)
    result = sched._step(arrivals={"a1": [t1], "a2": [t2]})

    assert result.selected_agent is not None
    assert result.served_task is not None
    assert sched.total_tasks_remaining() == 1


def test_step_returns_step_result():
    agents = make_agents(("a1", [(1.0, 0)]))
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)
    result = sched._step()
    assert isinstance(result, StepResult)
    assert isinstance(result.scores, dict)


def test_history_recorded():
    agents = make_agents(("a1", [(1.0, 0)]))
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)
    sched._step()
    assert len(sched.history) == 1
    assert sched.history[0]["tick"] == 0
    assert sched.history[0]["served_agent_id"] == "a1"


def test_history_ring_buffer():
    agents = make_agents(("a1", []))
    sched = LOCOScheduler(agents, alpha=0.5, seed=42, max_history=5)

    # Run 10 steps (all no-ops since no tasks, but history still recorded)
    for _ in range(10):
        sched._step()

    assert len(sched.history) == 5
    # Oldest entries should have been dropped
    assert sched.history[0]["tick"] == 5


def test_tick_increments():
    agents = [Agent(agent_id="a1")]
    sched = LOCOScheduler(agents, seed=42)
    assert sched.tick == 0
    sched._step()
    assert sched.tick == 1
    sched._step()
    assert sched.tick == 2


def test_division_by_zero_all_zero_dmax():
    """When all agents have dmax=0, scoring shouldn't crash."""
    agents = make_agents(("a1", [(2.0, 0)]), ("a2", [(1.0, 0)]))
    sched = LOCOScheduler(agents, alpha=0.5, seed=42)
    scores = sched.compute_load_scores()
    # Should not raise. At alpha=0.5 with dmax=0 for all, queue depth decides.
    assert len(scores) == 2
    assert scores["a1"] > scores["a2"]
