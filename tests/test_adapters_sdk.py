"""Tests for Anthropic and OpenAI SDK adapters + empirical cost tracking (v0.2.0)."""

import asyncio
from dataclasses import dataclass

import pytest

from loco.adapters.anthropic import AnthropicAdapter
from loco.adapters.anthropic import estimate_weight as anthropic_weight
from loco.adapters.openai import OpenAIAdapter
from loco.adapters.openai import estimate_weight as openai_weight
from loco.async_scheduler import AsyncLOCOScheduler
from loco.resource import SharedResource
from loco.task import Task

# ---------------------------------------------------------------------------
# Mock SDK clients
# ---------------------------------------------------------------------------

@dataclass
class MockUsage:
    input_tokens: int = 100
    output_tokens: int = 50
    total_tokens: int = 150


@dataclass
class MockAnthropicMessage:
    content: str = "Hello!"
    usage: MockUsage | None = None


@dataclass
class MockOpenAICompletion:
    choices: list = None
    usage: MockUsage | None = None

    def __post_init__(self):
        if self.choices is None:
            self.choices = []


class MockAnthropicClient:
    """Mock anthropic.AsyncAnthropic for testing."""

    def __init__(self, usage: MockUsage | None = None):
        self.calls: list[dict] = []
        self._usage = usage or MockUsage()
        self.messages = self

    async def create(self, **kwargs) -> MockAnthropicMessage:
        self.calls.append(kwargs)
        return MockAnthropicMessage(usage=self._usage)


class MockOpenAIClient:
    """Mock openai.AsyncOpenAI for testing."""

    def __init__(self, usage: MockUsage | None = None):
        self.calls: list[dict] = []
        self._usage = usage or MockUsage()
        self.chat = self
        self.completions = self

    async def create(self, **kwargs) -> MockOpenAICompletion:
        self.calls.append(kwargs)
        return MockOpenAICompletion(usage=self._usage)


def _make_scheduler(capacity: int = 3) -> AsyncLOCOScheduler:
    return AsyncLOCOScheduler(
        [], SharedResource(name="test", capacity=capacity),
        optimize_for="balanced",
    )


# ---------------------------------------------------------------------------
# Weight estimation
# ---------------------------------------------------------------------------

class TestAnthropicWeightEstimation:

    def test_opus_weight(self):
        assert anthropic_weight("claude-opus-4-20250514") == 5.0

    def test_sonnet_weight(self):
        assert anthropic_weight("claude-sonnet-4-20250514") == 2.0

    def test_haiku_weight(self):
        assert anthropic_weight("claude-haiku-4-5-20251001") == 1.0

    def test_unknown_model_defaults_to_sonnet(self):
        assert anthropic_weight("claude-unknown-99") == 2.0

    def test_family_fallback(self):
        assert anthropic_weight("claude-opus-5-future") == 5.0

    def test_token_scaling(self):
        base = anthropic_weight("claude-sonnet-4-20250514")  # 2.0
        scaled = anthropic_weight("claude-sonnet-4-20250514", input_tokens=5000)
        assert scaled == base * 5.0  # 5k tokens = 5x

    def test_small_prompt_no_scaling_below_1k(self):
        w = anthropic_weight("claude-sonnet-4-20250514", input_tokens=500)
        assert w == 2.0  # 500 tokens < 1k, multiplier clamped to 1.0


class TestOpenAIWeightEstimation:

    def test_gpt4o_weight(self):
        assert openai_weight("gpt-4o") == 3.0

    def test_gpt4o_mini_weight(self):
        assert openai_weight("gpt-4o-mini") == 1.0

    def test_o3_weight(self):
        assert openai_weight("o3") == 5.0

    def test_unknown_defaults(self):
        assert openai_weight("some-future-model") == 2.0

    def test_family_fallback(self):
        assert openai_weight("gpt-4o-turbo-2025") == 3.0


# ---------------------------------------------------------------------------
# Anthropic adapter
# ---------------------------------------------------------------------------

class TestAnthropicAdapter:

    @pytest.mark.asyncio
    async def test_create_calls_api(self):
        sched = _make_scheduler()
        client = MockAnthropicClient()
        adapter = AnthropicAdapter(sched, client)

        response = await adapter.create(
            "analyst",
            model="claude-sonnet-4-20250514",
            messages=[{"role": "user", "content": "Hello"}],
        )
        assert response.content == "Hello!"
        assert len(client.calls) == 1
        assert client.calls[0]["model"] == "claude-sonnet-4-20250514"

    @pytest.mark.asyncio
    async def test_auto_registers_agent(self):
        sched = _make_scheduler()
        client = MockAnthropicClient()
        adapter = AnthropicAdapter(sched, client)

        await adapter.create("new-agent", messages=[{"role": "user", "content": "Hi"}])
        assert "new-agent" in sched.agents

    @pytest.mark.asyncio
    async def test_records_cost(self):
        sched = _make_scheduler()
        client = MockAnthropicClient()
        adapter = AnthropicAdapter(sched, client)

        await adapter.create("analyst", model="claude-opus-4-20250514",
                             messages=[{"role": "user", "content": "x"}])
        assert sched.metrics.agent_cost("analyst") == 5.0

    @pytest.mark.asyncio
    async def test_records_actual_tokens(self):
        usage = MockUsage(input_tokens=200, output_tokens=100)
        sched = _make_scheduler()
        client = MockAnthropicClient(usage=usage)
        adapter = AnthropicAdapter(sched, client)

        await adapter.create("analyst", messages=[{"role": "user", "content": "x"}])
        assert sched.metrics.total_actual_tokens() == 300  # 200 + 100

    @pytest.mark.asyncio
    async def test_dequeues_task(self):
        sched = _make_scheduler()
        client = MockAnthropicClient()
        adapter = AnthropicAdapter(sched, client)

        await adapter.create("analyst", messages=[{"role": "user", "content": "x"}])
        assert len(sched.get_agent("analyst").tasks) == 0
        assert len(sched.get_agent("analyst").completed_tasks) == 1

    @pytest.mark.asyncio
    async def test_default_agent_id(self):
        sched = _make_scheduler()
        client = MockAnthropicClient()
        adapter = AnthropicAdapter(sched, client, default_agent_id="default-claude")

        await adapter.create(messages=[{"role": "user", "content": "x"}])
        assert "default-claude" in sched.agents

    @pytest.mark.asyncio
    async def test_concurrent_calls(self):
        sched = _make_scheduler(capacity=2)
        client = MockAnthropicClient()
        adapter = AnthropicAdapter(sched, client)

        await asyncio.gather(
            adapter.create("a1", messages=[{"role": "user", "content": "x"}]),
            adapter.create("a2", messages=[{"role": "user", "content": "y"}]),
            adapter.create("a3", messages=[{"role": "user", "content": "z"}]),
        )
        assert len(client.calls) == 3
        assert sched.metrics.total_cost() > 0


# ---------------------------------------------------------------------------
# OpenAI adapter
# ---------------------------------------------------------------------------

class TestOpenAIAdapter:

    @pytest.mark.asyncio
    async def test_create_calls_api(self):
        sched = _make_scheduler()
        client = MockOpenAIClient()
        adapter = OpenAIAdapter(sched, client)

        response = await adapter.create(
            "assistant",
            model="gpt-4o",
            messages=[{"role": "user", "content": "Hello"}],
        )
        assert isinstance(response, MockOpenAICompletion)
        assert len(client.calls) == 1
        assert client.calls[0]["model"] == "gpt-4o"

    @pytest.mark.asyncio
    async def test_records_actual_tokens(self):
        usage = MockUsage(total_tokens=500)
        sched = _make_scheduler()
        client = MockOpenAIClient(usage=usage)
        adapter = OpenAIAdapter(sched, client)

        await adapter.create("assistant", messages=[{"role": "user", "content": "x"}])
        assert sched.metrics.total_actual_tokens() == 500

    @pytest.mark.asyncio
    async def test_cost_by_model(self):
        sched = _make_scheduler()
        client = MockOpenAIClient()
        adapter = OpenAIAdapter(sched, client)

        await adapter.create("a1", model="o3",
                             messages=[{"role": "user", "content": "x"}])
        await adapter.create("a2", model="gpt-4o-mini",
                             messages=[{"role": "user", "content": "x"}])

        assert sched.metrics.agent_cost("a1") == 5.0  # o3
        assert sched.metrics.agent_cost("a2") == 1.0  # gpt-4o-mini


# ---------------------------------------------------------------------------
# Empirical cost tracking
# ---------------------------------------------------------------------------

class TestEmpiricalCostTracking:

    @pytest.mark.asyncio
    async def test_ema_weight_after_one_call(self):
        sched = _make_scheduler()
        task = Task(weight=2.0, task_type="anthropic:claude-sonnet-4-20250514")
        sched.metrics.record_actual_tokens("a1", task, 1500)

        ema = sched.metrics.empirical_weight("anthropic:claude-sonnet-4-20250514")
        assert ema == 1500.0  # first observation = the EMA value

    @pytest.mark.asyncio
    async def test_ema_weight_converges(self):
        sched = _make_scheduler()
        task_type = "openai:gpt-4o"

        # Simulate 5 calls all returning ~1000 tokens
        for _ in range(5):
            task = Task(weight=3.0, task_type=task_type)
            sched.metrics.record_actual_tokens("a1", task, 1000)

        ema = sched.metrics.empirical_weight(task_type)
        assert 950 < ema < 1050  # should converge near 1000

    @pytest.mark.asyncio
    async def test_ema_weight_tracks_shift(self):
        sched = _make_scheduler()
        task_type = "test:model"

        # Start at 100 tokens
        for _ in range(5):
            sched.metrics.record_actual_tokens("a1", Task(task_type=task_type), 100)

        # Shift to 500 tokens
        for _ in range(10):
            sched.metrics.record_actual_tokens("a1", Task(task_type=task_type), 500)

        ema = sched.metrics.empirical_weight(task_type)
        assert ema > 400  # should have shifted toward 500

    @pytest.mark.asyncio
    async def test_no_empirical_data_returns_none(self):
        sched = _make_scheduler()
        assert sched.metrics.empirical_weight("unknown:model") is None

    @pytest.mark.asyncio
    async def test_actual_tokens_by_agent(self):
        sched = _make_scheduler()
        sched.metrics.record_actual_tokens("a1", Task(), 100)
        sched.metrics.record_actual_tokens("a1", Task(), 200)
        sched.metrics.record_actual_tokens("a2", Task(), 300)

        by_agent = sched.metrics.actual_tokens_by_agent()
        assert by_agent["a1"] == [100, 200]
        assert by_agent["a2"] == [300]
        assert sched.metrics.total_actual_tokens() == 600
