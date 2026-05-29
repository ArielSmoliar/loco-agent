"""Tests for SLO error budgets."""

from loco.slo import SLOBudget, SLOState
from loco.task import Task


def _task(age: int) -> Task:
    """Create a task with the given age."""
    t = Task(task_id=f"t_{age}")
    t.age = age
    return t


class TestSLOState:
    def test_values(self):
        assert SLOState.HEALTHY == "healthy"
        assert SLOState.WARNING == "warning"
        assert SLOState.CRITICAL == "critical"
        assert SLOState.EXHAUSTED == "exhausted"


class TestSLOBudget:
    def test_initial_healthy(self):
        slo = SLOBudget(target_wait=10.0)
        assert slo.state == SLOState.HEALTHY
        assert slo.violation_rate == 0.0
        assert slo.budget_remaining == 1.0

    def test_no_violations(self):
        slo = SLOBudget(target_wait=10.0, window=10)
        for i in range(10):
            state = slo.record("a", _task(age=5))
        assert state == SLOState.HEALTHY
        assert slo.violation_rate == 0.0

    def test_all_violations_exhausted(self):
        slo = SLOBudget(target_wait=10.0, window=10)
        for i in range(10):
            state = slo.record("a", _task(age=20))
        assert state == SLOState.EXHAUSTED
        assert slo.violation_rate == 1.0
        assert slo.budget_remaining == 0.0

    def test_warning_threshold(self):
        slo = SLOBudget(target_wait=10.0, window=10, warn=0.5)
        # 5 out of 10 = 50% violation rate -> WARNING
        for _ in range(5):
            slo.record("a", _task(age=5))  # pass
        for _ in range(5):
            state = slo.record("a", _task(age=20))  # violate
        assert state == SLOState.WARNING

    def test_critical_threshold(self):
        slo = SLOBudget(target_wait=10.0, window=10, warn=0.5, critical=0.8)
        # 2 pass, 8 violate = 80% -> CRITICAL
        for _ in range(2):
            slo.record("a", _task(age=5))
        for _ in range(8):
            state = slo.record("a", _task(age=20))
        assert state == SLOState.CRITICAL

    def test_recovery(self):
        """State improves as violations slide out of the window."""
        slo = SLOBudget(target_wait=10.0, window=5, warn=0.6, critical=0.8)
        # Fill window with violations
        for _ in range(5):
            slo.record("a", _task(age=20))
        assert slo.state == SLOState.EXHAUSTED

        # Add passing observations -- violations slide out
        for _ in range(3):
            slo.record("a", _task(age=1))
        # Window now has 2 violations, 3 passes = 40%
        assert slo.state == SLOState.HEALTHY

    def test_rolling_window(self):
        """Old observations drop out of the window."""
        slo = SLOBudget(target_wait=10.0, window=5)
        # 5 violations
        for _ in range(5):
            slo.record("a", _task(age=20))
        assert slo.violation_rate == 1.0

        # 5 passes push out the violations
        for _ in range(5):
            slo.record("a", _task(age=1))
        assert slo.violation_rate == 0.0

    def test_total_counters(self):
        slo = SLOBudget(target_wait=10.0, window=5)
        slo.record("a", _task(age=5))   # pass
        slo.record("a", _task(age=20))  # violate
        slo.record("a", _task(age=5))   # pass

        assert slo.total_observations == 3
        assert slo.total_violations == 1

    def test_boundary_exact_target(self):
        """Task with age == target_wait is NOT a violation (> not >=)."""
        slo = SLOBudget(target_wait=10.0, window=5)
        slo.record("a", _task(age=10))
        assert slo.violation_rate == 0.0

    def test_boundary_just_over(self):
        """Task with age == target_wait + 1 IS a violation."""
        slo = SLOBudget(target_wait=10.0, window=5)
        slo.record("a", _task(age=11))
        assert slo.violation_rate == 1.0

    def test_reset(self):
        slo = SLOBudget(target_wait=10.0, window=5)
        slo.record("a", _task(age=20))
        slo.record("a", _task(age=20))
        slo.reset()
        assert slo.state == SLOState.HEALTHY
        assert slo.total_observations == 0
        assert slo.total_violations == 0

    def test_record_returns_state(self):
        slo = SLOBudget(target_wait=10.0, window=5)
        state = slo.record("a", _task(age=5))
        assert state == SLOState.HEALTHY
