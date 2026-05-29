"""Security labels for LOCO-Agent tasks.

Labels are optional metadata on task inputs/outputs. In v0.3 they are
attached and logged. Flow enforcement (no write-down from confidential
to public) is deferred to v0.5.

Usage:
    from loco.labels import SecurityLabel
    task = Task(task_id="t1", labels={"input": SecurityLabel.CONFIDENTIAL})
"""

from __future__ import annotations

from enum import Enum


class SecurityLabel(str, Enum):
    """Security classification for task data.

    Uses str mixin so labels serialize naturally to JSON in scheduling logs.
    """

    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
