"""Tests for pretty terminal output formatter."""

import json
import logging

from loco.pretty import PrettyFormatter, install


def test_format_grant():
    fmt = PrettyFormatter()
    record = logging.LogRecord(
        "loco.scheduler", logging.INFO, "", 0,
        json.dumps({
            "event": "grant", "agent": "analyst", "tick": 47,
            "score": 0.82, "dmax": 3, "task_cost": 2.0,
            "queue_depth": 5.0, "utilization": 0.67,
            "agent_cumulative_cost": 10.0, "budget_remaining": 12.5,
        }),
        (), None,
    )
    output = fmt.format(record)
    assert "[GRANT]" in output
    assert "analyst" in output
    assert "score=0.82" in output
    assert "waited=3" in output
    assert "budget=12.5 remaining" in output
    assert "tick 47" in output


def test_format_release():
    fmt = PrettyFormatter()
    record = logging.LogRecord(
        "loco.scheduler", logging.INFO, "", 0,
        json.dumps({
            "event": "release", "agent": "analyst", "tick": 47,
            "task_cost": 2.0, "utilization": 0.33,
        }),
        (), None,
    )
    output = fmt.format(record)
    assert "[RELEASE]" in output
    assert "analyst" in output
    assert "cost=2.0" in output


def test_format_budget_exceeded():
    fmt = PrettyFormatter()
    record = logging.LogRecord(
        "loco.scheduler", logging.WARNING, "", 0,
        json.dumps({
            "event": "budget_exceeded", "agent": "investigator-1",
            "tick": 29, "task_cost": 3.0, "current_spend": 12.0,
            "budget_limit": 12.0, "action": "reject",
        }),
        (), None,
    )
    output = fmt.format(record)
    assert "[BUDGET]" in output
    assert "investigator-1" in output
    assert "spend=12.0" in output
    assert "[reject]" in output


def test_format_enqueue():
    fmt = PrettyFormatter()
    record = logging.LogRecord(
        "loco.scheduler", logging.INFO, "", 0,
        json.dumps({
            "event": "enqueue", "agent": "bot", "tick": 0,
            "task_cost": 1.0, "queue_depth": 3.0,
        }),
        (), None,
    )
    output = fmt.format(record)
    assert "[ENQUEUE]" in output
    assert "bot" in output
    assert "weight=1.0" in output


def test_format_non_json_passthrough():
    fmt = PrettyFormatter()
    record = logging.LogRecord(
        "loco.scheduler", logging.INFO, "", 0,
        "plain text message", (), None,
    )
    output = fmt.format(record)
    assert output == "plain text message"


def test_grant_without_budget():
    fmt = PrettyFormatter()
    record = logging.LogRecord(
        "loco.scheduler", logging.INFO, "", 0,
        json.dumps({
            "event": "grant", "agent": "a", "tick": 1,
            "score": 0.5, "dmax": 0, "task_cost": 1.0,
            "queue_depth": 1.0, "utilization": 1.0,
            "agent_cumulative_cost": 1.0,
        }),
        (), None,
    )
    output = fmt.format(record)
    assert "[GRANT]" in output
    assert "budget=" not in output


def test_install_sets_handler():
    install()
    logger = logging.getLogger("loco.scheduler")
    assert len(logger.handlers) == 1
    assert isinstance(logger.handlers[0].formatter, PrettyFormatter)
    # Cleanup
    logger.handlers.clear()
