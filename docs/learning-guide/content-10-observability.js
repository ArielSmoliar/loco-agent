window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'observability-v04',
  title: 'Observability & Enterprise (v0.4)',
  topics: [
    {
      id: 'prometheus-export',
      title: 'Prometheus Export',
      content: '<p>The <strong>PrometheusExporter</strong> in <code>loco/exporters/prometheus.py</code> exposes scheduling metrics in Prometheus exposition format. It hooks into the scheduler\'s lifecycle to push event-driven metrics (counters, histograms) and pulls point-in-time state (gauges) on each scrape.</p>' +
        '<h3>Metric Types</h3>' +
        '<p>LOCO exports three types of Prometheus metrics:</p>' +
        '<ul>' +
        '<li><strong>Gauges</strong> -- point-in-time values that go up and down: queue depth, resource utilization, alpha, trust scores, logical tick</li>' +
        '<li><strong>Counters</strong> -- monotonically increasing totals: tasks completed, cumulative cost (per agent, per team, per workflow, per model), policy violations</li>' +
        '<li><strong>Histograms</strong> -- distribution of values with configurable buckets: task wait time, task cost</li>' +
        '</ul>' +
        '<h3>Setup</h3>' +
        '<pre><code>from loco.exporters.prometheus import PrometheusExporter\n\nexporter = PrometheusExporter(scheduler)\nexporter.start(port=9090)\n\n# Metrics available at http://localhost:9090/metrics</code></pre>' +
        '<h3>Custom Registry</h3>' +
        '<p>For testing or running multiple exporters, pass a custom <code>CollectorRegistry</code>:</p>' +
        '<pre><code>from prometheus_client import CollectorRegistry\n\nregistry = CollectorRegistry()\nexporter = PrometheusExporter(scheduler, registry=registry)</code></pre>' +
        '<h3>Convenience API</h3>' +
        '<p>The <code>enable_prometheus()</code> convenience function creates an exporter for the global scheduler:</p>' +
        '<pre><code>import loco\n\nloco.configure(capacity=3)\nloco.enable_prometheus(port=9090)\n# Metrics now available at http://localhost:9090/metrics</code></pre>' +
        '<h3>Key Metrics</h3>' +
        '<pre><code># Gauges\nloco_agent_queue_depth_weighted{agent_id="analyst"}    # current queue depth\nloco_agent_resource_utilization_ratio                  # holders / capacity\nloco_agent_alpha                                       # current alpha value\nloco_agent_trust_score{agent_id="analyst"}             # trust score (0-1000)\n\n# Counters\nloco_agent_tasks_completed_total{agent_id="analyst"}   # total tasks done\nloco_agent_cost_total{agent_id="analyst"}              # cumulative cost\nloco_agent_cost_by_team_total{team="marketing"}        # cost by team\nloco_agent_policy_violations_total{agent_id, policy}   # violations\n\n# Histograms\nloco_agent_task_wait_time{agent_id="analyst"}          # wait time distribution\nloco_agent_task_cost{agent_id="analyst"}               # cost distribution</code></pre>' +
        '<h3>Programmatic Access</h3>' +
        '<p>Use <code>exporter.snapshot()</code> to get a dict of current metric values without scraping HTTP. Useful for testing and programmatic dashboards:</p>' +
        '<pre><code>snap = exporter.snapshot()\nprint(snap["resource_utilization"])  # 0.67\nprint(snap["cost_by_agent"])         # {"analyst": 45.0}</code></pre>',
      summary: 'PrometheusExporter hooks into the scheduler to expose metrics in Prometheus format. Gauges show point-in-time state (queue depth, utilization, alpha). Counters track monotonic totals (tasks completed, cost, violations). Histograms capture distributions (wait time, task cost). Use a custom CollectorRegistry for test isolation.',
      mentalModel: 'The Prometheus exporter is like a building\'s sensor network. Gauges are thermometers showing current temperature (queue depth, utilization). Counters are odometers tracking cumulative distance (total cost, completed tasks). Histograms are traffic speed surveys recording the distribution of speeds (wait time buckets). Prometheus scrapes all sensors on a schedule, and Grafana turns the readings into dashboards.',
      mistakes: [
        'Forgetting to install prometheus_client -- the exporter requires it. Install with pip install loco-agent[prometheus] or pip install prometheus_client',
        'Using the default registry in tests -- multiple test cases registering the same metric name will collide. Always pass a fresh CollectorRegistry() for test isolation',
        'Scraping HTTP in unit tests instead of using exporter.snapshot() or reading the collector directly -- snapshot() gives you a dict without starting an HTTP server'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Verify prometheus_client is installed.</strong><br>' +
        '<pre><code>try:\n    import prometheus_client\n    print(f"prometheus_client version: {prometheus_client.__version__}")\nexcept ImportError:\n    print("Not installed. Run: pip install prometheus_client")</code></pre>' +
        'If not installed, exit and run <code>pip install prometheus_client</code> first.<br><br>' +
        '<strong>Step 3 -- Create a scheduler and attach a PrometheusExporter with a custom registry.</strong><br>' +
        '<pre><code>import asyncio\nfrom prometheus_client import CollectorRegistry\nfrom loco import Agent, AsyncLOCOScheduler, SharedResource, Task\nfrom loco.exporters.prometheus import PrometheusExporter\n\nasync def test_prometheus():\n    agents = [Agent(agent_id="analyst"), Agent(agent_id="chatbot")]\n    resource = SharedResource(name="api", capacity=2)\n    scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")\n\n    # Use a custom registry for test isolation\n    registry = CollectorRegistry()\n    exporter = PrometheusExporter(scheduler, registry=registry)\n    print("Exporter attached with custom registry")\n\n    # Submit and process tasks\n    tasks = [\n        ("analyst", Task(weight=5.0, team="marketing", model="opus")),\n        ("analyst", Task(weight=2.0, team="eng", model="sonnet")),\n        ("chatbot", Task(weight=1.0, team="marketing", model="haiku")),\n    ]\n    for agent_id, task in tasks:\n        await scheduler.submit_task(agent_id, task)\n        async with scheduler.acquire(agent_id):\n            scheduler.get_agent(agent_id).serve_oldest_task()\n\n    # Get a programmatic snapshot\n    snap = exporter.snapshot()\n    print(f"\\nResource utilization: {snap[\'resource_utilization\']}")\n    print(f"Cost by agent: {snap[\'cost_by_agent\']}")\n    print(f"Completed by agent: {snap[\'completed_by_agent\']}")\n    print(f"Alpha: {snap[\'alpha\']}")\n\n    # Read counter values directly from the collector\n    collector = exporter.collector\n    analyst_cost = collector.cost_total.labels(agent_id="analyst")._value.get()\n    print(f"\\nPrometheus counter -- analyst cost: {analyst_cost}")\n\n    team_cost = collector.cost_by_team.labels(team="marketing")._value.get()\n    print(f"Prometheus counter -- marketing team cost: {team_cost}")\n\nasyncio.run(test_prometheus())</code></pre>' +
        '<strong>Step 4 -- Read the output.</strong> Look for:<br>' +
        '<ul>' +
        '<li><strong>Cost by agent:</strong> analyst should show 7.0 (5+2), chatbot should show 1.0.</li>' +
        '<li><strong>Prometheus counters:</strong> analyst cost = 7.0 from the counter, marketing team cost = 6.0 (5.0 from analyst + 1.0 from chatbot).</li>' +
        '<li><strong>Utilization:</strong> 0.0 after all tasks complete (no slots held).</li>' +
        '</ul>' +
        '<strong>Step 5 -- Understand the pull vs push model.</strong> Gauges are updated on each scrape (pull). Counters and histograms are updated on each task completion event (push). This keeps the scheduling hot path fast -- gauges do not add latency to task dispatch.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'cost-attribution',
      title: 'Cost Attribution',
      content: '<p>The <strong>CostAttribution</strong> class in <code>loco/cost_attribution.py</code> aggregates scheduling costs across multiple dimensions: team, workflow, model, and agent. It answers the question "where are my tokens going?"</p>' +
        '<h3>Task Fields for Attribution</h3>' +
        '<p>Tasks carry three optional attribution fields:</p>' +
        '<pre><code>task = Task(\n    weight=5.0,\n    team="marketing",           # Which team owns this work\n    workflow="weekly-report",    # Which workflow triggered it\n    model="claude-opus-4",      # Which model will execute it\n)</code></pre>' +
        '<p>If a field is not set, the cost is recorded under <code>"__unattributed__"</code>.</p>' +
        '<h3>Recording Costs</h3>' +
        '<pre><code>attribution = CostAttribution()\n\n# Called on each grant event (or manually)\nattribution.record(agent_id="analyst", task=task)</code></pre>' +
        '<h3>Single-Dimension Queries</h3>' +
        '<pre><code>attribution.cost_by_team()       # {"marketing": 47.5, "eng": 23.1}\nattribution.cost_by_workflow()   # {"weekly-report": 31.2, "etl": 39.4}\nattribution.cost_by_model()      # {"claude-opus-4": 68.0, "haiku": 2.6}\nattribution.cost_by_agent()      # {"analyst": 45.0, "chatbot": 25.6}\nattribution.total_cost()         # 70.6</code></pre>' +
        '<h3>Two-Dimension Breakdowns</h3>' +
        '<p><code>team_breakdown()</code> drills into a single team across sub-dimensions:</p>' +
        '<pre><code>attribution.team_breakdown("marketing")\n# {\n#   "by_agent": {"analyst": 30.0, "chatbot": 17.5},\n#   "by_model": {"opus": 30.0, "haiku": 17.5},\n#   "by_workflow": {"weekly-report": 47.5},\n#   "total": 47.5\n# }</code></pre>' +
        '<h3>Top Costs</h3>' +
        '<p><code>top_costs()</code> returns the N highest-cost contributors for any dimension:</p>' +
        '<pre><code>attribution.top_costs(dimension="team", n=3)\n# [("marketing", 47.5), ("eng", 23.1)]\n\nattribution.top_costs(dimension="model", n=2)\n# [("opus", 68.0), ("haiku", 2.6)]</code></pre>' +
        '<h3>Full Summary</h3>' +
        '<pre><code>attribution.summary()\n# {"total_cost": 70.6, "record_count": 15,\n#  "by_team": {...}, "by_workflow": {...},\n#  "by_model": {...}, "by_agent": {...}}</code></pre>',
      summary: 'CostAttribution aggregates task costs across team, workflow, model, and agent dimensions. Tasks carry optional team/workflow/model fields. Single-dimension queries give totals per dimension. team_breakdown() and workflow_breakdown() provide two-dimensional cross-cuts. top_costs() ranks contributors by spend.',
      mentalModel: 'Cost attribution is like a corporate expense report system. Every expense (task) is tagged with department (team), project (workflow), and vendor (model). The finance team can ask "how much did marketing spend?" (cost_by_team), "which vendor costs the most?" (cost_by_model), or "break down marketing\'s spend by vendor" (team_breakdown). The tags travel with the expense, not with the person who submitted it.',
      mistakes: [
        'Forgetting to set team/workflow/model on Tasks -- without these fields, all costs land under "__unattributed__" and breakdowns are useless. Set attribution fields at task creation time',
        'Confusing cost_by_agent() from CostAttribution with cost_by_agent() from SchedulerMetrics -- both exist but CostAttribution tracks only tasks passed through record(), while SchedulerMetrics tracks all completed tasks. Use CostAttribution for multi-dimensional analysis',
        'Calling team_breakdown() with a team name that has no records -- it returns empty dicts, not an error. Always check total_cost() or cost_by_team() first to verify data exists'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create a CostAttribution instance and record tasks.</strong><br>' +
        '<pre><code>from loco import CostAttribution, Task\n\nattribution = CostAttribution()\n\n# Marketing team tasks\nfor i in range(5):\n    task = Task(weight=5.0, team="marketing", workflow="weekly-report", model="opus")\n    attribution.record("analyst", task)\n\nfor i in range(3):\n    task = Task(weight=1.0, team="marketing", workflow="social-posts", model="haiku")\n    attribution.record("chatbot", task)\n\n# Engineering team tasks\nfor i in range(4):\n    task = Task(weight=2.0, team="eng", workflow="code-review", model="sonnet")\n    attribution.record("reviewer", task)\n\nprint(f"Total cost: {attribution.total_cost()}")</code></pre>' +
        'Total should be 36.0: marketing = 5*5 + 3*1 = 28, eng = 4*2 = 8.<br><br>' +
        '<strong>Step 3 -- Query single-dimension breakdowns.</strong><br>' +
        '<pre><code>print("Cost by team:    ", attribution.cost_by_team())\nprint("Cost by workflow:", attribution.cost_by_workflow())\nprint("Cost by model:   ", attribution.cost_by_model())\nprint("Cost by agent:   ", attribution.cost_by_agent())</code></pre>' +
        'Each dimension slices the same data differently. Marketing = 28.0, eng = 8.0. By model: opus = 25.0, haiku = 3.0, sonnet = 8.0.<br><br>' +
        '<strong>Step 4 -- Drill into a team.</strong><br>' +
        '<pre><code>breakdown = attribution.team_breakdown("marketing")\nprint("Marketing breakdown:")\nfor key, value in breakdown.items():\n    print(f"  {key}: {value}")</code></pre>' +
        'This shows marketing\'s spend broken down by agent, by model, and by workflow. You can see that the analyst account (opus model, weekly-report workflow) drives most of marketing\'s cost.<br><br>' +
        '<strong>Step 5 -- Find top cost contributors.</strong><br>' +
        '<pre><code>print("\\nTop teams by cost:", attribution.top_costs(dimension="team", n=3))\nprint("Top models by cost:", attribution.top_costs(dimension="model", n=3))\nprint("Top agents by cost:", attribution.top_costs(dimension="agent", n=3))</code></pre>' +
        'top_costs() returns sorted (name, cost) tuples. Useful for dashboards and alerting.<br><br>' +
        '<strong>Step 6 -- Check the full summary.</strong><br>' +
        '<pre><code>import json\nprint(json.dumps(attribution.summary(), indent=2))</code></pre>' +
        'The summary is JSON-serializable, ready for dashboard display or API responses.<br><br>' +
        '<strong>Step 7 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'trust-scoring',
      title: 'Trust Scoring',
      content: '<p>The <strong>TrustScorer</strong> in <code>loco/trust.py</code> maintains a behavioral trust score per agent (0-1000). Fast, reliable agents earn higher scores and get scheduling priority. Timeout-prone or error-heavy agents get deprioritized.</p>' +
        '<h3>Score Range and Signals</h3>' +
        '<p>Scores range from 0 (untrusted) to 1000 (highly trusted). The default score for a new agent is 500 (neutral). Three signal types affect the score:</p>' +
        '<ul>' +
        '<li><strong>Success:</strong> +15 points (plus a +10 fast bonus if task completed well under SLO target)</li>' +
        '<li><strong>Error:</strong> -50 points</li>' +
        '<li><strong>Timeout:</strong> -80 points (worst penalty -- timeouts waste a resource slot)</li>' +
        '</ul>' +
        '<p>If a successful task still violated the SLO target (waited too long), -25 is applied on top of the success reward, making it a net -10.</p>' +
        '<h3>Time Decay</h3>' +
        '<p>Scores decay toward the baseline (500) over time using exponential decay with a configurable half-life (default: 1 hour). This means agents can recover from temporary issues -- a bad hour does not permanently damage an agent\'s reputation.</p>' +
        '<pre><code># Score drifts toward 500 over time:\n# After 1 half-life:  halfway back to 500\n# After 2 half-lives: 75% back to 500\n# After 3 half-lives: 87.5% back to 500</code></pre>' +
        '<h3>Usage</h3>' +
        '<pre><code>scorer = TrustScorer(slo_target=20.0)\n\n# Record events\nscorer.record_success("agent_a", wait_ticks=3)   # fast success: +25\nscorer.record_success("agent_a", wait_ticks=25)  # SLO violation: -10\nscorer.record_error("agent_b")                   # error: -50\nscorer.record_timeout("agent_b")                 # timeout: -80\n\n# Query scores\nscorer.score("agent_a")          # Current score (0-1000)\nscorer.scores()                  # All agents: {"agent_a": 515, ...}\nscorer.stats("agent_a")          # Detailed stats dict</code></pre>' +
        '<h3>Priority Multiplier</h3>' +
        '<p>The <code>priority_multiplier()</code> method maps trust score to a scheduling weight:</p>' +
        '<pre><code># Linear mapping: score -> multiplier\n# 1000 -> 1.2  (20% priority boost)\n# 500  -> 1.0  (neutral)\n# 0    -> 0.8  (20% priority reduction)\n\nmultiplier = scorer.priority_multiplier("agent_a")\n# Use: adjusted_load = load_score * multiplier</code></pre>' +
        '<h3>Integration with Scheduler</h3>' +
        '<pre><code>scheduler = AsyncLOCOScheduler(\n    agents, resource,\n    trust_scorer=scorer,  # Wire into scheduler\n)\n\n# The scheduler uses trust scores to adjust priority.\n# The Prometheus exporter also exports trust scores as gauges.</code></pre>',
      summary: 'TrustScorer maintains a 0-1000 behavioral score per agent. Success rewards (+15), errors penalize (-50), timeouts penalize harder (-80). Scores decay toward the 500 baseline over time, allowing recovery. priority_multiplier() maps score to a 0.8-1.2 scheduling weight for load score adjustment.',
      mentalModel: 'Trust scoring is like a credit score for agents. A new agent starts at 500 (neutral). Reliable behavior (on-time payments) raises the score; errors and timeouts (missed payments) drop it. The score decays toward neutral over time, so a single bad incident does not permanently blacklist an agent. High-score agents get better terms (priority boost), low-score agents face restrictions (priority reduction).',
      mistakes: [
        'Forgetting that scores decay toward 500 over time -- in interactive testing, even a few seconds between REPL commands can cause small score drift. Disable decay with decay_half_life=None for deterministic testing',
        'Expecting priority_multiplier to dramatically change scheduling -- the range is 0.8 to 1.2, a subtle 20% adjustment. It nudges, it does not override. Large trust differences require many events to accumulate',
        'Not calling record_success with wait_ticks -- without wait_ticks, the fast bonus (+10 for completing under half the SLO target) is always applied, which inflates trust scores for agents that are actually slow'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create a TrustScorer with decay disabled for deterministic results.</strong><br>' +
        '<pre><code>from loco import TrustScorer\n\nscorer = TrustScorer(slo_target=10.0, decay_half_life=None)\n\n# New agents start at 500\nprint(f"Unknown agent score: {scorer.score(\'new_agent\')}")\nprint(f"Priority multiplier at 500: {scorer.priority_multiplier(\'new_agent\'):.2f}")</code></pre>' +
        'Unknown agents return 500 (default). Priority multiplier at 500 is 1.0 (neutral).<br><br>' +
        '<strong>Step 3 -- Record successes and watch the score climb.</strong><br>' +
        '<pre><code># Fast completions (well under SLO target of 10)\nfor i in range(10):\n    score = scorer.record_success("reliable", wait_ticks=2)\nprint(f"After 10 fast successes: {scorer.score(\'reliable\')}")\nprint(f"Priority multiplier: {scorer.priority_multiplier(\'reliable\'):.3f}")</code></pre>' +
        'Each fast success adds +25 (15 base + 10 fast bonus). After 10: 500 + 250 = 750. Priority multiplier at 750 is 1.1 (10% boost).<br><br>' +
        '<strong>Step 4 -- Record errors and timeouts to see penalties.</strong><br>' +
        '<pre><code># Agent with errors\nscorer.record_error("flaky")\nscorer.record_error("flaky")\nprint(f"After 2 errors: {scorer.score(\'flaky\')}")\n\n# Agent with timeouts (worse than errors)\nscorer.record_timeout("slow")\nprint(f"After 1 timeout: {scorer.score(\'slow\')}")\n\n# Compare priority multipliers\nprint(f"\\nPriority multipliers:")\nfor agent_id in ["reliable", "flaky", "slow"]:\n    m = scorer.priority_multiplier(agent_id)\n    s = scorer.score(agent_id)\n    print(f"  {agent_id}: score={s}, multiplier={m:.3f}")</code></pre>' +
        'Errors cost -50 each: flaky = 500 - 100 = 400. Timeouts cost -80: slow = 500 - 80 = 420. Reliable\'s multiplier should be highest, flaky\'s and slow\'s should be below 1.0.<br><br>' +
        '<strong>Step 5 -- Check detailed stats.</strong><br>' +
        '<pre><code>import json\nfor agent_id in ["reliable", "flaky", "slow"]:\n    stats = scorer.stats(agent_id)\n    print(f"\\n{agent_id}:")\n    print(json.dumps(stats, indent=2))</code></pre>' +
        'Stats show success_rate, error_rate, and total counts for each signal type. The reliable agent should have 100% success rate; flaky and slow should have 0%.<br><br>' +
        '<strong>Step 6 -- Verify the multiplier range is bounded.</strong><br>' +
        '<pre><code># Push scores to extremes\nfor i in range(50):\n    scorer.record_success("hero", wait_ticks=1)\nfor i in range(20):\n    scorer.record_timeout("villain")\n\nprint(f"Hero score: {scorer.score(\'hero\')}, multiplier: {scorer.priority_multiplier(\'hero\'):.3f}")\nprint(f"Villain score: {scorer.score(\'villain\')}, multiplier: {scorer.priority_multiplier(\'villain\'):.3f}")\nprint("\\nMultiplier range is always 0.8 to 1.2 -- it nudges, never overrides")</code></pre>' +
        'Even at extreme scores (0 or 1000), the multiplier stays within [0.8, 1.2]. This prevents trust scoring from completely overriding the load function.<br><br>' +
        '<strong>Step 7 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'multi-tenant-isolation',
      title: 'Multi-Tenant Isolation',
      content: '<p>The <strong>MultiTenantScheduler</strong> in <code>loco/tenant.py</code> partitions agents into tenant-scoped scheduling domains. Each tenant gets its own agent pool, independent cost tracking, and cost ceiling enforcement. One tenant\'s burst cannot starve another tenant\'s agents.</p>' +
        '<h3>Tenant Registration</h3>' +
        '<pre><code>from loco import MultiTenantScheduler, SharedResource\n\nmt = MultiTenantScheduler(\n    resource=SharedResource("llm_api", capacity=10),\n    optimize_for="balanced",\n)\n\nmt.register_tenant("acme", max_agents=20, cost_ceiling=500.0)\nmt.register_tenant("globex", max_agents=10, cost_ceiling=200.0)</code></pre>' +
        '<h3>Agent Assignment</h3>' +
        '<p>Each agent belongs to exactly one tenant. Agents are registered under their tenant and cannot be shared:</p>' +
        '<pre><code>from loco import Agent\n\nmt.register_agent("acme", Agent(agent_id="acme_analyst"))\nmt.register_agent("acme", Agent(agent_id="acme_chatbot"))\nmt.register_agent("globex", Agent(agent_id="globex_writer"))</code></pre>' +
        '<h3>Cost Ceilings</h3>' +
        '<p>When a tenant has a <code>cost_ceiling</code>, the scheduler enforces it on each <code>submit_task()</code> call. The check includes spent cost + pending queue cost + new task weight:</p>' +
        '<pre><code>projected = tenant.total_cost + pending_cost + task.weight\nif projected > cost_ceiling:\n    raise TenantCostExceededError(...)</code></pre>' +
        '<h3>Task Submission and Acquisition</h3>' +
        '<pre><code>await mt.submit_task("acme", "acme_analyst", task)\n\nasync with mt.acquire("acme", "acme_analyst"):\n    await do_work()\n\n# Cost is recorded on acquire, not on submit</code></pre>' +
        '<h3>Querying Tenant State</h3>' +
        '<pre><code>mt.tenant_cost("acme")          # Cumulative cost spent\nmt.tenant_remaining("acme")     # Remaining budget (ceiling - spent)\nmt.tenant_stats("acme")         # Full stats dict\nmt.all_tenants()                # Stats for every tenant\nmt.agent_tenant("acme_analyst") # "acme" -- reverse lookup</code></pre>' +
        '<h3>Error Types</h3>' +
        '<ul>' +
        '<li><strong>TenantCostExceededError:</strong> Raised when submit_task would exceed the tenant\'s cost ceiling</li>' +
        '<li><strong>TenantLimitError:</strong> Raised when registering an agent would exceed the tenant\'s max_agents</li>' +
        '<li><strong>ValueError:</strong> Raised for unknown tenants, duplicate registrations, or unregistered agents</li>' +
        '</ul>',
      summary: 'MultiTenantScheduler partitions agents into tenant-scoped domains with independent cost tracking and ceiling enforcement. Each agent belongs to exactly one tenant. Cost ceilings are enforced on submit_task(), including pending queue costs. TenantCostExceededError is raised when a ceiling would be breached.',
      mentalModel: 'Multi-tenant scheduling is like a shared office building with metered utilities. Each tenant (company) has their own suite (agent pool) with their own electricity meter (cost tracking). The building has a shared generator (resource). Each tenant has a power budget (cost ceiling). If a tenant hits their budget, their new equipment requests are rejected (TenantCostExceededError) -- but other tenants are unaffected.',
      mistakes: [
        'Forgetting that cost ceiling checks include pending queue cost -- even if total_cost is below the ceiling, enough queued tasks can trigger TenantCostExceededError on the next submit_task()',
        'Trying to register the same agent under two tenants -- each agent belongs to exactly one tenant. Attempting to re-register raises ValueError',
        'Setting cost_ceiling=None and expecting enforcement -- None means unlimited. The tenant can spend without limit. Always set an explicit ceiling for production tenants'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create a multi-tenant scheduler with two tenants.</strong><br>' +
        '<pre><code>from loco import Agent, MultiTenantScheduler, SharedResource, Task\nfrom loco.tenant import TenantCostExceededError\n\nmt = MultiTenantScheduler(\n    resource=SharedResource("llm_api", capacity=5),\n)\n\n# Acme: generous budget\nmt.register_tenant("acme", max_agents=10, cost_ceiling=50.0)\n# Globex: tight budget\nmt.register_tenant("globex", max_agents=5, cost_ceiling=15.0)\n\nprint(f"Tenants: {mt.tenant_ids}")</code></pre>' +
        '<strong>Step 3 -- Register agents under each tenant.</strong><br>' +
        '<pre><code>mt.register_agent("acme", Agent(agent_id="acme_analyst"))\nmt.register_agent("acme", Agent(agent_id="acme_chatbot"))\nmt.register_agent("globex", Agent(agent_id="globex_writer"))\n\n# Verify reverse lookup\nprint(f"acme_analyst belongs to: {mt.agent_tenant(\'acme_analyst\')}")\nprint(f"globex_writer belongs to: {mt.agent_tenant(\'globex_writer\')}")</code></pre>' +
        '<strong>Step 4 -- Submit tasks and check cost tracking.</strong><br>' +
        '<pre><code>import asyncio\n\nasync def test_costs():\n    # Submit several tasks to acme\n    for i in range(5):\n        task = Task(weight=3.0)\n        await mt.submit_task("acme", "acme_analyst", task)\n\n    # Check cost BEFORE acquiring (cost is recorded on acquire, not submit)\n    print(f"Acme cost after submit: {mt.tenant_cost(\'acme\')}")\n    print(f"Acme remaining: {mt.tenant_remaining(\'acme\')}")\n\n    # But the ceiling check on submit includes pending queue cost!\n    # acme has 5 pending tasks * 3.0 = 15.0 pending\n    # total_cost (0) + pending (15) + new task (3) = 18.0 < 50.0 ceiling\n    # So we can submit more\n    await mt.submit_task("acme", "acme_analyst", Task(weight=3.0))\n    print(f"6th task submitted (projected cost still under ceiling)")\n\nasyncio.run(test_costs())</code></pre>' +
        'Cost is 0.0 after submit because cost is recorded on acquire. But the ceiling check still accounts for pending queue cost.<br><br>' +
        '<strong>Step 5 -- Trigger a cost ceiling violation.</strong><br>' +
        '<pre><code>async def test_ceiling():\n    # Globex has a 15.0 ceiling\n    # Submit tasks until we exceed it\n    for i in range(5):\n        task = Task(weight=3.0)\n        await mt.submit_task("globex", "globex_writer", task)\n        print(f"  Submitted task {i+1}, pending cost = {(i+1) * 3.0}")\n\n    # Now try one more -- pending = 15.0, new = 3.0, projected = 18.0 > 15.0\n    try:\n        await mt.submit_task("globex", "globex_writer", Task(weight=3.0))\n    except TenantCostExceededError as e:\n        print(f"\\nCeiling enforced: {e}")\n\n    # Acme is unaffected by globex hitting its ceiling\n    await mt.submit_task("acme", "acme_chatbot", Task(weight=5.0))\n    print("Acme can still submit -- tenant isolation works")\n\nasyncio.run(test_ceiling())</code></pre>' +
        'The 6th task for globex is rejected because pending cost (15.0) + new task (3.0) exceeds the 15.0 ceiling. Acme is completely unaffected -- each tenant\'s budget is independent.<br><br>' +
        '<strong>Step 6 -- Inspect tenant stats.</strong><br>' +
        '<pre><code>import json\nfor tenant_id in mt.tenant_ids:\n    stats = mt.tenant_stats(tenant_id)\n    print(f"\\n{tenant_id}:")\n    print(json.dumps(stats, indent=2, default=str))</code></pre>' +
        'Stats show agent_count, total_cost, cost_ceiling, cost_remaining, and tasks_completed for each tenant.<br><br>' +
        '<strong>Step 7 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'token-to-outcome',
      title: 'Token-to-Outcome Tracking',
      content: '<p>The <strong>OutcomeTracker</strong> in <code>loco/outcomes.py</code> links token spend to task outcomes. Decision traces capture <em>why</em> a decision was made; token-to-outcome attribution captures <em>was it worth it</em>. It closes the ROI loop that cost tracking alone cannot answer.</p>' +
        '<h3>Recording Outcomes</h3>' +
        '<pre><code>tracker = OutcomeTracker()\n\n# After a task completes, record the outcome\ntracker.record(\n    agent_id="analyst",\n    task=task,                  # Task object (reads weight, age, team, workflow, model)\n    outcome="success",          # or "failure", "partial", "timeout"\n    quality_score=0.92,         # optional 0.0-1.0 quality metric\n)</code></pre>' +
        '<p>The tracker reads <code>task.weight</code>, <code>task.age</code>, <code>task.task_type</code>, <code>task.team</code>, <code>task.workflow</code>, and <code>task.model</code> from the Task object.</p>' +
        '<h3>Outcome Rates</h3>' +
        '<pre><code>tracker.outcome_rates()     # {"success": 0.85, "failure": 0.10, "timeout": 0.05}\ntracker.outcome_counts()    # {"success": 170, "failure": 20, "timeout": 10}</code></pre>' +
        '<h3>Cost Per Outcome</h3>' +
        '<pre><code>tracker.cost_per_outcome("success")   # avg cost of successful tasks\ntracker.cost_per_outcome("failure")   # avg cost of failed tasks\ntracker.total_cost_by_outcome()       # {"success": 850.0, "failure": 200.0}</code></pre>' +
        '<h3>Quality Analysis</h3>' +
        '<pre><code>tracker.avg_quality()          # overall average quality score\ntracker.quality_by_model()     # {"opus": 0.95, "haiku": 0.72}\ntracker.quality_by_agent()     # {"analyst": 0.91, "chatbot": 0.78}</code></pre>' +
        '<p>Quality methods only include records where <code>quality_score</code> was provided (not None).</p>' +
        '<h3>ROI Queries</h3>' +
        '<p>The core ROI methods combine cost and outcome data per agent or per model:</p>' +
        '<pre><code>tracker.roi_by_agent()\n# {"analyst": {\n#     "total_cost": 450.0,\n#     "task_count": 90,\n#     "success_rate": 0.95,\n#     "avg_quality": 0.91,\n#     "cost_per_success": 4.8\n# }}\n\ntracker.roi_by_model()\n# {"opus": {"total_cost": 680, "success_rate": 0.97, ...},\n#  "haiku": {"total_cost": 120, "success_rate": 0.80, ...}}</code></pre>' +
        '<h3>Summary</h3>' +
        '<pre><code>tracker.summary()\n# {"total_records": 200, "outcome_rates": {...},\n#  "outcome_counts": {...}, "total_cost_by_outcome": {...},\n#  "avg_quality": 0.87}</code></pre>',
      summary: 'OutcomeTracker links token spend to task outcomes for ROI attribution. Record each task\'s outcome (success/failure/partial/timeout) with an optional quality_score. Query outcome_rates, cost_per_outcome, quality_by_model, and roi_by_agent/roi_by_model to answer "was the token spend worth it?"',
      mentalModel: 'Outcome tracking is like a restaurant\'s quality-cost scorecard. Every dish served (task) has a cost (weight) and a customer rating (quality_score). The manager can ask: "What is our average rating for the expensive dishes?" (quality_by_model), "Which chef has the best cost-per-satisfied-customer?" (roi_by_agent), and "Are failed dishes costing us more than successful ones?" (cost_per_outcome). Without this scorecard, you only know how much you spent, not whether it was worth it.',
      mistakes: [
        'Forgetting to set task.age before recording -- OutcomeTracker reads task.age for wait_ticks. In standalone use (without a scheduler), you must set age manually on the Task object before calling record()',
        'Recording outcomes without quality_score and expecting quality queries to work -- quality_by_model() and avg_quality() only include records where quality_score is not None. Pass quality_score on every record() call for complete quality data',
        'Confusing roi_by_model() with cost_by_model() from CostAttribution -- CostAttribution gives raw cost totals; OutcomeTracker gives cost-effectiveness metrics that combine cost with success rates and quality scores'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create an OutcomeTracker and record outcomes.</strong><br>' +
        '<pre><code>from loco import OutcomeTracker, Task\n\ntracker = OutcomeTracker()\n\n# High-quality opus tasks (expensive but reliable)\nfor i in range(10):\n    task = Task(weight=5.0, model="opus", team="research", age=3)\n    tracker.record("analyst", task, outcome="success", quality_score=0.95)\n\n# One opus failure\ntask = Task(weight=5.0, model="opus", team="research", age=3)\ntracker.record("analyst", task, outcome="failure", quality_score=0.2)\n\n# Cheaper haiku tasks (less reliable)\nfor i in range(8):\n    task = Task(weight=1.0, model="haiku", team="support", age=2)\n    tracker.record("chatbot", task, outcome="success", quality_score=0.7)\n\nfor i in range(4):\n    task = Task(weight=1.0, model="haiku", team="support", age=2)\n    tracker.record("chatbot", task, outcome="failure", quality_score=0.3)\n\nprint(f"Total records: {len(tracker._records)}")</code></pre>' +
        '<strong>Step 3 -- Check outcome rates and cost per outcome.</strong><br>' +
        '<pre><code>print("Outcome rates:", tracker.outcome_rates())\nprint("Outcome counts:", tracker.outcome_counts())\nprint("\\nCost per outcome:")\nprint(f"  Success: {tracker.cost_per_outcome(\'success\'):.2f}")\nprint(f"  Failure: {tracker.cost_per_outcome(\'failure\'):.2f}")\nprint("\\nTotal cost by outcome:", tracker.total_cost_by_outcome())</code></pre>' +
        'Success rate should be about 0.78 (18 successes / 23 total). Cost per success is higher because opus tasks (weight=5) succeed more often than haiku tasks.<br><br>' +
        '<strong>Step 4 -- Query quality by model.</strong><br>' +
        '<pre><code>print("Quality by model:", tracker.quality_by_model())\nprint("Quality by agent:", tracker.quality_by_agent())\nprint("Overall avg quality:", tracker.avg_quality())</code></pre>' +
        'Opus should show higher quality than haiku. The analyst (using opus) should have higher quality than the chatbot (using haiku).<br><br>' +
        '<strong>Step 5 -- Query ROI by model and by agent.</strong><br>' +
        '<pre><code>import json\n\nprint("ROI by model:")\nfor model, roi in tracker.roi_by_model().items():\n    print(f"\\n  {model}:")\n    print(json.dumps(roi, indent=4, default=str))\n\nprint("\\nROI by agent:")\nfor agent_id, roi in tracker.roi_by_agent().items():\n    print(f"\\n  {agent_id}:")\n    print(json.dumps(roi, indent=4, default=str))</code></pre>' +
        'Compare opus vs haiku: opus has higher total_cost but also higher success_rate and avg_quality. The ROI question is whether the quality premium justifies the cost difference. cost_per_success shows the average cost of each successful task.<br><br>' +
        '<strong>Step 6 -- Check the full summary.</strong><br>' +
        '<pre><code>print(json.dumps(tracker.summary(), indent=2, default=str))</code></pre>' +
        'The summary combines outcome rates, counts, cost breakdowns, and average quality into a single JSON-serializable dict.<br><br>' +
        '<strong>Step 7 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    }
  ]
});
