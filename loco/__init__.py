"""LOCO-Agent: Load-Conscious Orchestration for Concurrent Operations."""

from loco.adaptive import AdaptiveAlphaTuner
from loco.agent import Agent
from loco.async_scheduler import AcquireHandle, AsyncLOCOScheduler, BackpressureError, ShutdownError
from loco.budget import BudgetExceededError, BudgetManager, BudgetPolicy
from loco.convenience import (
    configure,
    enable_prometheus,
    get_scheduler,
    reset,
    scheduled,
    set_budget,
    wrap,
)
from loco.cost_attribution import CostAttribution
from loco.labels import SecurityLabel
from loco.metrics import SchedulerMetrics, jains_fairness
from loco.outcomes import OutcomeTracker
from loco.plan import Plan, Step
from loco.policy import AccessPolicy, Policy, PolicyEnforcer, PolicyViolationError, RatePolicy
from loco.pretty import auto_install as _auto_install_pretty
from loco.resource import SharedResource
from loco.scheduler import OPTIMIZE_FOR_ALPHA, LOCOScheduler, StepResult
from loco.slo import SLOBudget, SLOState
from loco.task import Task
from loco.tenant import MultiTenantScheduler, TenantCostExceededError, TenantLimitError
from loco.trust import TrustScorer

__all__ = [
    # Core
    "Task",
    "Agent",
    "LOCOScheduler",
    "StepResult",
    "OPTIMIZE_FOR_ALPHA",
    "SharedResource",
    "AsyncLOCOScheduler",
    "AcquireHandle",
    "BackpressureError",
    "ShutdownError",
    "AdaptiveAlphaTuner",
    "jains_fairness",
    "SchedulerMetrics",
    # Budget (v0.2 compat + v0.3 Policy)
    "BudgetManager",
    "BudgetPolicy",
    "BudgetExceededError",
    # Policy engine (v0.3)
    "Policy",
    "PolicyEnforcer",
    "PolicyViolationError",
    "AccessPolicy",
    "RatePolicy",
    # Security labels (v0.3)
    "SecurityLabel",
    # Execution plans (v0.3)
    "Plan",
    "Step",
    # SLO error budgets (v0.3)
    "SLOBudget",
    "SLOState",
    # Convenience API
    "configure",
    "wrap",
    "scheduled",
    "set_budget",
    "get_scheduler",
    "reset",
    "enable_prometheus",
    # Cost attribution (v0.4)
    "CostAttribution",
    # Trust scoring (v0.4)
    "TrustScorer",
    # Multi-tenant isolation (v0.4)
    "MultiTenantScheduler",
    "TenantCostExceededError",
    "TenantLimitError",
    # Token-to-outcome tracking (v0.4)
    "OutcomeTracker",
]
__version__ = "0.4.0"

# Auto-install pretty formatter if LOCO_LOG=pretty
_auto_install_pretty()
