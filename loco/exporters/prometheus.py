"""Prometheus metrics exporter for LOCO-Agent.

Exposes scheduling metrics (queue depth, wait time, utilization, cost,
policy violations) as Prometheus gauges, counters, and histograms.

Requires: pip install prometheus_client

Usage:
    from loco.exporters.prometheus import PrometheusExporter

    exporter = PrometheusExporter(scheduler)
    exporter.start(port=9090)

    # Metrics available at http://localhost:9090/metrics
    # Gauges update automatically from scheduler state on each scrape.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from loco.async_scheduler import AsyncLOCOScheduler

try:
    from prometheus_client import (
        CollectorRegistry,
        Counter,
        Gauge,
        Histogram,
        start_http_server,
    )

    _HAS_PROMETHEUS = True
except ImportError:
    _HAS_PROMETHEUS = False


def _require_prometheus() -> None:
    if not _HAS_PROMETHEUS:
        raise ImportError(
            "prometheus_client is required for the Prometheus exporter. "
            "Install it with: pip install loco-agent[prometheus]"
        )


class _SchedulerCollector:
    """Custom collector that reads live scheduler state on each scrape.

    Instead of pushing metrics on every event (which adds latency to the
    scheduling hot path), this collector pulls current state when Prometheus
    scrapes. Gauges reflect point-in-time values; counters are monotonic.
    """

    def __init__(self, scheduler: AsyncLOCOScheduler, registry: CollectorRegistry) -> None:
        self._scheduler = scheduler
        self._registry = registry

        # -- Gauges (point-in-time state) --
        self.queue_depth = Gauge(
            "loco_agent_queue_depth_weighted",
            "Current weighted queue depth per agent",
            ["agent_id"],
            registry=registry,
        )
        self.resource_utilization = Gauge(
            "loco_agent_resource_utilization_ratio",
            "Current resource utilization (holders / capacity)",
            registry=registry,
        )
        self.resource_holders = Gauge(
            "loco_agent_resource_holders",
            "Number of agents currently holding the resource",
            registry=registry,
        )
        self.resource_waiters = Gauge(
            "loco_agent_resource_waiters",
            "Number of agents waiting for the resource",
            registry=registry,
        )
        self.alpha = Gauge(
            "loco_agent_alpha",
            "Current alpha parameter (0=latency, 0.5=throughput)",
            registry=registry,
        )
        self.logical_tick = Gauge(
            "loco_agent_logical_tick",
            "Current logical tick counter",
            registry=registry,
        )
        self.trust_score = Gauge(
            "loco_agent_trust_score",
            "Current behavioral trust score per agent (0-1000)",
            ["agent_id"],
            registry=registry,
        )

        # -- Counters (monotonic, event-driven) --
        self.tasks_completed = Counter(
            "loco_agent_tasks_completed_total",
            "Total tasks completed per agent",
            ["agent_id"],
            registry=registry,
        )
        self.cost_total = Counter(
            "loco_agent_cost_total",
            "Cumulative task cost (weight units) per agent",
            ["agent_id"],
            registry=registry,
        )
        self.policy_violations = Counter(
            "loco_agent_policy_violations_total",
            "Total policy violations per agent and policy type",
            ["agent_id", "policy"],
            registry=registry,
        )

        # -- Cost attribution counters (v0.4) --
        self.cost_by_team = Counter(
            "loco_agent_cost_by_team_total",
            "Cumulative task cost by team",
            ["team"],
            registry=registry,
        )
        self.cost_by_workflow = Counter(
            "loco_agent_cost_by_workflow_total",
            "Cumulative task cost by workflow",
            ["workflow"],
            registry=registry,
        )
        self.cost_by_model = Counter(
            "loco_agent_cost_by_model_total",
            "Cumulative task cost by model",
            ["model"],
            registry=registry,
        )
        self.cost_attributed = Counter(
            "loco_agent_cost_attributed_total",
            "Cumulative task cost with full attribution",
            ["agent_id", "team", "workflow", "model"],
            registry=registry,
        )

        # -- Histograms (distribution) --
        self.wait_time = Histogram(
            "loco_agent_task_wait_time",
            "Task wait time (age at completion) in logical ticks",
            ["agent_id"],
            buckets=(1, 2, 5, 10, 20, 50, 100, 200, 500),
            registry=registry,
        )
        self.task_cost = Histogram(
            "loco_agent_task_cost",
            "Task cost (weight) distribution per agent",
            ["agent_id"],
            buckets=(0.5, 1, 2, 3, 5, 10, 20, 50),
            registry=registry,
        )

        # Track last-seen completed counts to derive deltas for counters
        self._last_completed: dict[str, int] = {}
        self._last_cost: dict[str, float] = {}

    def update_gauges(self) -> None:
        """Pull current state from scheduler into gauge metrics."""
        scheduler = self._scheduler

        # Queue depth per agent
        for agent_id, depth in scheduler.metrics.queue_depth_by_agent().items():
            self.queue_depth.labels(agent_id=agent_id).set(depth)

        # Resource state
        self.resource_utilization.set(scheduler.metrics.resource_utilization())
        self.resource_holders.set(scheduler.resource.holder_count)
        self.resource_waiters.set(scheduler.resource.waiter_count)

        # Scheduler state
        self.alpha.set(scheduler.alpha)
        self.logical_tick.set(scheduler.logical_tick)

        # Trust scores (if trust scoring is enabled)
        if scheduler.trust_scorer:
            for agent_id in scheduler.agents:
                self.trust_score.labels(agent_id=agent_id).set(
                    scheduler.trust_scorer.score(agent_id)
                )

    def record_task_completion(
        self,
        agent_id: str,
        task_age: float,
        task_weight: float,
        team: str = "__unattributed__",
        workflow: str = "__unattributed__",
        model: str = "__unattributed__",
    ) -> None:
        """Record a task completion event into counters and histograms."""
        self.tasks_completed.labels(agent_id=agent_id).inc()
        self.cost_total.labels(agent_id=agent_id).inc(task_weight)
        self.wait_time.labels(agent_id=agent_id).observe(task_age)
        self.task_cost.labels(agent_id=agent_id).observe(task_weight)

        # Cost attribution counters
        self.cost_by_team.labels(team=team).inc(task_weight)
        self.cost_by_workflow.labels(workflow=workflow).inc(task_weight)
        self.cost_by_model.labels(model=model).inc(task_weight)
        self.cost_attributed.labels(
            agent_id=agent_id, team=team, workflow=workflow, model=model,
        ).inc(task_weight)

    def record_policy_violation(self, agent_id: str, policy_name: str) -> None:
        """Record a policy violation event."""
        self.policy_violations.labels(agent_id=agent_id, policy=policy_name).inc()


class PrometheusExporter:
    """Prometheus metrics exporter for an AsyncLOCOScheduler.

    Hooks into the scheduler's lifecycle callbacks to push event-driven
    metrics (counters, histograms) and exposes a scrape endpoint that
    pulls point-in-time state (gauges).

    Usage:
        scheduler = AsyncLOCOScheduler(agents, resource)
        exporter = PrometheusExporter(scheduler)
        exporter.start(port=9090)

        # ... run scheduler ...

        exporter.stop()
    """

    def __init__(
        self,
        scheduler: AsyncLOCOScheduler,
        *,
        registry: CollectorRegistry | None = None,
    ) -> None:
        _require_prometheus()
        self._scheduler = scheduler
        self._registry = registry or CollectorRegistry()
        self._collector = _SchedulerCollector(scheduler, self._registry)
        self._server_thread: threading.Thread | None = None
        self._started = False

        # Wire into scheduler lifecycle hooks
        self._original_on_completed = scheduler.on_task_completed
        scheduler.on_task_completed = self._on_task_completed

    @property
    def registry(self) -> CollectorRegistry:
        """The Prometheus CollectorRegistry used by this exporter."""
        return self._registry

    @property
    def collector(self) -> _SchedulerCollector:
        """The internal collector for direct metric access (testing)."""
        return self._collector

    def _on_task_completed(self, agent_id: str, task: object, result: object) -> None:
        """Lifecycle hook: record task completion metrics."""
        # Extract fields from task
        task_age = getattr(task, "age", 0)
        task_weight = getattr(task, "weight", 1.0)
        team = getattr(task, "team", None) or "__unattributed__"
        workflow = getattr(task, "workflow", None) or "__unattributed__"
        model = getattr(task, "model", None) or "__unattributed__"
        self._collector.record_task_completion(
            agent_id, task_age, task_weight,
            team=team, workflow=workflow, model=model,
        )
        self._collector.update_gauges()

        # Chain to original hook if present
        if self._original_on_completed:
            self._original_on_completed(agent_id, task, result)

    def record_policy_violation(self, agent_id: str, policy_name: str) -> None:
        """Manually record a policy violation.

        Call this from a PolicyEnforcer exception handler to track violations.
        """
        self._collector.record_policy_violation(agent_id, policy_name)

    def start(self, port: int = 9090, addr: str = "0.0.0.0") -> None:
        """Start the Prometheus HTTP metrics server.

        Args:
            port: Port to serve /metrics on. Default 9090.
            addr: Address to bind to. Default 0.0.0.0.
        """
        if self._started:
            return
        start_http_server(port, addr=addr, registry=self._registry)
        self._started = True

    def stop(self) -> None:
        """Unhook from the scheduler. Does not stop the HTTP server
        (prometheus_client doesn't support clean shutdown of the server).
        """
        self._scheduler.on_task_completed = self._original_on_completed
        self._started = False

    def snapshot(self) -> dict[str, object]:
        """Return a dict snapshot of all current metric values.

        Useful for testing and programmatic access without scraping HTTP.
        """
        self._collector.update_gauges()
        scheduler = self._scheduler
        return {
            "resource_utilization": scheduler.metrics.resource_utilization(),
            "resource_holders": scheduler.resource.holder_count,
            "resource_waiters": scheduler.resource.waiter_count,
            "alpha": scheduler.alpha,
            "logical_tick": scheduler.logical_tick,
            "queue_depth_by_agent": scheduler.metrics.queue_depth_by_agent(),
            "cost_by_agent": scheduler.metrics.cost_by_agent(),
            "completed_by_agent": scheduler.metrics.completed_by_agent(),
        }
