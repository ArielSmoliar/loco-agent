window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'plans-slos-metrics',
  title: 'Plans, SLOs & Metrics',
  topics: [
    {
      id: 'execution-plans',
      title: 'Execution Plans',
      content: '<p><strong>Plans</strong> in <code>loco/plan.py</code> define static execution DAGs (Directed Acyclic Graphs). A Plan is a sequence of Steps with dependencies -- an immutable blueprint for multi-agent workflows.</p>' +
        '<h3>Step and Plan</h3>' +
        '<pre><code>@dataclass\nclass Step:\n    step_id: str                    # Unique ID within the plan\n    agent: str                      # agent_id that executes this step\n    depends_on: list[str] = []      # Step IDs that must finish first\n    weight: float = 1.0             # Cost weight for the task\n    labels: dict | None = None      # Optional security labels\n\n@dataclass\nclass Plan:\n    plan_id: str = field(default_factory=lambda: uuid4().hex[:12])\n    steps: list[Step] = field(default_factory=list)</code></pre>' +
        '<h3>Usage Pattern</h3>' +
        '<pre><code>plan = Plan(steps=[\n    Step("fetch", agent="reader"),\n    Step("analyze", agent="analyst", depends_on=["fetch"]),\n    Step("summarize", agent="analyst", depends_on=["fetch"]),\n    Step("respond", agent="writer", depends_on=["analyze", "summarize"]),\n])\nplan.validate()  # Check for cycles, missing deps, duplicate IDs\n\ncompleted = set()\nwhile not plan.is_complete(completed):\n    for step in plan.ready_steps(completed):\n        # Submit and run step via scheduler\n        completed.add(step.step_id)</code></pre>' +
        '<h3>Validation</h3>' +
        '<p><code>validate()</code> checks three things:</p>' +
        '<ul><li><strong>Duplicate step IDs:</strong> All step_id values must be unique</li><li><strong>Missing dependencies:</strong> Every depends_on entry must reference an existing step</li><li><strong>Cycles:</strong> Uses Kahn\'s algorithm (topological sort) to detect circular dependencies</li></ul>' +
        '<h3>DAG Operations</h3>' +
        '<p><code>topological_sort()</code> returns step IDs in valid execution order. <code>ready_steps(completed)</code> returns steps whose dependencies are all satisfied -- these can run in parallel.</p>' +
        '<p>In the example above, "fetch" runs first. Then "analyze" and "summarize" run in parallel (both depend only on "fetch"). Finally "respond" runs when both are done.</p>' +
        '<p>Plans are currently manually orchestrated (v0.3). Auto-execution via the scheduler is planned for v0.5.</p>',
      summary: 'Plans are immutable DAGs of Steps with dependencies. validate() checks for cycles, missing deps, and duplicates using topological sort. ready_steps() returns parallelizable steps. Currently manually orchestrated, auto-execution planned for v0.5.',
      mentalModel: 'A Plan is like a recipe with parallel steps. "Preheat oven" and "chop vegetables" can happen simultaneously (no dependencies). "Bake casserole" depends on both being done. The plan ensures you never bake before chopping, and helps you find what you can do right now.',
      mistakes: [
        'Forgetting to call validate() -- without it, cycle detection and missing dependency checks do not run, leading to runtime hangs or errors',
        'Creating circular dependencies -- Step A depends on B, B depends on A. validate() catches this with topological sort',
        'Assuming steps run sequentially -- ready_steps() may return MULTIPLE steps that can run in parallel. Only steps with unsatisfied dependencies must wait'
      ],
      exercise: 'Create a Plan with 5 steps forming a diamond pattern: A has no deps, B and C depend on A, D depends on B and C, E depends on D. Call <code>validate()</code>, then <code>topological_sort()</code>, then simulate execution by calling <code>ready_steps()</code> in a loop. Verify B and C are returned together as parallelizable.'
    },
    {
      id: 'slo-error-budgets',
      title: 'SLO Error Budgets',
      content: '<p>The <strong>SLOBudget</strong> in <code>loco/slo.py</code> tracks wait-time SLO violations using a state machine. It is an <strong>observability primitive</strong>, not a scheduling policy -- it monitors after the fact, it does not change scheduling decisions.</p>' +
        '<h3>The State Machine</h3>' +
        '<pre><code>class SLOState(str, Enum):\n    HEALTHY = "healthy"      # Violation rate below warn threshold\n    WARNING = "warning"      # 75%+ of error budget consumed\n    CRITICAL = "critical"    # 90%+ consumed\n    EXHAUSTED = "exhausted"  # 100% -- all observations are violations</code></pre>' +
        '<p>States can improve as well as degrade: CRITICAL -> WARNING -> HEALTHY as violation rate drops.</p>' +
        '<h3>Setup</h3>' +
        '<pre><code>slo = SLOBudget(\n    target_wait=20.0,    # Max acceptable wait (logical ticks)\n    window=100,          # Rolling observation window size\n    warn=0.75,           # WARNING threshold (75% violations)\n    critical=0.90,       # CRITICAL threshold (90%)\n)</code></pre>' +
        '<h3>Recording Observations</h3>' +
        '<pre><code>state = slo.record("agent_a", completed_task)\n# task.age > target_wait? -> violation\n# Returns the new SLOState\n\nif state == SLOState.CRITICAL:\n    alert_oncall("SLO error budget nearly exhausted!")</code></pre>' +
        '<h3>Properties</h3>' +
        '<pre><code>slo.state              # Current state (HEALTHY/WARNING/CRITICAL/EXHAUSTED)\nslo.violation_rate     # Fraction of violations in window [0.0, 1.0]\nslo.budget_remaining   # 1.0 - violation_rate\nslo.total_violations   # All-time count\nslo.total_observations # All-time count</code></pre>' +
        '<p>The rolling window means the SLO can recover: if old violations slide out of the window and new observations are healthy, the state transitions back to HEALTHY.</p>',
      summary: 'SLOBudget monitors wait-time SLO compliance with a state machine (HEALTHY -> WARNING -> CRITICAL -> EXHAUSTED). It tracks violations in a rolling window. It is observability only -- it does not affect scheduling decisions.',
      mentalModel: 'SLOBudget is like a fuel gauge for reliability. Full tank = HEALTHY (no violations). As tasks wait too long, the gauge drops through WARNING and CRITICAL. If every task violates the SLO, the tank hits empty (EXHAUSTED). But it refills as healthy observations push violations out of the rolling window.',
      mistakes: [
        'Trying to use SLOBudget as a scheduling policy -- it is observability only. It monitors post-hoc, it does not change which agent gets served next. Use alpha tuning or policies for that',
        'Forgetting the rolling window -- violation_rate is computed over the last N observations, not all-time. Old violations eventually slide out',
        'Setting target_wait in seconds instead of logical ticks -- SLOBudget uses task.age, which is measured in logical ticks, not wall-clock time'
      ],
      exercise: 'Create an SLOBudget with target_wait=5 and window=20. Record 15 tasks with age below 5 (healthy) then 10 tasks with age above 5 (violations). Check the state transitions. Then record 20 more healthy tasks and verify the state recovers back to HEALTHY as violations exit the window.'
    },
    {
      id: 'adaptive-alpha',
      title: 'Adaptive Alpha Tuning',
      content: '<p>The <strong>AdaptiveAlphaTuner</strong> in <code>loco/adaptive.py</code> automatically adjusts alpha based on observed system behavior. It watches two signals and nudges alpha to maintain fair, efficient scheduling.</p>' +
        '<h3>Two Signals</h3>' +
        '<p><strong>Signal 1: Wait-Time Fairness (CV)</strong></p>' +
        '<p>Computes the coefficient of variation of Dmax values across active agents. High CV means some agents are waiting much longer than others -- unfair scheduling. Response: nudge alpha DOWN (toward latency/fairness).</p>' +
        '<p><strong>Signal 2: Queue Growth Trend</strong></p>' +
        '<p>Compares recent total queue depth to older depth. Growing queues mean the system is overloaded. Response: nudge alpha UP (toward throughput/draining).</p>' +
        '<h3>Configuration</h3>' +
        '<pre><code>tuner = AdaptiveAlphaTuner(\n    scheduler,\n    step_size=0.01,          # How much to nudge per update\n    min_alpha=0.0,           # Floor (never go below)\n    max_alpha=0.5,           # Ceiling (safe range)\n    cv_threshold=0.5,        # CV above this triggers fairness\n    queue_growth_window=10,  # Ticks to measure trend\n)</code></pre>' +
        '<h3>The update() Method</h3>' +
        '<pre><code>def update(self) -> float:\n    cv = self._wait_time_cv()\n    trend = self._queue_trend()\n    current = self.alpha\n\n    # Fairness: high CV -> lower alpha\n    if cv > self.cv_threshold:\n        new_alpha = max(current - self.step_size, self.min_alpha)\n        reason = f"fairness (CV={cv:.2f})"\n\n    # Throughput: growing queues -> higher alpha\n    elif trend > 0.2:  # 20% growth\n        new_alpha = min(current + self.step_size, self.max_alpha)\n        reason = f"throughput (queue_trend={trend:.2f})"\n\n    if new_alpha != current:\n        self.scheduler._scorer.alpha = new_alpha\n        self._adjustments.append((tick, new_alpha, reason))</code></pre>' +
        '<h3>Safety: Clamped to [0.0, 0.5]</h3>' +
        '<p>The tuner never pushes alpha above 0.5 (the starvation threshold) or below 0.0. This is hardcoded safety based on Scenario 2\'s proof that alpha >= 0.75 causes starvation.</p>' +
        '<h3>Enabling</h3>' +
        '<pre><code># Via AsyncLOCOScheduler:\nscheduler = AsyncLOCOScheduler(agents, resource, auto_tune=True)\n\n# Via convenience API:\nloco.configure(capacity=3, auto_tune=True)\n\n# Check adjustment history:\ntuner._adjustments  # [(tick, new_alpha, reason), ...]</code></pre>',
      summary: 'AdaptiveAlphaTuner auto-adjusts alpha based on wait-time fairness (CV) and queue growth trends. High unfairness nudges alpha down; growing queues nudge it up. Alpha is clamped to the safe range [0.0, 0.5]. Enable with auto_tune=True.',
      mentalModel: 'The adaptive tuner is like cruise control on a highway. If cars bunch up unfairly in one lane (high CV), it slows down to let them merge (lower alpha = more fairness). If traffic backs up everywhere (growing queues), it speeds up to clear the jam (higher alpha = more throughput). It never goes above the speed limit (0.5).',
      mistakes: [
        'Setting max_alpha above 0.5 -- this overrides the safety range and risks starvation. The default 0.5 is based on proven starvation thresholds',
        'Expecting instant corrections -- the tuner nudges by step_size (default 0.01) per update. Large corrections take multiple ticks, which provides stability',
        'Using auto_tune with a manually set alpha -- while not an error, understand that the tuner will override your alpha value based on observed conditions'
      ],
      exercise: 'Enable auto_tune=True on an AsyncLOCOScheduler. Run a scenario where one agent gets much more load than others. After the run, inspect <code>tuner._adjustments</code> to see when and why alpha was adjusted. Verify that alpha moved toward lower values (fairness) when wait times diverged.'
    },
    {
      id: 'scheduler-metrics',
      title: 'SchedulerMetrics',
      content: '<p>The <strong>SchedulerMetrics</strong> class in <code>loco/metrics.py</code> provides live visibility into scheduler state. It is auto-created on every AsyncLOCOScheduler as <code>scheduler.metrics</code>.</p>' +
        '<h3>Cost Tracking</h3>' +
        '<pre><code># Per-agent cumulative cost (sum of task weights)\nscheduler.metrics.cost_by_agent()     # {"analyst": 45.0, "chatbot": 12.0}\nscheduler.metrics.total_cost()         # 57.0\nscheduler.metrics.agent_cost("analyst") # 45.0</code></pre>' +
        '<h3>Wait Time Tracking</h3>' +
        '<pre><code># Mean wait time (age at completion) per agent\nscheduler.metrics.wait_time_by_agent()  # {"analyst": 3.2, "chatbot": 1.1}</code></pre>' +
        '<h3>Session Cost Tracking</h3>' +
        '<p>Tag tasks with <code>session_id</code> for per-request cost attribution:</p>' +
        '<pre><code>task = Task(weight=2.0, session_id="req-abc123")\n\n# Later:\nscheduler.metrics.cost_by_session()    # {"req-abc123": 8.0}\nscheduler.metrics.session_cost("req-abc123")  # 8.0</code></pre>' +
        '<h3>Empirical Cost Tracking (EMA)</h3>' +
        '<p>Adapters record actual token usage after each call. Metrics uses Exponential Moving Average (EMA) to refine weight estimates over time:</p>' +
        '<pre><code># After an API call:\nscheduler.metrics.record_actual_tokens(agent_id, task, actual_tokens)\n\n# Get the EMA-adjusted weight for a task type:\nscheduler.metrics.empirical_weight("anthropic:claude-sonnet-4-20250514")\n# Returns the running EMA of actual token usage, or None if no data</code></pre>' +
        '<p>EMA with alpha=0.3 means each new observation carries 30% weight, smoothing out variance while adapting to changing patterns.</p>' +
        '<h3>Resource Utilization</h3>' +
        '<pre><code>scheduler.metrics.resource_utilization()  # 0.67 (2 of 3 slots in use)\nscheduler.metrics.queue_depth_by_agent()  # {"analyst": 5.0, "chatbot": 0.0}\nscheduler.metrics.completed_by_agent()    # {"analyst": 23, "chatbot": 45}</code></pre>',
      summary: 'SchedulerMetrics provides live cost tracking (per-agent, per-session, total), wait time tracking, empirical cost refinement via EMA, and resource utilization. Auto-created on every AsyncLOCOScheduler as scheduler.metrics.',
      mentalModel: 'SchedulerMetrics is like the dashboard of a car. It shows your speed (utilization), fuel consumption (cost), trip distance (session costs), and fuel efficiency over time (EMA weights). You do not steer with the dashboard -- you observe and make decisions based on what it shows.',
      mistakes: [
        'Trying to use metrics for enforcement -- metrics are observability only. Use BudgetPolicy for cost enforcement and SLOBudget for SLO monitoring',
        'Ignoring session_id -- without it, you cannot attribute costs to individual user requests. Set session_id on Tasks for per-request cost tracking',
        'Not calling record_actual_tokens() in custom adapters -- without actual token data, the EMA weight estimates stay at their initial static values'
      ],
      exercise: 'Create an AsyncLOCOScheduler, submit and complete 10 tasks with different weights and session_ids. After each task, print <code>metrics.cost_by_agent()</code>, <code>metrics.wait_time_by_agent()</code>, and <code>metrics.cost_by_session()</code>. Observe how cumulative costs build up over time.'
    },
    {
      id: 'jains-fairness',
      title: 'Jain\'s Fairness Index',
      content: '<p><strong>Jain\'s fairness index</strong> is a standard metric for measuring how fairly a resource is shared. LOCO uses it to validate scheduling fairness across agents.</p>' +
        '<h3>The Formula</h3>' +
        '<pre><code>def jains_fairness(values: list[float]) -> float:\n    """Returns 1.0 when all values are equal (perfect fairness)."""\n    positive = [v for v in values if v > 0]\n    if not positive:\n        return 1.0\n    n = len(positive)\n    total = sum(positive)\n    sum_sq = sum(v * v for v in positive)\n    return (total * total) / (n * sum_sq)</code></pre>' +
        '<h3>Interpreting the Result</h3>' +
        '<ul><li><strong>1.0:</strong> Perfect fairness -- all agents have equal values</li><li><strong>>= 0.98:</strong> Excellent -- LOCO\'s target at alpha=0.25</li><li><strong>0.5 - 0.9:</strong> Moderate unfairness -- some agents are disadvantaged</li><li><strong>1/n:</strong> Worst case -- one agent gets everything</li></ul>' +
        '<h3>What Values to Measure</h3>' +
        '<p>In LOCO, Jain\'s fairness is typically computed on <strong>mean wait times</strong> across agents. If all agents wait about the same on average, fairness is high. If some agents wait much longer, fairness is low.</p>' +
        '<pre><code># Using SyncTestScheduler:\nfrom loco.testing import SyncTestScheduler, mock_agent\n\nagents = [mock_agent(f"agent-{i}", pending_tasks=50) for i in range(10)]\nscheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)\nresult = scheduler.run_all()\n\nfairness = scheduler.jains_fairness()\nprint(f"Jain\'s fairness: {fairness:.4f}")  # Should be >= 0.98</code></pre>' +
        '<h3>The Starvation Proof</h3>' +
        '<p>Scenario 2 (fairness.py) uses Jain\'s index to prove the alpha threshold:</p>' +
        '<ul><li>alpha=0.0: fairness ~ 1.0 (perfect, all agents wait equally)</li><li>alpha=0.25: fairness >= 0.98 (excellent, slight throughput benefit)</li><li>alpha=0.5: fairness >= 0.95 (still good)</li><li>alpha=0.75: fairness drops below 0.90 (some agents starving)</li><li>alpha=1.0: fairness ~ 1/n (complete starvation for some agents)</li></ul>',
      summary: 'Jain\'s fairness index measures equality of resource sharing. Returns 1.0 for perfect fairness, 1/n for worst case. LOCO uses it on mean wait times to validate scheduling fairness. At alpha=0.25, Jain\'s index >= 0.98.',
      mentalModel: 'Jain\'s fairness index is like measuring how evenly you sliced a pizza. If everyone gets the same size slice, the score is 1.0 (perfect). If one person gets half the pizza and nine others share the rest, the score drops toward 0.1. It answers: "How equal is the distribution?"',
      mistakes: [
        'Computing Jain\'s index on raw task counts instead of wait times -- the relevant metric for scheduling fairness is how long each agent waited, not how many tasks it processed',
        'Ignoring zero values -- the function filters out zero and negative values before computing. An agent with zero wait time (never waited) is excluded',
        'Using Jain\'s fairness as a scheduling signal -- it is a validation metric for AFTER a run, not a signal to act on DURING scheduling. Use the AdaptiveAlphaTuner\'s CV for live fairness adjustment'
      ],
      exercise: 'Compute Jain\'s fairness by hand for these wait times: [5, 5, 5, 5] (should be 1.0), [1, 1, 1, 100] (should be much lower), and [10, 20, 30] (somewhere in between). Then verify your answers against <code>jains_fairness()</code> from <code>loco.metrics</code>.'
    }
  ]
});
