"""Tests for Policy base class, PolicyEnforcer, AccessPolicy, RatePolicy."""

import time

import pytest

from loco.labels import SecurityLabel
from loco.policy import (
    AccessPolicy,
    Policy,
    PolicyEnforcer,
    PolicyViolationError,
    RatePolicy,
)
from loco.task import Task


# --- Test helpers ---


class AllowPolicy(Policy):
    """Policy that always allows."""

    name = "allow"

    def check(self, agent_id: str, task: Task) -> bool:
        return True


class DenyPolicy(Policy):
    """Policy that always rejects."""

    name = "deny"

    def __init__(self, detail: str = "denied"):
        self._detail = detail

    def check(self, agent_id: str, task: Task) -> bool:
        raise PolicyViolationError(self.name, agent_id, self._detail)


class TrackingPolicy(Policy):
    """Policy that records check and record calls for testing."""

    name = "tracking"

    def __init__(self):
        self.checked: list[tuple[str, str]] = []
        self.recorded: list[tuple[str, str]] = []

    def check(self, agent_id: str, task: Task) -> bool:
        self.checked.append((agent_id, task.task_id))
        return True

    def record(self, agent_id: str, task: Task) -> None:
        self.recorded.append((agent_id, task.task_id))


# --- PolicyViolationError ---


class TestPolicyViolationError:
    def test_attributes(self):
        err = PolicyViolationError("budget", "agent_1", "over limit")
        assert err.policy_name == "budget"
        assert err.agent_id == "agent_1"
        assert err.detail == "over limit"

    def test_message(self):
        err = PolicyViolationError("rate", "a", "too fast")
        assert "rate" in str(err)
        assert "a" in str(err)
        assert "too fast" in str(err)

    def test_is_exception(self):
        with pytest.raises(PolicyViolationError):
            raise PolicyViolationError("test", "a", "fail")


# --- Policy ABC ---


class TestPolicyABC:
    def test_cannot_instantiate_directly(self):
        with pytest.raises(TypeError):
            Policy()

    def test_subclass_must_implement_check(self):
        class Incomplete(Policy):
            name = "incomplete"

        with pytest.raises(TypeError):
            Incomplete()

    def test_subclass_with_check_works(self):
        policy = AllowPolicy()
        task = Task(task_id="t1")
        assert policy.check("agent_1", task) is True

    def test_default_record_is_noop(self):
        policy = AllowPolicy()
        task = Task(task_id="t1")
        policy.record("agent_1", task)  # should not raise


# --- PolicyEnforcer ---


class TestPolicyEnforcer:
    def test_empty_enforcer_passes(self):
        enforcer = PolicyEnforcer()
        task = Task(task_id="t1")
        passed = enforcer.check_all("agent_1", task)
        assert passed == []

    def test_single_allow_policy(self):
        enforcer = PolicyEnforcer([AllowPolicy()])
        task = Task(task_id="t1")
        passed = enforcer.check_all("agent_1", task)
        assert passed == ["allow"]

    def test_single_deny_policy(self):
        enforcer = PolicyEnforcer([DenyPolicy()])
        task = Task(task_id="t1")
        with pytest.raises(PolicyViolationError, match="deny"):
            enforcer.check_all("agent_1", task)

    def test_multiple_policies_all_pass(self):
        enforcer = PolicyEnforcer([AllowPolicy(), TrackingPolicy()])
        task = Task(task_id="t1")
        passed = enforcer.check_all("agent_1", task)
        assert passed == ["allow", "tracking"]

    def test_short_circuit_on_first_denial(self):
        tracker = TrackingPolicy()
        enforcer = PolicyEnforcer([DenyPolicy(), tracker])
        task = Task(task_id="t1")
        with pytest.raises(PolicyViolationError, match="deny"):
            enforcer.check_all("agent_1", task)
        # Tracker was never reached
        assert tracker.checked == []

    def test_deny_after_allow(self):
        tracker = TrackingPolicy()
        enforcer = PolicyEnforcer([tracker, DenyPolicy()])
        task = Task(task_id="t1")
        with pytest.raises(PolicyViolationError, match="deny"):
            enforcer.check_all("agent_1", task)
        # Tracker was checked before deny
        assert len(tracker.checked) == 1

    def test_record_all(self):
        t1 = TrackingPolicy()
        t1.name = "t1"
        t2 = TrackingPolicy()
        t2.name = "t2"
        enforcer = PolicyEnforcer([t1, t2])
        task = Task(task_id="task_a")
        enforcer.record_all("agent_1", task)
        assert len(t1.recorded) == 1
        assert len(t2.recorded) == 1
        assert t1.recorded[0] == ("agent_1", "task_a")

    def test_add_policy(self):
        enforcer = PolicyEnforcer()
        assert len(enforcer) == 0
        enforcer.add_policy(AllowPolicy())
        assert len(enforcer) == 1

    def test_remove_policy(self):
        enforcer = PolicyEnforcer([AllowPolicy(), DenyPolicy()])
        removed = enforcer.remove_policy("deny")
        assert removed is not None
        assert removed.name == "deny"
        assert len(enforcer) == 1

    def test_remove_nonexistent_returns_none(self):
        enforcer = PolicyEnforcer([AllowPolicy()])
        assert enforcer.remove_policy("nope") is None

    def test_get_policy(self):
        allow = AllowPolicy()
        enforcer = PolicyEnforcer([allow])
        assert enforcer.get_policy("allow") is allow
        assert enforcer.get_policy("nope") is None

    def test_bool_empty(self):
        assert not PolicyEnforcer()
        assert not PolicyEnforcer([])

    def test_bool_nonempty(self):
        assert PolicyEnforcer([AllowPolicy()])

    def test_policies_property_is_copy(self):
        enforcer = PolicyEnforcer([AllowPolicy()])
        policies = enforcer.policies
        policies.append(DenyPolicy())
        assert len(enforcer) == 1  # original unchanged

    def test_summary_with_tracking(self):
        enforcer = PolicyEnforcer([TrackingPolicy()])
        s = enforcer.summary()
        assert "tracking" in s
        assert s["tracking"]["type"] == "TrackingPolicy"


# --- AccessPolicy ---


class TestAccessPolicy:
    def test_no_rules_allows(self):
        policy = AccessPolicy(rules={})
        task = Task(task_id="t1", labels={"input": SecurityLabel.CONFIDENTIAL})
        assert policy.check("agent_1", task) is True

    def test_unlisted_agent_allowed(self):
        """Agents not in rules are allowed by default (open by default)."""
        policy = AccessPolicy(rules={"other": {"labels": ["public"]}})
        task = Task(task_id="t1", labels={"input": SecurityLabel.CONFIDENTIAL})
        assert policy.check("agent_1", task) is True

    def test_allowed_label(self):
        policy = AccessPolicy(rules={"a": {"labels": ["public", "internal"]}})
        task = Task(task_id="t1", labels={"input": SecurityLabel.PUBLIC})
        assert policy.check("a", task) is True

    def test_denied_label(self):
        policy = AccessPolicy(rules={"a": {"labels": ["public"]}})
        task = Task(task_id="t1", labels={"input": SecurityLabel.CONFIDENTIAL})
        with pytest.raises(PolicyViolationError, match="confidential"):
            policy.check("a", task)

    def test_no_labels_on_task(self):
        """Task without labels always passes."""
        policy = AccessPolicy(rules={"a": {"labels": ["public"]}})
        task = Task(task_id="t1")  # no labels
        assert policy.check("a", task) is True

    def test_multiple_labels_all_must_match(self):
        policy = AccessPolicy(rules={"a": {"labels": ["public", "internal"]}})
        task = Task(task_id="t1", labels={
            "input": SecurityLabel.PUBLIC,
            "output": SecurityLabel.INTERNAL,
        })
        assert policy.check("a", task) is True

    def test_multiple_labels_one_denied(self):
        policy = AccessPolicy(rules={"a": {"labels": ["public"]}})
        task = Task(task_id="t1", labels={
            "input": SecurityLabel.PUBLIC,
            "output": SecurityLabel.CONFIDENTIAL,
        })
        with pytest.raises(PolicyViolationError, match="confidential"):
            policy.check("a", task)

    def test_no_labels_in_rules_allows_any(self):
        """If rules exist but don't specify labels, all labels are allowed."""
        policy = AccessPolicy(rules={"a": {"resources": ["llm_api"]}})
        task = Task(task_id="t1", labels={"input": SecurityLabel.CONFIDENTIAL})
        assert policy.check("a", task) is True

    def test_name(self):
        assert AccessPolicy(rules={}).name == "access"


# --- RatePolicy ---


class TestRatePolicy:
    def test_within_limit(self):
        policy = RatePolicy(limits={"a": 5.0}, period=60.0)
        task = Task(task_id="t1")
        for _ in range(5):
            assert policy.check("a", task) is True

    def test_exceeds_limit(self):
        policy = RatePolicy(limits={"a": 3.0}, period=60.0)
        task = Task(task_id="t1")
        policy.check("a", task)
        policy.check("a", task)
        policy.check("a", task)
        with pytest.raises(PolicyViolationError, match="Rate limit"):
            policy.check("a", task)

    def test_unlisted_agent_unlimited(self):
        policy = RatePolicy(limits={"other": 1.0})
        task = Task(task_id="t1")
        for _ in range(100):
            assert policy.check("a", task) is True

    def test_default_limit(self):
        policy = RatePolicy(default_limit=2.0, period=60.0)
        task = Task(task_id="t1")
        policy.check("a", task)
        policy.check("a", task)
        with pytest.raises(PolicyViolationError):
            policy.check("a", task)

    def test_remaining(self):
        policy = RatePolicy(limits={"a": 5.0}, period=60.0)
        task = Task(task_id="t1")
        assert policy.remaining("a") == 5.0
        policy.check("a", task)
        r = policy.remaining("a")
        assert r is not None
        assert r < 5.0

    def test_remaining_unlimited(self):
        policy = RatePolicy(limits={})
        assert policy.remaining("a") is None

    def test_refill(self):
        """Bucket refills over time."""
        policy = RatePolicy(limits={"a": 10.0}, period=1.0)
        task = Task(task_id="t1")
        # Drain the bucket
        for _ in range(10):
            policy.check("a", task)
        # Should be empty now
        with pytest.raises(PolicyViolationError):
            policy.check("a", task)
        # Wait for refill (bucket refills at 10 tokens/sec)
        time.sleep(0.15)
        # Should have some tokens back
        assert policy.check("a", task) is True

    def test_name(self):
        assert RatePolicy().name == "rate"

    def test_empty_init(self):
        """RatePolicy with no limits allows everything."""
        policy = RatePolicy()
        task = Task(task_id="t1")
        for _ in range(100):
            assert policy.check("a", task) is True
