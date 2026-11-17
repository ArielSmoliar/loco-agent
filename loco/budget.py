"""Process-local budget reservations and settlement for LOCO-Agent.

A reject-mode admission checks settled spend + outstanding reservations + estimate.
Reserve and settle share a lock, including across schedulers using this same policy.
This is not a distributed ledger; estimates must bound charges for a strict ceiling.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from threading import RLock
from typing import Any
from uuid import uuid4

from loco.policy import Policy, PolicyViolationError
from loco.task import Task


def validate_cost(cost: float) -> float:
    """Reject values that could corrupt or reduce the spend ledger."""
    if isinstance(cost, bool) or not isinstance(cost, (int, float)):
        raise ValueError("Cost must be a finite nonnegative number")
    value = float(cost)
    if not math.isfinite(value) or value < 0:
        raise ValueError("Cost must be a finite nonnegative number")
    return value


class BudgetExceededError(PolicyViolationError):
    """The proposed commitment exceeds an agent's remaining budget."""

    def __init__(self, agent_id: str, current: float, limit: float, task_cost: float):
        self.current, self.limit, self.task_cost = current, limit, task_cost
        super().__init__(
            "budget", agent_id, f"current={current:.1f} + task={task_cost:.1f} > limit={limit:.1f}"
        )


@dataclass(frozen=True)
class BudgetReservation:
    """Opaque, single-use reservation returned by BudgetPolicy.reserve()."""

    agent_id: str
    cost: float
    _owner: Any = field(repr=False, compare=False)
    reservation_id: str = field(default_factory=lambda: uuid4().hex)


class BudgetPolicy(Policy):
    """Per-agent ceilings over settled spend and outstanding estimates.

    ``reject`` enforces admission limits; ``alert`` and ``downgrade`` intentionally
    allow over-budget work. Settlement records actual cost even above the estimate:
    the charge already happened, and future admissions must see it. Unknown actual
    cost settles to the reserved estimate. Reservations are process-local.
    """

    name = "budget"

    def __init__(self, default_limit: float | None = None, on_exceeded: str = "reject"):
        if on_exceeded not in ("reject", "alert", "downgrade"):
            raise ValueError("on_exceeded must be reject, alert, or downgrade")
        self._lock = RLock()
        self._limits: dict[str, float] = {}
        self._spent: dict[str, float] = {}
        self._reservations: dict[str, BudgetReservation] = {}
        self.default_limit = None if default_limit is None else validate_cost(default_limit)
        self.on_exceeded = on_exceeded
        self._alerts: list[dict[str, Any]] = []

    def set_limit(self, agent_id: str, max_cost: float) -> None:
        with self._lock:
            self._limits[agent_id] = validate_cost(max_cost)

    def remove_limit(self, agent_id: str) -> None:
        with self._lock:
            self._limits.pop(agent_id, None)

    def get_limit(self, agent_id: str) -> float | None:
        with self._lock:
            value = self._limits.get(agent_id, self.default_limit)
            return None if value is None else validate_cost(value)

    def spent(self, agent_id: str) -> float:
        """Settled spend only; outstanding commitments are in reserved()."""
        with self._lock:
            return self._spent.get(agent_id, 0.0)

    def reserved(self, agent_id: str) -> float:
        with self._lock:
            return math.fsum(r.cost for r in self._reservations.values() if r.agent_id == agent_id)

    def remaining(self, agent_id: str) -> float | None:
        with self._lock:
            limit = self.get_limit(agent_id)
            return (
                None
                if limit is None
                else max(limit - self.spent(agent_id) - self.reserved(agent_id), 0.0)
            )

    def record_spend(self, agent_id: str, cost: float) -> None:
        """Record an external settled charge; does not authorize future execution."""
        cost = validate_cost(cost)
        with self._lock:
            self._spent[agent_id] = self.spent(agent_id) + cost

    def reset(self, agent_id: str) -> None:
        """Reset settled spend only when the agent has no outstanding reservations."""
        with self._lock:
            if any(r.agent_id == agent_id for r in self._reservations.values()):
                raise RuntimeError("Cannot reset a budget with outstanding reservations")
            self._spent.pop(agent_id, None)

    def reset_all(self) -> None:
        with self._lock:
            if self._reservations:
                raise RuntimeError("Cannot reset budgets with outstanding reservations")
            self._spent.clear()

    def check(self, agent_id: str, task_cost: Task | float = 0.0) -> bool:
        """Return True to allow, raising on reject-mode overages.

        Alert/downgrade overages record a warning and return True. Inspect
        alerts for warnings; use reserve() for atomic check-and-commit admission.
        """
        cost = validate_cost(task_cost.weight if isinstance(task_cost, Task) else task_cost)
        with self._lock:
            limit = self.get_limit(agent_id)
            current = self.spent(agent_id) + self.reserved(agent_id)
            if limit is not None and current + cost > limit:
                self._alerts.append(
                    {
                        "agent_id": agent_id,
                        "current": current,
                        "task_cost": cost,
                        "limit": limit,
                        "action": self.on_exceeded,
                    }
                )
                if self.on_exceeded == "reject":
                    raise BudgetExceededError(agent_id, current, limit, cost)
                return True
            return True

    def reserve(self, agent_id: str, task: Task | float) -> BudgetReservation:
        """Atomically check the ceiling and commit the estimated cost."""
        cost = validate_cost(task.weight if isinstance(task, Task) else task)
        with self._lock:
            self._check_or_raise(agent_id, task)
            token = BudgetReservation(agent_id, cost, self)
            self._reservations[token.reservation_id] = token
            return token

    def _lookup(self, reservation: BudgetReservation) -> BudgetReservation | None:
        if not isinstance(reservation, BudgetReservation) or reservation._owner is not self:
            raise ValueError("Reservation belongs to another budget")
        current = self._reservations.get(reservation.reservation_id)
        if current is not None and current is not reservation:
            raise ValueError("Invalid reservation token")
        return current

    def settle(self, reservation: BudgetReservation, actual_cost: float | None = None) -> bool:
        """Swap reservation for a settled charge atomically; duplicate calls are no-ops."""
        with self._lock:
            token = self._lookup(reservation)
            if token is None:
                return False
            cost = token.cost if actual_cost is None else validate_cost(actual_cost)
            # Record before removing so validation failures retain the original commitment.
            self.record_spend(token.agent_id, cost)
            del self._reservations[token.reservation_id]
            return True

    def cancel(self, reservation: BudgetReservation) -> bool:
        """Roll back a reservation for execution that never started; idempotent."""
        with self._lock:
            token = self._lookup(reservation)
            if token is None:
                return False
            del self._reservations[token.reservation_id]
            return True

    def settle_reservation(self, agent_id, task, reservation, actual_cost=None):
        self.settle(reservation, actual_cost)

    def cancel_reservation(self, agent_id, task, reservation):
        self.cancel(reservation)

    def record(self, agent_id: str, task: Task) -> None:
        """Legacy completion-only API; scheduler reservation paths use settle()."""
        self.record_spend(agent_id, task.weight)

    @property
    def alerts(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(alert) for alert in self._alerts]

    def summary(self) -> dict[str, dict[str, float | None]]:
        with self._lock:
            agents = (
                set(self._limits)
                | set(self._spent)
                | {r.agent_id for r in self._reservations.values()}
            )
            return {
                aid: {
                    "limit": self.get_limit(aid),
                    "spent": self.spent(aid),
                    "reserved": self.reserved(aid),
                    "remaining": self.remaining(aid),
                }
                for aid in sorted(agents)
            }


BudgetManager = BudgetPolicy
