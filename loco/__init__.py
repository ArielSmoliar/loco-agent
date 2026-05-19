"""LOCO-Agent: Load-Conscious Orchestration for Concurrent Operations."""

from loco.task import Task
from loco.agent import Agent
from loco.scheduler import LOCOScheduler, StepResult, OPTIMIZE_FOR_ALPHA
from loco.resource import SharedResource
from loco.async_scheduler import AsyncLOCOScheduler, BackpressureError, ShutdownError
from loco.metrics import jains_fairness

__all__ = [
    "Task",
    "Agent",
    "LOCOScheduler",
    "StepResult",
    "OPTIMIZE_FOR_ALPHA",
    "SharedResource",
    "AsyncLOCOScheduler",
    "BackpressureError",
    "ShutdownError",
    "jains_fairness",
]
__version__ = "0.1.0dev0"
