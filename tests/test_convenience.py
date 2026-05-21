"""Tests for the convenience API (loco.configure, loco.wrap, loco.scheduled)."""

import asyncio

import pytest

import loco
from loco.budget import BudgetExceededError


@pytest.fixture(autouse=True)
def reset_global():
    """Reset global scheduler before each test."""
    loco.reset()
    yield
    loco.reset()


# --- configure ---


def test_configure_returns_scheduler():
    scheduler = loco.configure(capacity=2)
    assert scheduler is not None
    assert scheduler.resource.capacity == 2


def test_configure_with_budget():
    scheduler = loco.configure(capacity=1, budget_mode="reject")
    assert scheduler.budget is not None


def test_configure_without_budget():
    scheduler = loco.configure(capacity=1)
    assert scheduler.budget is None


# --- wrap ---


@pytest.mark.asyncio
async def test_wrap_calls_function():
    loco.configure(capacity=1)
    called_with = {}

    async def mock_llm(**kwargs):
        called_with.update(kwargs)
        return "response"

    result = await loco.wrap(
        mock_llm, agent_id="a", weight=2.0, model="sonnet", prompt="hello"
    )
    assert result == "response"
    assert called_with["model"] == "sonnet"
    assert called_with["prompt"] == "hello"


@pytest.mark.asyncio
async def test_wrap_tracks_cost():
    scheduler = loco.configure(capacity=1)

    async def mock_llm(**kwargs):
        return "ok"

    await loco.wrap(mock_llm, agent_id="a", weight=3.0)
    assert scheduler.metrics.agent_cost("a") == 3.0


@pytest.mark.asyncio
async def test_wrap_dequeues_on_success():
    scheduler = loco.configure(capacity=1)

    async def mock_llm(**kwargs):
        return "ok"

    await loco.wrap(mock_llm, agent_id="a", weight=1.0)
    agent = scheduler.get_agent("a")
    assert len(agent.tasks) == 0
    assert len(agent.completed_tasks) == 1


@pytest.mark.asyncio
async def test_wrap_dequeues_on_error():
    scheduler = loco.configure(capacity=1)

    async def failing_llm(**kwargs):
        raise ValueError("API error")

    with pytest.raises(ValueError, match="API error"):
        await loco.wrap(failing_llm, agent_id="a", weight=1.0)

    agent = scheduler.get_agent("a")
    assert len(agent.tasks) == 0  # task was dequeued despite error
    assert len(agent.completed_tasks) == 1


@pytest.mark.asyncio
async def test_wrap_budget_rejection():
    loco.configure(capacity=1, budget_mode="reject")
    loco.set_budget("a", max_cost=2.0)

    async def mock_llm(**kwargs):
        return "ok"

    # First call: within budget
    await loco.wrap(mock_llm, agent_id="a", weight=2.0)

    # Second call: exceeds budget
    with pytest.raises(BudgetExceededError):
        await loco.wrap(mock_llm, agent_id="a", weight=2.0)


@pytest.mark.asyncio
async def test_wrap_concurrent():
    scheduler = loco.configure(capacity=2)
    order = []

    async def mock_llm(**kwargs):
        order.append(kwargs.get("agent"))
        await asyncio.sleep(0)
        return "ok"

    await asyncio.gather(
        loco.wrap(mock_llm, agent_id="a", weight=1.0, agent="a"),
        loco.wrap(mock_llm, agent_id="b", weight=1.0, agent="b"),
        loco.wrap(mock_llm, agent_id="c", weight=1.0, agent="c"),
    )
    assert len(order) == 3


@pytest.mark.asyncio
async def test_wrap_without_configure_raises():
    async def mock_llm(**kwargs):
        return "ok"

    with pytest.raises(RuntimeError, match="configure"):
        await loco.wrap(mock_llm, agent_id="a", weight=1.0)


# --- scheduled decorator ---


@pytest.mark.asyncio
async def test_scheduled_decorator():
    loco.configure(capacity=1)

    @loco.scheduled(agent_id="bot", weight=2.0)
    async def handler(msg):
        return f"handled: {msg}"

    result = await handler("hello")
    assert result == "handled: hello"


@pytest.mark.asyncio
async def test_scheduled_tracks_cost():
    scheduler = loco.configure(capacity=1)

    @loco.scheduled(agent_id="bot", weight=5.0)
    async def handler():
        return "ok"

    await handler()
    assert scheduler.metrics.agent_cost("bot") == 5.0


@pytest.mark.asyncio
async def test_scheduled_dequeues_on_error():
    scheduler = loco.configure(capacity=1)

    @loco.scheduled(agent_id="bot", weight=1.0)
    async def failing_handler():
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        await failing_handler()

    agent = scheduler.get_agent("bot")
    assert len(agent.tasks) == 0


# --- set_budget ---


def test_set_budget_without_budget_mode_raises():
    loco.configure(capacity=1)  # no budget_mode
    with pytest.raises(RuntimeError, match="budget_mode"):
        loco.set_budget("a", max_cost=10.0)


def test_set_budget_works():
    loco.configure(capacity=1, budget_mode="reject")
    loco.set_budget("a", max_cost=10.0)
    scheduler = loco.get_scheduler()
    assert scheduler.budget.get_limit("a") == 10.0
