"""Structured JSON scheduling log for LOCO-Agent.

Every scheduling decision emits a structured event — who got the resource,
at what priority, with what queue depth. In regulated environments (AML,
compliance), these records are evidence that the system allocated compute
fairly and predictably.

Events are emitted via Python's logging module. To capture them, attach a
handler to the "loco.scheduler" logger.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from loco.task import Task

logger = logging.getLogger("loco.scheduler")


def _serialize_event(event: dict[str, Any]) -> str:
    """Serialize an event dict to a JSON string."""
    return json.dumps(event, default=str)


def emit_enqueue(
    tick: int,
    agent_id: str,
    task: Task,
    queue_depth: float,
    resource_name: str,
) -> dict[str, Any]:
    """Emit when a task is submitted to an agent's queue."""
    event: dict[str, Any] = {
        "tick": tick,
        "event": "enqueue",
        "agent": agent_id,
        "task_id": task.task_id,
        "task_cost": task.weight,
        "queue_depth": queue_depth,
        "resource": resource_name,
    }
    if task.labels:
        event["labels"] = {k: str(v) for k, v in task.labels.items()}
    logger.info(_serialize_event(event))
    return event


def emit_grant(
    tick: int,
    agent_id: str,
    task: Task | None,
    score: float,
    queue_depth: float,
    dmax: float,
    resource_name: str,
    utilization: float,
    cumulative_cost: float,
    budget_remaining: float | None = None,
) -> dict[str, Any]:
    """Emit when an agent is granted the resource."""
    event = {
        "tick": tick,
        "event": "grant",
        "agent": agent_id,
        "task_id": task.task_id if task else None,
        "task_cost": task.weight if task else 0,
        "score": round(score, 4),
        "queue_depth": queue_depth,
        "dmax": dmax,
        "resource": resource_name,
        "utilization": round(utilization, 4),
        "agent_cumulative_cost": round(cumulative_cost, 4),
    }
    if budget_remaining is not None:
        event["budget_remaining"] = round(budget_remaining, 4)
    logger.info(_serialize_event(event))
    return event


def emit_release(
    tick: int,
    agent_id: str,
    task: Task | None,
    resource_name: str,
    utilization: float,
) -> dict[str, Any]:
    """Emit when an agent releases the resource."""
    event = {
        "tick": tick,
        "event": "release",
        "agent": agent_id,
        "task_id": task.task_id if task else None,
        "task_cost": task.weight if task else 0,
        "resource": resource_name,
        "utilization": round(utilization, 4),
    }
    logger.info(_serialize_event(event))
    return event


def emit_timeout(
    tick: int,
    agent_id: str,
    resource_name: str,
) -> dict[str, Any]:
    """Emit when an agent times out waiting for the resource."""
    event = {
        "tick": tick,
        "event": "timeout",
        "agent": agent_id,
        "resource": resource_name,
    }
    logger.warning(_serialize_event(event))
    return event


def emit_budget_exceeded(
    tick: int,
    agent_id: str,
    task: Task,
    current: float,
    limit: float | None,
    action: str,
    resource_name: str,
) -> dict[str, Any]:
    """Emit when a task is rejected or flagged due to budget limits."""
    event = {
        "tick": tick,
        "event": "budget_exceeded",
        "agent": agent_id,
        "task_id": task.task_id,
        "task_cost": task.weight,
        "current_spend": round(current, 4),
        "budget_limit": round(limit, 4) if limit is not None else None,
        "action": action,
        "resource": resource_name,
    }
    logger.warning(_serialize_event(event))
    return event


def emit_error(
    tick: int,
    agent_id: str,
    error: str,
    resource_name: str,
) -> dict[str, Any]:
    """Emit when an agent encounters an error."""
    event = {
        "tick": tick,
        "event": "error",
        "agent": agent_id,
        "error": error,
        "resource": resource_name,
    }
    logger.error(_serialize_event(event))
    return event


def emit_policy_violation(
    tick: int,
    agent_id: str,
    policy_name: str,
    detail: str,
    resource_name: str,
) -> dict[str, Any]:
    """Emit when a policy check rejects a task."""
    event = {
        "tick": tick,
        "event": "policy_violation",
        "agent": agent_id,
        "policy": policy_name,
        "detail": detail,
        "resource": resource_name,
    }
    logger.warning(_serialize_event(event))
    return event


def emit_policy_check(
    tick: int,
    agent_id: str,
    policies_passed: list[str],
    resource_name: str,
) -> dict[str, Any]:
    """Emit after all policies pass for a grant decision."""
    event = {
        "tick": tick,
        "event": "policy_check",
        "agent": agent_id,
        "policies": policies_passed,
        "passed": True,
        "resource": resource_name,
    }
    logger.info(_serialize_event(event))
    return event
