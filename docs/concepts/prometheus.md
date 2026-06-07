---
title: "Prometheus Export"
description: "Export LOCO-Agent metrics to Prometheus and Grafana"
---

# Prometheus Export

LOCO-Agent can expose scheduler metrics as a Prometheus scrape endpoint. This lets you feed live cost, utilization, and fairness data into Grafana dashboards or any Prometheus-compatible monitoring stack.

## Enabling the Exporter

```python
from loco.exporters.prometheus import PrometheusExporter

exporter = PrometheusExporter(scheduler)
exporter.start(port=9090)
```

Or use the convenience API:

```python
import loco
loco.configure(capacity=3)
loco.enable_prometheus(port=9090)
```

Install the optional dependency:

```bash
pip install loco-agent[prometheus]
```

## Available Metrics

The exporter publishes the following gauges and counters:

- **loco_resource_utilization** -- current resource utilization (0.0 to 1.0)
- **loco_holder_count** -- number of agents currently holding a slot
- **loco_waiter_count** -- number of agents waiting for a slot
- **loco_total_cost** -- cumulative cost across all agents
- **loco_agent_cost** -- per-agent cumulative cost (labeled by `agent_id`)
- **loco_task_completed_total** -- total completed tasks
- **loco_slo_violation_rate** -- current SLO violation rate (if SLOBudget is configured)

## Snapshot

Call `exporter.snapshot()` to get a dict of current metric values without scraping the HTTP endpoint. Useful for tests and health checks.

## Grafana Setup

1. Add a Prometheus data source pointing at your scrape target (default `http://localhost:9090`).
2. Import the included dashboard JSON from `examples/grafana-dashboard.json`, or build panels using the metric names above.
3. Set scrape interval to 15s or lower for real-time visibility.

## Stopping

```python
exporter.stop()
```

This shuts down the HTTP server and de-registers all metrics.
