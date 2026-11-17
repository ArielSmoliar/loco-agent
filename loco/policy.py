"""Policy engine for LOCO-Agent.

Composable policies evaluated at dispatch time. The PolicyEnforcer sits
between the scheduler's grant decision and task execution, checking each
policy in order and short-circuiting on the first rejection.

Usage:
    from loco.policy import PolicyEnforcer, PolicyViolationError

    enforcer = PolicyEnforcer(policies=[budget_policy, access_policy])
    enforcer.check_all(agent_id, task)  # raises PolicyViolationError on failure
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import Any

from loco.task import Task


class PolicyViolationError(Exception):
    """Raised when a policy check fails in reject mode."""

    def __init__(self, policy_name: str, agent_id: str, detail: str):
        self.policy_name = policy_name
        self.agent_id = agent_id
        self.detail = detail
        super().__init__(f"Policy {policy_name!r} violated by agent {agent_id!r}: {detail}")


class Policy(ABC):
    """Base class for all scheduling policies.

    Subclasses must implement check() and may override record().
    The ``name`` attribute identifies the policy in logs and audit records.
    """

    name: str = "base"

    @abstractmethod
    def check(self, agent_id: str, task: Task) -> bool:
        """Check if the task is allowed for this agent.

        Return True to allow, False to deny, or raise PolicyViolationError
        with a reason. Advisory policies must record their warning and return
        True. Any non-bool result is a contract error and prevents execution.
        """

    def _check_or_raise(self, agent_id: str, task: Task) -> None:
        """Apply the boolean contract consistently without checking twice."""
        result = self.check(agent_id, task)
        if result is False:
            raise PolicyViolationError(self.name, agent_id, "check() returned False")
        if result is not True:
            raise TypeError(f"Policy {self.name!r} check() must return a bool")

    def record(self, agent_id: str, task: Task) -> None:
        """Called after task completes. Override for accounting/tracking."""

    def reserve(self, agent_id: str, task: Task) -> Any:
        """Check admission. Stateful policies may return an opaque reservation.

        Overrides must enforce check()'s decision (via _check_or_raise) or raise
        on rejection, and undo partial reservations before raising. Returned
        values are reservation tokens, not boolean admission decisions.
        """
        self._check_or_raise(agent_id, task)
        return None

    def settle_reservation(self, agent_id, task, reservation, actual_cost=None):
        """Default lifecycle preserves existing completion hooks."""
        self.record(agent_id, task)

    def cancel_reservation(self, agent_id, task, reservation):
        """Roll back admission that failed before execution; stateless by default."""


class PolicyEnforcer:
    """Evaluates a list of policies at dispatch time.

    Short-circuits on the first rejection: False becomes PolicyViolationError.
    Exceptions propagate, and subsequent policies are not checked.

    Args:
        policies: Ordered list of policies to evaluate.
    """

    def __init__(self, policies: list[Policy] | None = None) -> None:
        self._policies: list[Policy] = list(policies) if policies else []

    @property
    def policies(self) -> list[Policy]:
        """Read-only view of registered policies."""
        return list(self._policies)

    def add_policy(self, policy: Policy) -> None:
        """Append a policy to the evaluation list."""
        self._policies.append(policy)

    def remove_policy(self, name: str) -> Policy | None:
        """Remove the first policy with the given name. Returns it or None."""
        for i, p in enumerate(self._policies):
            if p.name == name:
                return self._policies.pop(i)
        return None

    def get_policy(self, name: str) -> Policy | None:
        """Get the first policy with the given name."""
        for p in self._policies:
            if p.name == name:
                return p
        return None

    def check_all(self, agent_id: str, task: Task) -> list[str]:
        """Run all policies in order. Short-circuits on first rejection.

        Returns list of policy names that passed (for audit logging).
        Raises PolicyViolationError on the first failure.
        """
        passed: list[str] = []
        for policy in self._policies:
            policy._check_or_raise(agent_id, task)
            passed.append(policy.name)
        return passed

    def record_all(self, agent_id: str, task: Task) -> None:
        """Record task completion to all policies."""
        for policy in self._policies:
            policy.record(agent_id, task)

    def reserve_all(self, agent_id: str, task: Task) -> list[tuple[Policy, Any]]:
        """Reserve against a policy snapshot, rolling back if any check fails."""
        reservations = []
        try:
            for policy in tuple(self._policies):
                reservations.append((policy, policy.reserve(agent_id, task)))
        except BaseException:
            self.cancel_all(agent_id, task, reservations)
            raise
        return reservations

    @staticmethod
    def cancel_all(agent_id, task, reservations):
        error = None
        for policy, token in reversed(reservations):
            try:
                policy.cancel_reservation(agent_id, task, token)
            except BaseException as exc:
                error = error or exc
        if error is not None:
            raise error

    @staticmethod
    def settle_all(agent_id, task, reservations, actual_cost=None):
        """Settle every admitted policy even if another completion hook fails."""
        error = None
        for policy, token in reservations:
            try:
                policy.settle_reservation(agent_id, task, token, actual_cost)
            except BaseException as exc:
                error = error or exc
        if error is not None:
            raise error

    def summary(self) -> dict[str, Any]:
        """Summary of all policies. Delegates to each policy's summary if available."""
        result: dict[str, Any] = {}
        for policy in self._policies:
            if hasattr(policy, "summary") and callable(policy.summary):
                result[policy.name] = policy.summary()
            else:
                result[policy.name] = {"type": type(policy).__name__}
        return result

    def __len__(self) -> int:
        return len(self._policies)

    def __bool__(self) -> bool:
        return len(self._policies) > 0


# --- Built-in policies ---


class AccessPolicy(Policy):
    """Controls which agents can process tasks with specific security labels.

    Open by default: agents not listed in rules are allowed. Only agents
    with explicit rules are constrained.

    Args:
        rules: Per-agent access rules. Each value is a dict that may contain:
            - "labels": list of allowed SecurityLabel values (as strings)
            - "resources": list of allowed resource names (reserved for v0.5)
    """

    name = "access"

    def __init__(self, rules: dict[str, dict[str, list[str]]]) -> None:
        self._rules = rules

    def check(self, agent_id: str, task: Task) -> bool:
        """Check if the agent is allowed to process this task's labels."""
        if agent_id not in self._rules:
            return True  # open by default

        agent_rules = self._rules[agent_id]
        allowed_labels = agent_rules.get("labels")

        if allowed_labels is not None and task.labels:
            for _key, label in task.labels.items():
                label_value = label.value if hasattr(label, "value") else str(label)
                if label_value not in allowed_labels:
                    raise PolicyViolationError(
                        self.name,
                        agent_id,
                        f"Label {label_value!r} not in allowed set {allowed_labels}",
                    )

        return True


class RatePolicy(Policy):
    """Per-agent request rate limits using a token bucket algorithm.

    Each agent gets a bucket that refills at ``rate / period`` tokens per
    second. Each check() consumes one token. When the bucket is empty
    the check raises PolicyViolationError.

    Args:
        limits: Per-agent rate limits (max requests per period).
        period: Time window in seconds (default 60).
        default_limit: Rate limit for agents not in ``limits``. None = unlimited.
    """

    name = "rate"

    def __init__(
        self,
        limits: dict[str, float] | None = None,
        period: float = 60.0,
        default_limit: float | None = None,
    ) -> None:
        self._limits = dict(limits) if limits else {}
        self._period = period
        self._default_limit = default_limit
        self._buckets: dict[str, _TokenBucket] = {}

    def _get_bucket(self, agent_id: str) -> _TokenBucket | None:
        """Get or create the token bucket for an agent."""
        limit = self._limits.get(agent_id, self._default_limit)
        if limit is None:
            return None
        if agent_id not in self._buckets:
            self._buckets[agent_id] = _TokenBucket(limit, self._period)
        return self._buckets[agent_id]

    def check(self, agent_id: str, task: Task) -> bool:
        """Consume one token from the agent's bucket."""
        bucket = self._get_bucket(agent_id)
        if bucket is None:
            return True
        if not bucket.try_consume():
            raise PolicyViolationError(
                self.name,
                agent_id,
                f"Rate limit exceeded ({bucket.capacity}/{self._period}s)",
            )
        return True

    def remaining(self, agent_id: str) -> float | None:
        """Tokens remaining for this agent. None = unlimited."""
        bucket = self._get_bucket(agent_id)
        if bucket is None:
            return None
        bucket.refill()
        return bucket.tokens


class _TokenBucket:
    """Simple token bucket for rate limiting."""

    def __init__(self, capacity: float, period: float) -> None:
        self.capacity = capacity
        self.tokens = capacity
        self._refill_rate = capacity / period  # tokens per second
        self._last_refill = time.monotonic()

    def refill(self) -> None:
        """Add tokens based on elapsed time."""
        now = time.monotonic()
        elapsed = now - self._last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self._refill_rate)
        self._last_refill = now

    def try_consume(self, n: float = 1.0) -> bool:
        """Try to consume n tokens. Returns True on success."""
        self.refill()
        if self.tokens >= n:
            self.tokens -= n
            return True
        return False
