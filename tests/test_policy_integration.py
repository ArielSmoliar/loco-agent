"""Integration tests: PolicyEnforcer wired into AsyncLOCOScheduler."""


import pytest

from loco.agent import Agent
from loco.async_scheduler import AsyncLOCOScheduler
from loco.budget import BudgetExceededError, BudgetManager, BudgetPolicy
from loco.policy import Policy, PolicyEnforcer, PolicyViolationError
from loco.resource import SharedResource
from loco.task import Task

# --- Test helpers ---


class RejectPolicy(Policy):
    """Policy that always rejects."""

    name = "reject"

    def __init__(self, detail: str = "rejected"):
        self._detail = detail

    def check(self, agent_id: str, task: Task) -> bool:
        raise PolicyViolationError(self.name, agent_id, self._detail)


class CountingPolicy(Policy):
    """Policy that counts check and record calls."""

    name = "counting"

    def __init__(self):
        self.check_count = 0
        self.record_count = 0

    def check(self, agent_id: str, task: Task) -> bool:
        self.check_count += 1
        return True

    def record(self, agent_id: str, task: Task) -> None:
        self.record_count += 1


# --- Tests: enforcer= parameter ---


class TestEnforcerParameter:
    async def test_enforcer_only(self):
        """Scheduler accepts enforcer= without budget=."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        counter = CountingPolicy()
        enforcer = PolicyEnforcer([counter])
        scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

        await scheduler.submit_task("a", Task(task_id="t1"))
        async with scheduler.acquire("a"):
            pass

        assert counter.check_count == 1
        assert counter.record_count == 1

    async def test_budget_only_backward_compat(self):
        """budget= still works without enforcer= (v0.2 backward compat)."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        budget = BudgetManager()
        budget.set_limit("a", 10.0)
        scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)

        await scheduler.submit_task("a", Task(task_id="t1", weight=5.0))
        async with scheduler.acquire("a"):
            pass

        assert budget.spent("a") == 5.0

    async def test_budget_and_enforcer_combined(self):
        """budget= and enforcer= together: budget is added to enforcer."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        budget = BudgetPolicy(default_limit=100.0)
        counter = CountingPolicy()
        enforcer = PolicyEnforcer([counter])
        scheduler = AsyncLOCOScheduler(
            agents, resource, budget=budget, enforcer=enforcer
        )

        await scheduler.submit_task("a", Task(task_id="t1", weight=3.0))
        async with scheduler.acquire("a"):
            pass

        # Both policies were checked and recorded
        assert counter.check_count == 1
        assert counter.record_count == 1
        assert budget.spent("a") == 3.0

    async def test_no_budget_no_enforcer(self):
        """Neither budget= nor enforcer=: no policy checks."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        scheduler = AsyncLOCOScheduler(agents, resource)

        await scheduler.submit_task("a", Task(task_id="t1"))
        async with scheduler.acquire("a"):
            pass
        # Just verify no crash


# --- Tests: policy rejection ---


class TestPolicyRejection:
    async def test_reject_policy_blocks_acquire(self):
        """A rejecting policy prevents resource acquisition."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        enforcer = PolicyEnforcer([RejectPolicy()])
        scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

        await scheduler.submit_task("a", Task(task_id="t1"))
        with pytest.raises(PolicyViolationError, match="reject"):
            async with scheduler.acquire("a"):
                pass

    async def test_reject_frees_slot_for_next_waiter(self):
        """Rejected agent releases resource so next agent can proceed."""
        agents = [Agent(agent_id="a"), Agent(agent_id="b")]
        resource = SharedResource("r", capacity=1)

        # Policy that rejects agent "a" but allows agent "b"
        class SelectiveReject(Policy):
            name = "selective"

            def check(self, agent_id: str, task: Task) -> bool:
                if agent_id == "a":
                    raise PolicyViolationError("selective", agent_id, "denied")
                return True

        enforcer = PolicyEnforcer([SelectiveReject()])
        scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

        await scheduler.submit_task("a", Task(task_id="t1", weight=5.0))
        await scheduler.submit_task("b", Task(task_id="t2", weight=1.0))

        # Agent a is rejected
        with pytest.raises(PolicyViolationError):
            async with scheduler.acquire("a"):
                pass

        # Agent b can still acquire
        async with scheduler.acquire("b"):
            pass

    async def test_budget_exceeded_via_enforcer(self):
        """BudgetExceededError still raised when budget is wrapped in enforcer."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        budget = BudgetPolicy(default_limit=5.0)
        enforcer = PolicyEnforcer([budget])
        scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

        await scheduler.submit_task("a", Task(task_id="t1", weight=10.0))
        with pytest.raises(BudgetExceededError):
            async with scheduler.acquire("a"):
                pass

    async def test_short_circuit_in_scheduler(self):
        """First policy rejection prevents subsequent policies from running."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        counter = CountingPolicy()
        enforcer = PolicyEnforcer([RejectPolicy(), counter])
        scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

        await scheduler.submit_task("a", Task(task_id="t1"))
        with pytest.raises(PolicyViolationError):
            async with scheduler.acquire("a"):
                pass

        assert counter.check_count == 0  # never reached


# --- Tests: policy recording ---


class TestPolicyRecording:
    async def test_record_called_on_release(self):
        """Policies get record() called after task completes."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        counter = CountingPolicy()
        enforcer = PolicyEnforcer([counter])
        scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

        await scheduler.submit_task("a", Task(task_id="t1"))
        async with scheduler.acquire("a"):
            assert counter.record_count == 0  # not yet

        assert counter.record_count == 1  # after release

    async def test_record_called_on_release_handle(self):
        """Split acquire/release path also calls record()."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        counter = CountingPolicy()
        enforcer = PolicyEnforcer([counter])
        scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

        await scheduler.submit_task("a", Task(task_id="t1"))
        handle = await scheduler.acquire_start("a")
        assert counter.record_count == 0
        await scheduler.release_handle(handle)
        assert counter.record_count == 1

    async def test_multiple_tasks_accumulate(self):
        """Each task triggers check and record independently."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        counter = CountingPolicy()
        enforcer = PolicyEnforcer([counter])
        scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

        for i in range(5):
            await scheduler.submit_task("a", Task(task_id=f"t{i}"))
            async with scheduler.acquire("a"):
                pass

        assert counter.check_count == 5
        assert counter.record_count == 5


# --- Tests: multiple policies ---


class TestMultiplePolicies:
    async def test_two_policies_both_pass(self):
        """Two passing policies: both checked and recorded."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        c1 = CountingPolicy()
        c1.name = "c1"
        c2 = CountingPolicy()
        c2.name = "c2"
        enforcer = PolicyEnforcer([c1, c2])
        scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

        await scheduler.submit_task("a", Task(task_id="t1"))
        async with scheduler.acquire("a"):
            pass

        assert c1.check_count == 1
        assert c2.check_count == 1
        assert c1.record_count == 1
        assert c2.record_count == 1

    async def test_budget_plus_custom_policy(self):
        """Budget and custom policy work together."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        budget = BudgetPolicy(default_limit=100.0)
        counter = CountingPolicy()
        enforcer = PolicyEnforcer([budget, counter])
        scheduler = AsyncLOCOScheduler(agents, resource, enforcer=enforcer)

        await scheduler.submit_task("a", Task(task_id="t1", weight=10.0))
        async with scheduler.acquire("a"):
            pass

        assert budget.spent("a") == 10.0
        assert counter.check_count == 1
        assert counter.record_count == 1

    async def test_budget_property_still_accessible(self):
        """scheduler.budget is still accessible for backward compat."""
        agents = [Agent(agent_id="a")]
        resource = SharedResource("r", capacity=1)
        budget = BudgetPolicy(default_limit=50.0)
        scheduler = AsyncLOCOScheduler(agents, resource, budget=budget)

        assert scheduler.budget is budget
        assert scheduler.budget.get_limit("a") == 50.0
