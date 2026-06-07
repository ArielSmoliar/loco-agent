"""Tests for trust scoring (v0.4)."""

import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler
from loco.resource import SharedResource
from loco.task import Task
from loco.trust import DEFAULT_SCORE, TrustScorer


class TestTrustScorerStandalone:

    def test_unknown_agent_returns_default(self):
        scorer = TrustScorer(decay_half_life=None)
        assert scorer.score("unknown") == DEFAULT_SCORE

    def test_success_increases_score(self):
        scorer = TrustScorer(decay_half_life=None)
        initial = scorer.score("a1")
        scorer.record_success("a1", wait_ticks=1)
        assert scorer.score("a1") > initial

    def test_error_decreases_score(self):
        scorer = TrustScorer(decay_half_life=None)
        scorer.record_success("a1", wait_ticks=1)
        after_success = scorer.score("a1")
        scorer.record_error("a1")
        assert scorer.score("a1") < after_success

    def test_timeout_decreases_more_than_error(self):
        scorer = TrustScorer(decay_half_life=None)
        scorer_err = TrustScorer(decay_half_life=None)

        scorer.record_timeout("a1")
        scorer_err.record_error("a1")

        assert scorer.score("a1") < scorer_err.score("a1")

    def test_fast_completion_bonus(self):
        scorer = TrustScorer(slo_target=20.0, decay_half_life=None)
        scorer_slow = TrustScorer(slo_target=20.0, decay_half_life=None)

        scorer.record_success("a1", wait_ticks=5)   # well under 50% of SLO
        scorer_slow.record_success("a1", wait_ticks=15)  # above 50% of SLO

        assert scorer.score("a1") > scorer_slow.score("a1")

    def test_slo_violation_penalty(self):
        scorer = TrustScorer(slo_target=10.0, decay_half_life=None)
        scorer_ok = TrustScorer(slo_target=10.0, decay_half_life=None)

        scorer.record_success("a1", wait_ticks=15)  # SLO violation
        scorer_ok.record_success("a1", wait_ticks=5)

        assert scorer.score("a1") < scorer_ok.score("a1")

    def test_score_clamped_at_zero(self):
        scorer = TrustScorer(decay_half_life=None)
        for _ in range(100):
            scorer.record_error("a1")
        assert scorer.score("a1") == 0

    def test_score_clamped_at_1000(self):
        scorer = TrustScorer(decay_half_life=None)
        for _ in range(200):
            scorer.record_success("a1", wait_ticks=1)
        assert scorer.score("a1") == 1000

    def test_scores_returns_all_agents(self):
        scorer = TrustScorer(decay_half_life=None)
        scorer.record_success("a1", wait_ticks=1)
        scorer.record_error("a2")
        scores = scorer.scores()
        assert "a1" in scores
        assert "a2" in scores

    def test_stats(self):
        scorer = TrustScorer(decay_half_life=None)
        scorer.record_success("a1", wait_ticks=1)
        scorer.record_success("a1", wait_ticks=2)
        scorer.record_error("a1")

        stats = scorer.stats("a1")
        assert stats["total_successes"] == 2
        assert stats["total_errors"] == 1
        assert stats["success_rate"] == pytest.approx(2 / 3)

    def test_priority_multiplier_neutral_at_default(self):
        scorer = TrustScorer(decay_half_life=None)
        mult = scorer.priority_multiplier("new_agent")
        assert mult == pytest.approx(1.0)

    def test_priority_multiplier_high_trust(self):
        scorer = TrustScorer(decay_half_life=None)
        for _ in range(100):
            scorer.record_success("a1", wait_ticks=1)
        mult = scorer.priority_multiplier("a1")
        assert mult > 1.0

    def test_priority_multiplier_low_trust(self):
        scorer = TrustScorer(decay_half_life=None)
        for _ in range(50):
            scorer.record_error("a1")
        mult = scorer.priority_multiplier("a1")
        assert mult < 1.0

    def test_reset_single_agent(self):
        scorer = TrustScorer(decay_half_life=None)
        scorer.record_success("a1", wait_ticks=1)
        scorer.record_success("a2", wait_ticks=1)
        scorer.reset("a1")
        assert scorer.score("a1") == DEFAULT_SCORE
        assert scorer.score("a2") > DEFAULT_SCORE

    def test_reset_all(self):
        scorer = TrustScorer(decay_half_life=None)
        scorer.record_success("a1", wait_ticks=1)
        scorer.reset()
        assert scorer.scores() == {}


class TestTrustScorerIntegration:

    @pytest.mark.asyncio
    async def test_trust_recorded_on_success(self):
        """Trust scorer records success when task completes normally."""
        scorer = TrustScorer(decay_half_life=None)
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(
            agents, resource, optimize_for="balanced", trust_scorer=scorer
        )

        await scheduler.submit_task("a1", Task(weight=1.0))
        async with scheduler.acquire("a1"):
            scheduler.get_agent("a1").serve_oldest_task()

        assert scorer.score("a1") > DEFAULT_SCORE

    @pytest.mark.asyncio
    async def test_trust_recorded_on_error(self):
        """Trust scorer records error when task raises exception."""
        scorer = TrustScorer(decay_half_life=None)
        agents = [Agent(agent_id="a1")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(
            agents, resource, optimize_for="balanced", trust_scorer=scorer
        )

        await scheduler.submit_task("a1", Task(weight=1.0))
        try:
            async with scheduler.acquire("a1"):
                scheduler.get_agent("a1").serve_oldest_task()
                raise ValueError("simulated failure")
        except ValueError:
            pass

        assert scorer.score("a1") < DEFAULT_SCORE

    @pytest.mark.asyncio
    async def test_trust_affects_grant_priority(self):
        """Higher trust agents get priority in grant decisions."""
        scorer = TrustScorer(decay_half_life=None)
        # Give a1 high trust, a2 low trust
        for _ in range(50):
            scorer.record_success("a1", wait_ticks=1)
            scorer.record_error("a2")

        agents = [Agent(agent_id="a1"), Agent(agent_id="a2")]
        resource = SharedResource(name="llm", capacity=1)
        scheduler = AsyncLOCOScheduler(
            agents, resource, optimize_for="balanced", trust_scorer=scorer
        )

        # Give both agents equal queue depth
        for aid in ["a1", "a2"]:
            await scheduler.submit_task(aid, Task(weight=1.0))

        assert scorer.priority_multiplier("a1") > scorer.priority_multiplier("a2")
