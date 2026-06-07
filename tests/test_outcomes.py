"""Tests for token-to-outcome tracking (v0.4)."""

import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler
from loco.outcomes import OutcomeTracker
from loco.resource import SharedResource
from loco.task import Task


class TestOutcomeTrackerStandalone:

    def test_empty_tracker(self):
        tracker = OutcomeTracker()
        assert tracker.outcome_rates() == {}
        assert tracker.avg_quality() is None
        assert tracker.summary()["total_records"] == 0

    def test_single_record(self):
        tracker = OutcomeTracker()
        task = Task(weight=5.0, model="opus")
        tracker.record("a1", task, outcome="success", quality_score=0.95)

        assert tracker.outcome_counts() == {"success": 1}
        assert tracker.avg_quality() == pytest.approx(0.95)

    def test_outcome_rates(self):
        tracker = OutcomeTracker()
        for _ in range(8):
            tracker.record("a1", Task(weight=1.0), outcome="success")
        for _ in range(2):
            tracker.record("a1", Task(weight=1.0), outcome="failure")

        rates = tracker.outcome_rates()
        assert rates["success"] == pytest.approx(0.8)
        assert rates["failure"] == pytest.approx(0.2)

    def test_cost_per_outcome(self):
        tracker = OutcomeTracker()
        tracker.record("a1", Task(weight=10.0), outcome="success")
        tracker.record("a1", Task(weight=2.0), outcome="success")
        tracker.record("a1", Task(weight=1.0), outcome="failure")

        assert tracker.cost_per_outcome("success") == pytest.approx(6.0)
        assert tracker.cost_per_outcome("failure") == pytest.approx(1.0)
        assert tracker.cost_per_outcome("nonexistent") == 0.0

    def test_total_cost_by_outcome(self):
        tracker = OutcomeTracker()
        tracker.record("a1", Task(weight=5.0), outcome="success")
        tracker.record("a1", Task(weight=3.0), outcome="success")
        tracker.record("a1", Task(weight=2.0), outcome="failure")

        costs = tracker.total_cost_by_outcome()
        assert costs["success"] == 8.0
        assert costs["failure"] == 2.0

    def test_quality_by_model(self):
        tracker = OutcomeTracker()
        tracker.record("a1", Task(weight=1.0, model="opus"), "success", quality_score=0.95)
        tracker.record("a1", Task(weight=1.0, model="opus"), "success", quality_score=0.90)
        tracker.record("a1", Task(weight=1.0, model="sonnet"), "success", quality_score=0.70)

        qm = tracker.quality_by_model()
        assert qm["opus"] == pytest.approx(0.925)
        assert qm["sonnet"] == pytest.approx(0.70)

    def test_quality_by_agent(self):
        tracker = OutcomeTracker()
        tracker.record("a1", Task(weight=1.0), "success", quality_score=0.90)
        tracker.record("a1", Task(weight=1.0), "success", quality_score=0.80)
        tracker.record("a2", Task(weight=1.0), "success", quality_score=0.60)

        qa = tracker.quality_by_agent()
        assert qa["a1"] == pytest.approx(0.85)
        assert qa["a2"] == pytest.approx(0.60)

    def test_quality_without_scores(self):
        tracker = OutcomeTracker()
        tracker.record("a1", Task(weight=1.0), "success")  # no quality
        assert tracker.avg_quality() is None
        assert tracker.quality_by_model() == {}

    def test_roi_by_agent(self):
        tracker = OutcomeTracker()
        tracker.record("a1", Task(weight=5.0), "success", quality_score=0.9)
        tracker.record("a1", Task(weight=5.0), "success", quality_score=0.8)
        tracker.record("a1", Task(weight=5.0), "failure")

        roi = tracker.roi_by_agent()["a1"]
        assert roi["total_cost"] == 15.0
        assert roi["task_count"] == 3
        assert roi["success_rate"] == pytest.approx(2 / 3)
        assert roi["avg_quality"] == pytest.approx(0.85)
        assert roi["cost_per_success"] == pytest.approx(5.0)

    def test_roi_by_model(self):
        tracker = OutcomeTracker()
        tracker.record("a1", Task(weight=10.0, model="opus"), "success")
        tracker.record("a1", Task(weight=2.0, model="sonnet"), "success")
        tracker.record("a1", Task(weight=2.0, model="sonnet"), "failure")

        roi = tracker.roi_by_model()
        assert roi["opus"]["success_rate"] == 1.0
        assert roi["sonnet"]["success_rate"] == pytest.approx(0.5)

    def test_summary(self):
        tracker = OutcomeTracker()
        tracker.record("a1", Task(weight=5.0), "success", quality_score=0.9)
        tracker.record("a1", Task(weight=3.0), "failure")

        s = tracker.summary()
        assert s["total_records"] == 2
        assert "success" in s["outcome_rates"]
        assert s["avg_quality"] == pytest.approx(0.9)


class TestOutcomeTrackerIntegration:

    @pytest.mark.asyncio
    async def test_outcomes_accessible_through_scheduler(self):
        """OutcomeTracker is accessible via scheduler.metrics.outcomes."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        task = Task(weight=5.0, model="opus")
        await scheduler.submit_task("a1", task)
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        # Record outcome after completion
        scheduler.metrics.outcomes.record(
            "a1", task, outcome="success", quality_score=0.92
        )

        assert scheduler.metrics.outcomes.outcome_counts() == {"success": 1}
        assert scheduler.metrics.outcomes.avg_quality() == pytest.approx(0.92)

    @pytest.mark.asyncio
    async def test_roi_across_models(self):
        """ROI tracking across different models through the scheduler."""
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")

        tasks = [
            Task(weight=10.0, model="opus"),
            Task(weight=2.0, model="sonnet"),
            Task(weight=2.0, model="sonnet"),
        ]

        for task in tasks:
            await scheduler.submit_task("a1", task)
            async with scheduler.acquire("a1"):
                scheduler.get_agent("a1").serve_oldest_task()
            scheduler.metrics.outcomes.record(
                "a1", task,
                outcome="success",
                quality_score=0.95 if task.model == "opus" else 0.75,
            )

        qm = scheduler.metrics.outcomes.quality_by_model()
        assert qm["opus"] == pytest.approx(0.95)
        assert qm["sonnet"] == pytest.approx(0.75)

        roi = scheduler.metrics.outcomes.roi_by_model()
        assert roi["opus"]["total_cost"] == 10.0
        assert roi["sonnet"]["total_cost"] == 4.0
