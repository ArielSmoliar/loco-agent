"""Tests for optimize_for API and alpha validation (Day 6)."""

import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler
from loco.resource import SharedResource
from loco.scheduler import OPTIMIZE_FOR_ALPHA, LOCOScheduler


def _agents() -> list[Agent]:
    return [Agent(agent_id="a1"), Agent(agent_id="a2")]


# --- optimize_for mapping ---


def test_optimize_for_latency():
    sched = LOCOScheduler(_agents(), optimize_for="latency")
    assert sched.alpha == 0.0


def test_optimize_for_balanced():
    sched = LOCOScheduler(_agents(), optimize_for="balanced")
    assert sched.alpha == 0.25


def test_optimize_for_throughput():
    sched = LOCOScheduler(_agents(), optimize_for="throughput")
    assert sched.alpha == 0.5


# --- default behavior ---


def test_neither_defaults_to_balanced():
    sched = LOCOScheduler(_agents())
    assert sched.alpha == 0.25


# --- mutual exclusion ---


def test_both_alpha_and_optimize_for_raises():
    with pytest.raises(ValueError, match="not both"):
        LOCOScheduler(_agents(), alpha=0.3, optimize_for="balanced")


# --- invalid values ---


def test_invalid_optimize_for_raises():
    with pytest.raises(ValueError, match="optimize_for must be one of"):
        LOCOScheduler(_agents(), optimize_for="turbo")


def test_alpha_too_high_raises():
    with pytest.raises(ValueError, match="alpha must be in"):
        LOCOScheduler(_agents(), alpha=1.5)


def test_alpha_negative_raises():
    with pytest.raises(ValueError, match="alpha must be in"):
        LOCOScheduler(_agents(), alpha=-0.1)


# --- raw alpha still works ---


def test_raw_alpha_passthrough():
    sched = LOCOScheduler(_agents(), alpha=0.3)
    assert sched.alpha == 0.3


def test_alpha_zero_valid():
    sched = LOCOScheduler(_agents(), alpha=0.0)
    assert sched.alpha == 0.0


def test_alpha_one_valid():
    sched = LOCOScheduler(_agents(), alpha=1.0)
    assert sched.alpha == 1.0


# --- AsyncLOCOScheduler passes through ---


def test_async_optimize_for_latency():
    res = SharedResource(name="test", capacity=1)
    sched = AsyncLOCOScheduler(_agents(), res, optimize_for="latency")
    assert sched.alpha == 0.0


def test_async_optimize_for_balanced():
    res = SharedResource(name="test", capacity=1)
    sched = AsyncLOCOScheduler(_agents(), res, optimize_for="balanced")
    assert sched.alpha == 0.25


def test_async_optimize_for_throughput():
    res = SharedResource(name="test", capacity=1)
    sched = AsyncLOCOScheduler(_agents(), res, optimize_for="throughput")
    assert sched.alpha == 0.5


def test_async_both_raises():
    res = SharedResource(name="test", capacity=1)
    with pytest.raises(ValueError, match="not both"):
        AsyncLOCOScheduler(_agents(), res, alpha=0.3, optimize_for="balanced")


def test_async_neither_defaults_to_balanced():
    res = SharedResource(name="test", capacity=1)
    sched = AsyncLOCOScheduler(_agents(), res)
    assert sched.alpha == 0.25


# --- OPTIMIZE_FOR_ALPHA mapping is complete ---


def test_optimize_for_alpha_has_three_entries():
    assert len(OPTIMIZE_FOR_ALPHA) == 3
    assert set(OPTIMIZE_FOR_ALPHA.keys()) == {"latency", "balanced", "throughput"}


def test_throughput_caps_at_half():
    """Alpha > 0.5 causes starvation (Scenario 2). Throughput must not exceed 0.5."""
    assert OPTIMIZE_FOR_ALPHA["throughput"] == 0.5
