"""Tests for Plan/Step DAG."""

import pytest

from loco.labels import SecurityLabel
from loco.plan import Plan, Step


class TestStep:
    def test_basic(self):
        step = Step(step_id="s1", agent="agent_a")
        assert step.step_id == "s1"
        assert step.agent == "agent_a"
        assert step.depends_on == []
        assert step.weight == 1.0
        assert step.labels is None

    def test_with_dependencies(self):
        step = Step(step_id="s2", agent="a", depends_on=["s1"])
        assert step.depends_on == ["s1"]

    def test_with_labels(self):
        step = Step(
            step_id="s1", agent="a",
            labels={"input": SecurityLabel.CONFIDENTIAL},
        )
        assert step.labels["input"] == SecurityLabel.CONFIDENTIAL


class TestPlanValidation:
    def test_valid_linear(self):
        plan = Plan(steps=[
            Step("a", agent="x"),
            Step("b", agent="x", depends_on=["a"]),
            Step("c", agent="x", depends_on=["b"]),
        ])
        plan.validate()  # should not raise

    def test_valid_diamond(self):
        plan = Plan(steps=[
            Step("a", agent="x"),
            Step("b", agent="x", depends_on=["a"]),
            Step("c", agent="y", depends_on=["a"]),
            Step("d", agent="x", depends_on=["b", "c"]),
        ])
        plan.validate()

    def test_duplicate_step_ids(self):
        plan = Plan(steps=[
            Step("a", agent="x"),
            Step("a", agent="y"),
        ])
        with pytest.raises(ValueError, match="Duplicate"):
            plan.validate()

    def test_missing_dependency(self):
        plan = Plan(steps=[
            Step("a", agent="x", depends_on=["missing"]),
        ])
        with pytest.raises(ValueError, match="unknown step"):
            plan.validate()

    def test_cycle_direct(self):
        plan = Plan(steps=[
            Step("a", agent="x", depends_on=["b"]),
            Step("b", agent="x", depends_on=["a"]),
        ])
        with pytest.raises(ValueError, match="Cycle"):
            plan.validate()

    def test_cycle_indirect(self):
        plan = Plan(steps=[
            Step("a", agent="x", depends_on=["c"]),
            Step("b", agent="x", depends_on=["a"]),
            Step("c", agent="x", depends_on=["b"]),
        ])
        with pytest.raises(ValueError, match="Cycle"):
            plan.validate()

    def test_empty_plan(self):
        plan = Plan(steps=[])
        plan.validate()  # empty is valid


class TestTopologicalSort:
    def test_linear(self):
        plan = Plan(steps=[
            Step("c", agent="x", depends_on=["b"]),
            Step("a", agent="x"),
            Step("b", agent="x", depends_on=["a"]),
        ])
        order = plan.topological_sort()
        assert order.index("a") < order.index("b")
        assert order.index("b") < order.index("c")

    def test_parallel_roots(self):
        plan = Plan(steps=[
            Step("a", agent="x"),
            Step("b", agent="x"),
            Step("c", agent="x", depends_on=["a", "b"]),
        ])
        order = plan.topological_sort()
        assert order.index("a") < order.index("c")
        assert order.index("b") < order.index("c")

    def test_single_step(self):
        plan = Plan(steps=[Step("only", agent="x")])
        assert plan.topological_sort() == ["only"]

    def test_empty(self):
        plan = Plan(steps=[])
        assert plan.topological_sort() == []


class TestReadySteps:
    def test_initial_ready(self):
        plan = Plan(steps=[
            Step("a", agent="x"),
            Step("b", agent="x", depends_on=["a"]),
        ])
        ready = plan.ready_steps(completed=set())
        assert [s.step_id for s in ready] == ["a"]

    def test_after_first_completes(self):
        plan = Plan(steps=[
            Step("a", agent="x"),
            Step("b", agent="x", depends_on=["a"]),
            Step("c", agent="y", depends_on=["a"]),
        ])
        ready = plan.ready_steps(completed={"a"})
        ids = sorted(s.step_id for s in ready)
        assert ids == ["b", "c"]

    def test_diamond_join(self):
        plan = Plan(steps=[
            Step("a", agent="x"),
            Step("b", agent="x", depends_on=["a"]),
            Step("c", agent="y", depends_on=["a"]),
            Step("d", agent="x", depends_on=["b", "c"]),
        ])
        # Only b done -- d still blocked by c
        ready = plan.ready_steps(completed={"a", "b"})
        assert [s.step_id for s in ready] == ["c"]

        # Both b and c done -- d is ready
        ready = plan.ready_steps(completed={"a", "b", "c"})
        assert [s.step_id for s in ready] == ["d"]

    def test_completed_excluded(self):
        plan = Plan(steps=[
            Step("a", agent="x"),
            Step("b", agent="x"),
        ])
        ready = plan.ready_steps(completed={"a"})
        assert [s.step_id for s in ready] == ["b"]


class TestPlanCompletion:
    def test_not_complete(self):
        plan = Plan(steps=[Step("a", agent="x"), Step("b", agent="x")])
        assert not plan.is_complete(set())
        assert not plan.is_complete({"a"})

    def test_complete(self):
        plan = Plan(steps=[Step("a", agent="x"), Step("b", agent="x")])
        assert plan.is_complete({"a", "b"})

    def test_empty_always_complete(self):
        plan = Plan(steps=[])
        assert plan.is_complete(set())


class TestPlanMisc:
    def test_step_lookup(self):
        plan = Plan(steps=[Step("a", agent="x"), Step("b", agent="y")])
        assert plan.step("b").agent == "y"

    def test_step_not_found(self):
        plan = Plan(steps=[Step("a", agent="x")])
        with pytest.raises(KeyError):
            plan.step("missing")

    def test_len(self):
        plan = Plan(steps=[Step("a", agent="x"), Step("b", agent="x")])
        assert len(plan) == 2

    def test_auto_plan_id(self):
        plan = Plan(steps=[])
        assert len(plan.plan_id) == 12
