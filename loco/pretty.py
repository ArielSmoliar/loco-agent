"""Pretty terminal formatter for LOCO scheduling events.

Set LOCO_LOG=pretty to see colored, human-readable scheduling decisions
instead of JSON. Uses ANSI escape codes (no external dependencies).

Usage:
    import loco.pretty
    loco.pretty.install()  # or set LOCO_LOG=pretty

Output example:
    [GRANT]   analyst    score=0.82  waited=3  budget=12.50 remaining  (tick 47)
    [RELEASE] analyst    (tick 47)
    [BUDGET]  analyst    spend=12.0 + task=3.0 > limit=12.0 [reject]
"""

from __future__ import annotations

import json
import logging
import os

# ANSI color codes
_RESET = "\033[0m"
_BOLD = "\033[1m"
_DIM = "\033[2m"
_GREEN = "\033[32m"
_YELLOW = "\033[33m"
_RED = "\033[31m"
_CYAN = "\033[36m"
_BLUE = "\033[34m"
_MAGENTA = "\033[35m"


def _format_event(record: logging.LogRecord) -> str:
    """Format a LOCO scheduling JSON log record as colored text."""
    try:
        event = json.loads(record.getMessage())
    except (json.JSONDecodeError, TypeError):
        return record.getMessage()

    event_type = event.get("event", "unknown")
    agent = event.get("agent", "?")
    tick = event.get("tick", "?")

    if event_type == "enqueue":
        cost = event.get("task_cost", 0)
        depth = event.get("queue_depth", 0)
        return (
            f"{_BLUE}[ENQUEUE]{_RESET}  {_BOLD}{agent:<14}{_RESET} "
            f"weight={cost}  queue={depth}  {_DIM}(tick {tick}){_RESET}"
        )

    elif event_type == "grant":
        score = event.get("score", 0)
        dmax = event.get("dmax", 0)
        budget_remaining = event.get("budget_remaining")
        budget_str = (
            f"  budget={budget_remaining:.1f} remaining"
            if budget_remaining is not None else ""
        )
        return (
            f"{_GREEN}[GRANT]{_RESET}    {_BOLD}{agent:<14}{_RESET} "
            f"score={score:.2f}  waited={int(dmax)}{budget_str}  "
            f"{_DIM}(tick {tick}){_RESET}"
        )

    elif event_type == "release":
        cost = event.get("task_cost", 0)
        util = event.get("utilization", 0)
        return (
            f"{_CYAN}[RELEASE]{_RESET}  {_BOLD}{agent:<14}{_RESET} "
            f"cost={cost}  util={util:.0%}  {_DIM}(tick {tick}){_RESET}"
        )

    elif event_type == "budget_exceeded":
        current = event.get("current_spend", 0)
        task_cost = event.get("task_cost", 0)
        limit = event.get("budget_limit", 0)
        action = event.get("action", "?")
        return (
            f"{_RED}[BUDGET]{_RESET}   {_BOLD}{agent:<14}{_RESET} "
            f"spend={current:.1f} + task={task_cost:.1f} > limit={limit:.1f} "
            f"[{action}]  {_DIM}(tick {tick}){_RESET}"
        )

    elif event_type == "timeout":
        return (
            f"{_YELLOW}[TIMEOUT]{_RESET}  {_BOLD}{agent:<14}{_RESET} "
            f"{_DIM}(tick {tick}){_RESET}"
        )

    elif event_type == "error":
        error = event.get("error", "unknown")
        return (
            f"{_RED}[ERROR]{_RESET}    {_BOLD}{agent:<14}{_RESET} "
            f"{error}  {_DIM}(tick {tick}){_RESET}"
        )

    else:
        return record.getMessage()


class PrettyFormatter(logging.Formatter):
    """Logging formatter that renders LOCO events as colored terminal output."""

    def format(self, record: logging.LogRecord) -> str:
        return _format_event(record)


def install() -> None:
    """Install the pretty formatter on the LOCO scheduler logger.

    Replaces the default JSON output with colored, human-readable text.
    Also called automatically when LOCO_LOG=pretty is set.
    """
    logger = logging.getLogger("loco.scheduler")
    logger.setLevel(logging.INFO)

    # Remove existing handlers to avoid double output
    logger.handlers.clear()

    handler = logging.StreamHandler()
    handler.setFormatter(PrettyFormatter())
    logger.addHandler(handler)


def auto_install() -> None:
    """Install pretty formatting if LOCO_LOG=pretty is set in environment."""
    if os.environ.get("LOCO_LOG", "").lower() == "pretty":
        install()


# Auto-install on import if env var is set
auto_install()
