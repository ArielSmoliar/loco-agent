window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'testing',
  title: 'Testing',
  topics: [
    {
      id: 'mock-factories',
      title: 'Mock Factories',
      content:
        '<h3>Mock Factories</h3>' +
        '<p>Every LOCO test starts with mock objects. The <code>loco/testing.py</code> module provides factory functions that create pre-configured agents and resources so you never have to wire up real infrastructure in your tests.</p>' +
        '' +
        '<h4>mock_agent</h4>' +
        '<pre><code>from loco.testing import mock_agent\n' +
        '\n' +
        'mock_agent(\n' +
        '    agent_id,           # Required: unique string identifier\n' +
        '    pending_tasks=0,    # Number of tasks to pre-load\n' +
        '    task_weight=1.0,    # Weight assigned to each task\n' +
        '    agent_type="default"  # Agent type label\n' +
        ') -> Agent</code></pre>' +
        '' +
        '<p><code>mock_agent</code> returns a fully initialized <code>Agent</code> object. When you specify <code>pending_tasks</code>, it creates that many tasks and adds them to the agent\'s queue automatically. Each task receives a predictable ID derived from the agent ID:</p>' +
        '' +
        '<pre><code># Creates an agent with 3 pending tasks:\n' +
        '# Task IDs: "web-t0", "web-t1", "web-t2"\n' +
        'agent = mock_agent("web", pending_tasks=3)\n' +
        '\n' +
        '# Each task has weight 2.0\n' +
        'heavy = mock_agent("heavy", pending_tasks=5, task_weight=2.0)\n' +
        '\n' +
        '# A specific agent type\n' +
        'gpu = mock_agent("gpu-1", pending_tasks=1, agent_type="gpu")</code></pre>' +
        '' +
        '<p>The naming convention <code>"agent_id-t0"</code>, <code>"agent_id-t1"</code>, etc. makes it easy to trace which tasks belong to which agent when debugging test failures.</p>' +
        '' +
        '<h4>mock_resource</h4>' +
        '<pre><code>from loco.testing import mock_resource\n' +
        '\n' +
        'mock_resource(\n' +
        '    name="test",    # Resource name\n' +
        '    capacity=1      # Maximum concurrent usage\n' +
        ') -> SharedResource</code></pre>' +
        '' +
        '<p><code>mock_resource</code> creates a <code>SharedResource</code> for testing resource contention scenarios. The default capacity of 1 simulates a mutex-like resource.</p>' +
        '' +
        '<pre><code># A simple mutex-like resource\n' +
        'db_lock = mock_resource("database")\n' +
        '\n' +
        '# A resource with higher concurrency\n' +
        'pool = mock_resource("connection_pool", capacity=5)</code></pre>' +
        '' +
        '<h4>Building Blocks</h4>' +
        '<p>These two factories are the building blocks for <em>all</em> LOCO tests. Every scenario you will encounter &mdash; from simple priority checks to complex multi-agent fairness validation &mdash; starts by calling <code>mock_agent</code> and optionally <code>mock_resource</code>. Master these first, and the rest of the testing API follows naturally.</p>',
      summary: 'mock_agent(agent_id, pending_tasks, task_weight, agent_type) creates a test Agent pre-loaded with predictably-named tasks (IDs like "agent_id-t0", "agent_id-t1"). mock_resource(name, capacity) creates a SharedResource. These two factories are the foundation for every LOCO test.',
      mentalModel: 'Think of mock factories like a crash-test dummy manufacturer. You order dummies (agents) with specific properties (weight, number of tasks) and place them in controlled scenarios. The dummies behave exactly like real agents under the scheduler\'s scoring logic, but you control every variable.',
      mistakes: [
        'Forgetting that task IDs follow the pattern "agent_id-tN" and then writing assertions against wrong task names.',
        'Using mock_agent with pending_tasks=0 and expecting the agent to be scheduled -- an agent with no tasks has nothing to be served.',
        'Creating mock_resource objects but never passing them to the scheduler, so resource contention is never actually tested.',
        'Setting task_weight to 0, which can cause division-by-zero or undefined behavior in scoring calculations.'
      ],
      exercise: 'Create three mock agents: "api" with 5 tasks at weight 1.0, "worker" with 10 tasks at weight 0.5, and "batch" with 2 tasks at weight 3.0. Also create a mock resource called "gpu" with capacity 2. Write assertions to verify the task IDs of the first and last task on each agent (e.g., "api-t0" through "api-t4").'
    },
    {
      id: 'sync-test-scheduler',
      title: 'SyncTestScheduler',
      content:
        '<h3>SyncTestScheduler</h3>' +
        '<p>The <code>SyncTestScheduler</code> is the centerpiece of LOCO\'s testing toolkit. It wraps the production <code>LOCOScheduler</code> with a synchronous, deterministic interface &mdash; no async, no real resources, no I/O. The scoring logic is <em>identical</em> to production, but you can step through it tick by tick.</p>' +
        '' +
        '<h4>Constructor</h4>' +
        '<pre><code>from loco.testing import SyncTestScheduler\n' +
        '\n' +
        'SyncTestScheduler(\n' +
        '    agents,              # List of Agent objects (use mock_agent)\n' +
        '    *,\n' +
        '    alpha=None,          # Scoring weight (0.0 to 0.5)\n' +
        '    optimize_for=None,   # Alternative to alpha: "throughput", "latency", "balanced"\n' +
        '    seed=42              # RNG seed for reproducible tie-breaking\n' +
        ')</code></pre>' +
        '' +
        '<p>The <code>seed</code> parameter defaults to 42, ensuring your tests produce the same results every run. This is critical: non-deterministic tests are worse than no tests at all.</p>' +
        '' +
        '<h4>Core Methods</h4>' +
        '' +
        '<h5>step(arrivals=None) &rarr; StepResult</h5>' +
        '<p>Advances the scheduler by exactly one tick. Returns a <code>StepResult</code> indicating which agent was selected and the scores computed. You can optionally inject new task arrivals during the step.</p>' +
        '' +
        '<pre><code>scheduler = SyncTestScheduler(agents, alpha=0.5, seed=42)\n' +
        '\n' +
        '# Run one tick\n' +
        'result = scheduler.step()\n' +
        'print(result.selected_agent)  # Agent ID that was served\n' +
        '\n' +
        '# Inject new tasks during a step\n' +
        'new_tasks = [Task("urgent-1"), Task("urgent-2")]\n' +
        'result = scheduler.step(arrivals={"api": new_tasks})</code></pre>' +
        '' +
        '<h5>run_all() &rarr; RunResult</h5>' +
        '<p>Runs the scheduler until every agent\'s queue is empty. Returns a comprehensive <code>RunResult</code> for analyzing the full execution.</p>' +
        '' +
        '<pre><code>result = scheduler.run_all()\n' +
        'print(result.total_ticks)       # How many steps it took\n' +
        'print(result.service_counts)    # {"agent_a": 5, "agent_b": 3}\n' +
        'print(result.service_order)     # ["agent_a", "agent_a", "agent_b", ...]\n' +
        'print(result.steps)             # List of individual StepResult objects</code></pre>' +
        '' +
        '<h5>add_tasks(agent_id, tasks)</h5>' +
        '<p>Adds tasks to a specific agent\'s queue between steps. Useful for simulating dynamic workloads.</p>' +
        '' +
        '<pre><code># Simulate a burst of work arriving for one agent\n' +
        'scheduler.add_tasks("api", [Task("api-extra-1"), Task("api-extra-2")])</code></pre>' +
        '' +
        '<h5>mean_wait_time(agent_id) &rarr; float</h5>' +
        '<p>Returns the average number of ticks an agent\'s tasks waited before being served. Lower is better.</p>' +
        '' +
        '<h5>jains_fairness() &rarr; float</h5>' +
        '<p>Computes Jain\'s fairness index across all agents. Returns a value between 0.0 and 1.0, where 1.0 means perfectly fair distribution of service.</p>' +
        '' +
        '<h4>RunResult Fields</h4>' +
        '<table>' +
        '<tr><th>Field</th><th>Type</th><th>Description</th></tr>' +
        '<tr><td><code>steps</code></td><td><code>list[StepResult]</code></td><td>Each individual step result</td></tr>' +
        '<tr><td><code>total_ticks</code></td><td><code>int</code></td><td>Total number of ticks executed</td></tr>' +
        '<tr><td><code>service_counts</code></td><td><code>dict[str, int]</code></td><td>How many tasks each agent was served</td></tr>' +
        '<tr><td><code>service_order</code></td><td><code>list[str]</code></td><td>Ordered list of agent IDs as they were served</td></tr>' +
        '</table>' +
        '' +
        '<h4>Your First Test in Under 10 Lines</h4>' +
        '<p>Here is a complete, working test that verifies priority scheduling:</p>' +
        '' +
        '<pre><code>from loco.testing import SyncTestScheduler, mock_agent\n' +
        '\n' +
        'def test_my_agent_gets_priority():\n' +
        '    agents = [mock_agent("mine", pending_tasks=10),\n' +
        '              mock_agent("other", pending_tasks=2)]\n' +
        '    scheduler = SyncTestScheduler(agents, alpha=0.5, seed=42)\n' +
        '    result = scheduler.step()\n' +
        '    assert result.selected_agent == "mine"</code></pre>' +
        '' +
        '<p>That\'s it. No mocking frameworks, no async boilerplate, no test fixtures. The <code>SyncTestScheduler</code> gives you the full power of LOCO\'s scoring engine in a format that fits in a unit test.</p>',
      summary: 'SyncTestScheduler wraps the production LOCOScheduler with a synchronous, deterministic interface. Use step() for tick-by-tick analysis, run_all() for complete execution, and helper methods like mean_wait_time() and jains_fairness() for metrics. RunResult provides service_counts, service_order, total_ticks, and individual step results.',
      mentalModel: 'Think of SyncTestScheduler as a flight simulator for your scheduling logic. The cockpit instruments (scoring, selection) are identical to the real aircraft, but the world outside is simulated. You control time (step), weather (arrivals), and can replay the same flight (seed) as many times as you need.',
      mistakes: [
        'Using run_all() on a scenario where tasks are continuously injected without limit -- the method will never return because the queue never empties.',
        'Forgetting to set the seed and then wondering why tests intermittently fail -- tie-breaking without a fixed seed is non-deterministic.',
        'Confusing service_counts (how many tasks each agent had served) with pending task counts (how many tasks remain in the queue).',
        'Calling step() after run_all() has already drained all queues -- there are no tasks left to schedule.'
      ],
      exercise: 'Create a SyncTestScheduler with three agents: "fast" (3 tasks), "medium" (6 tasks), and "slow" (9 tasks). Use alpha=0.5 and seed=42. Call step() three times and record which agent is selected each time. Then create a fresh scheduler with the same agents and use run_all(). Verify that service_counts matches the total number of tasks (3 + 6 + 9 = 18) and that total_ticks equals 18.'
    },
    {
      id: 'writing-effective-tests',
      title: 'Writing Effective LOCO Tests',
      content:
        '<h3>Writing Effective LOCO Tests</h3>' +
        '<p>Good LOCO tests verify the <em>scoring logic</em>, not the framework. You are not testing that Python works or that lists sort correctly. You are testing that your alpha configuration produces the scheduling behavior your system needs.</p>' +
        '' +
        '<h4>Use Alpha to Control Behavior Deterministically</h4>' +
        '<p>The alpha parameter is your primary lever for creating predictable test scenarios:</p>' +
        '' +
        '<table>' +
        '<tr><th>Alpha Value</th><th>Optimizes For</th><th>Behavior</th></tr>' +
        '<tr><td><code>alpha=0.5</code></td><td>Throughput</td><td>Deepest backlog wins &mdash; agents with the most pending tasks are served first</td></tr>' +
        '<tr><td><code>alpha=0.0</code></td><td>Latency</td><td>Longest-waiting wins &mdash; agents whose oldest task has waited the most ticks get priority</td></tr>' +
        '<tr><td><code>alpha=0.25</code></td><td>Balanced</td><td>Mix of both &mdash; considers both queue depth and wait time</td></tr>' +
        '</table>' +
        '' +
        '<p>When writing a test, pick the alpha that makes the expected outcome <em>unambiguous</em>. If you want to verify that the deepest backlog always goes first, use <code>alpha=0.5</code>. If you want to verify wait-time escalation, use <code>alpha=0.0</code>.</p>' +
        '' +
        '<h4>Hand-Calculate Expected Scores</h4>' +
        '<p>The most reliable tests include a hand-calculated expected score. Here is how LOCO\'s scoring formula works in practice:</p>' +
        '' +
        '<pre><code># Given:\n' +
        '# Agent A: Qi=4 (queue depth), Dmax=10 (max wait ticks)\n' +
        '# Agent B: Qi=2 (queue depth), Dmax=20 (max wait ticks)\n' +
        '# alpha=0.25\n' +
        '#\n' +
        '# Qmax = max(4, 2) = 4\n' +
        '# Dmax_global = max(10, 20) = 20\n' +
        '#\n' +
        '# L(a) = alpha*(Qi/Qmax) + (1-alpha)*(Dmax/Dmax_global)\n' +
        '# L(a) = 0.25*(4/4) + 0.75*(10/20) = 0.25 + 0.375 = 0.625\n' +
        '# L(b) = 0.25*(2/4) + 0.75*(20/20) = 0.125 + 0.75 = 0.875\n' +
        '#\n' +
        '# B wins -- its longer wait outweighs A\'s deeper backlog</code></pre>' +
        '' +
        '<p>Writing the calculation as a comment in your test serves two purposes: it documents your reasoning, and it makes failures easy to debug. When a test breaks, you can compare the expected calculation against the actual scores.</p>' +
        '' +
        '<pre><code>from loco.testing import SyncTestScheduler, mock_agent\n' +
        '\n' +
        'def test_wait_time_outweighs_backlog_at_alpha_025():\n' +
        '    """Agent B\'s longer wait should beat Agent A\'s deeper backlog."""\n' +
        '    a = mock_agent("a", pending_tasks=4)\n' +
        '    b = mock_agent("b", pending_tasks=2)\n' +
        '    scheduler = SyncTestScheduler([a, b], alpha=0.25, seed=42)\n' +
        '\n' +
        '    # Advance 10 ticks serving A, so B accumulates wait time\n' +
        '    for _ in range(10):\n' +
        '        scheduler.step()\n' +
        '\n' +
        '    # Now B should have enough Dmax to win\n' +
        '    result = scheduler.step()\n' +
        '    # Hand-calc: L(a) = 0.625, L(b) = 0.875 -> B wins\n' +
        '    assert result.selected_agent == "b"</code></pre>' +
        '' +
        '<h4>Use run_all() for Fairness Validation</h4>' +
        '<p>Single-step assertions tell you about priority; <code>run_all()</code> tells you about fairness over time. Use it to verify that all agents eventually get served:</p>' +
        '' +
        '<pre><code>def test_all_agents_eventually_served():\n' +
        '    agents = [mock_agent(f"agent-{i}", pending_tasks=5) for i in range(10)]\n' +
        '    scheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)\n' +
        '    result = scheduler.run_all()\n' +
        '\n' +
        '    # Every agent should have been served exactly 5 times\n' +
        '    for agent_id, count in result.service_counts.items():\n' +
        '        assert count == 5, f"{agent_id} served {count} times, expected 5"\n' +
        '\n' +
        '    # Jain\'s fairness should be very high\n' +
        '    assert scheduler.jains_fairness() >= 0.95</code></pre>' +
        '' +
        '<h4>Use Seed for Reproducibility</h4>' +
        '<p>Always set the <code>seed</code> parameter. The default is 42, which is fine for most tests. If you need to test different tie-breaking paths, parameterize the seed:</p>' +
        '' +
        '<pre><code>import pytest\n' +
        '\n' +
        '@pytest.mark.parametrize("seed", [42, 123, 456, 789])\n' +
        'def test_fairness_across_seeds(seed):\n' +
        '    agents = [mock_agent(f"a-{i}", pending_tasks=3) for i in range(5)]\n' +
        '    scheduler = SyncTestScheduler(agents, alpha=0.25, seed=seed)\n' +
        '    result = scheduler.run_all()\n' +
        '    assert scheduler.jains_fairness() >= 0.90</code></pre>' +
        '' +
        '<h4>Test Edge Cases</h4>' +
        '<p>Don\'t forget the boundary conditions. These are where bugs hide:</p>' +
        '' +
        '<pre><code># Single agent -- should still work\n' +
        'def test_single_agent():\n' +
        '    agents = [mock_agent("solo", pending_tasks=3)]\n' +
        '    scheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)\n' +
        '    result = scheduler.run_all()\n' +
        '    assert result.total_ticks == 3\n' +
        '    assert result.service_counts["solo"] == 3\n' +
        '\n' +
        '# All agents empty -- nothing to schedule\n' +
        'def test_all_empty():\n' +
        '    agents = [mock_agent("a"), mock_agent("b"), mock_agent("c")]\n' +
        '    scheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)\n' +
        '    result = scheduler.run_all()\n' +
        '    assert result.total_ticks == 0\n' +
        '    assert result.service_counts == {}\n' +
        '\n' +
        '# Equal scores -- seed determines tie-breaking\n' +
        'def test_equal_scores_tie_break():\n' +
        '    agents = [mock_agent("x", pending_tasks=5),\n' +
        '              mock_agent("y", pending_tasks=5)]\n' +
        '    scheduler = SyncTestScheduler(agents, alpha=0.5, seed=42)\n' +
        '    result = scheduler.step()\n' +
        '    # With seed=42, one of them wins deterministically\n' +
        '    assert result.selected_agent in ("x", "y")</code></pre>',
      summary: 'Test the scoring logic, not the framework. Use alpha values to create deterministic scenarios (0.5 for throughput, 0.0 for latency, 0.25 for balanced). Hand-calculate expected scores to verify behavior. Use run_all() for fairness validation, seed for reproducibility, and always test edge cases like single agents, empty queues, and equal scores.',
      mentalModel: 'Think of writing LOCO tests like setting up physics experiments. You control the initial conditions (alpha, agent tasks), predict the outcome with math (hand-calculated scores), run the experiment (step or run_all), and compare the measurement to your prediction. If they diverge, either your math or your understanding of the formula is wrong -- both are valuable discoveries.',
      mistakes: [
        'Testing framework mechanics (does step() return a StepResult?) instead of testing your scheduling assumptions (does the right agent win with my alpha value?).',
        'Skipping the hand-calculation step and writing assertions based on "whatever the test output was the first time I ran it" -- this just locks in the current behavior, correct or not.',
        'Using alpha=0.25 when you want an unambiguous outcome -- the balanced mode creates nuanced scores that may not have a clear winner without careful calculation.',
        'Not testing edge cases like empty queues or single agents, which are exactly the scenarios that surface division-by-zero and off-by-one bugs.'
      ],
      exercise: 'Write a test that hand-calculates scores for three agents: Agent A (Qi=6, Dmax=5), Agent B (Qi=3, Dmax=15), Agent C (Qi=1, Dmax=30). Use alpha=0.25. Show the full calculation in comments, predict which agent wins, then verify with SyncTestScheduler. Hint: calculate Qmax and Dmax_global first, then apply the formula L(i) = alpha*(Qi/Qmax) + (1-alpha)*(Dmax_i/Dmax_global) for each agent.'
    },
    {
      id: 'four-validated-scenarios',
      title: 'The Four Validated Scenarios',
      content:
        '<h3>The Four Validated Scenarios</h3>' +
        '<p>The <code>examples/</code> directory contains four canonical test scenarios that validate LOCO\'s core scheduling guarantees. These are not just examples &mdash; they are regression tests that must pass before any release. Understanding them teaches you what LOCO promises and how to verify those promises.</p>' +
        '' +
        '<h4>Scenario 1: burst.py &mdash; Simultaneous Work Arrival</h4>' +
        '<p><strong>Setup:</strong> 8 agents receive work simultaneously, each with a different number of tasks.</p>' +
        '<p><strong>Validates:</strong> With throughput-oriented alpha, the deepest-backlog agents are served first.</p>' +
        '' +
        '<pre><code># burst.py -- conceptual structure\n' +
        'from loco.testing import SyncTestScheduler, mock_agent\n' +
        '\n' +
        'def test_burst():\n' +
        '    # 8 agents with varying backlogs\n' +
        '    agents = [\n' +
        '        mock_agent("a1", pending_tasks=20),\n' +
        '        mock_agent("a2", pending_tasks=15),\n' +
        '        mock_agent("a3", pending_tasks=10),\n' +
        '        mock_agent("a4", pending_tasks=8),\n' +
        '        mock_agent("a5", pending_tasks=5),\n' +
        '        mock_agent("a6", pending_tasks=3),\n' +
        '        mock_agent("a7", pending_tasks=2),\n' +
        '        mock_agent("a8", pending_tasks=1),\n' +
        '    ]\n' +
        '    scheduler = SyncTestScheduler(agents, alpha=0.5, seed=42)\n' +
        '    result = scheduler.run_all()\n' +
        '\n' +
        '    # Key assertion: service counts must exactly match task assignments\n' +
        '    assert result.service_counts["a1"] == 20\n' +
        '    assert result.service_counts["a8"] == 1\n' +
        '    assert result.total_ticks == 20 + 15 + 10 + 8 + 5 + 3 + 2 + 1</code></pre>' +
        '' +
        '<p><strong>Expected:</strong> Service counts match task assignments exactly. Every task is served, and the deepest backlogs are drained first. The total ticks equal the sum of all tasks (64).</p>' +
        '' +
        '<h4>Scenario 2: fairness.py &mdash; Sustained Load Over Time</h4>' +
        '<p><strong>Setup:</strong> 10 agents over 500 ticks with continuous task arrivals.</p>' +
        '<p><strong>Validates:</strong> With <code>alpha=0.25</code>, Jain\'s fairness index stays at or above 0.98.</p>' +
        '' +
        '<pre><code># fairness.py -- conceptual structure\n' +
        'from loco.testing import SyncTestScheduler, mock_agent\n' +
        '\n' +
        'def test_sustained_fairness():\n' +
        '    agents = [mock_agent(f"agent-{i}", pending_tasks=10) for i in range(10)]\n' +
        '    scheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)\n' +
        '\n' +
        '    # Simulate 500 ticks with periodic task replenishment\n' +
        '    for tick in range(500):\n' +
        '        result = scheduler.step()\n' +
        '        # Replenish tasks to maintain sustained load\n' +
        '        if tick % 50 == 0:\n' +
        '            for i in range(10):\n' +
        '                scheduler.add_tasks(f"agent-{i}",\n' +
        '                    [Task(f"agent-{i}-refill-{tick}")])\n' +
        '\n' +
        '    fairness = scheduler.jains_fairness()\n' +
        '    assert fairness >= 0.98, f"Fairness {fairness} below threshold"</code></pre>' +
        '' +
        '<p><strong>CRITICAL finding:</strong> This scenario also demonstrates that <code>alpha >= 0.75</code> causes <strong>starvation</strong>. When alpha is too high, the scheduler over-prioritizes queue depth and starves agents with smaller backlogs. This is why 0.25 is the recommended balanced value &mdash; it was validated here.</p>' +
        '' +
        '<div style="border-left: 4px solid #e74c3c; padding: 10px; margin: 10px 0; background: #fdf0ef;">' +
        '<strong>Warning:</strong> If you set <code>alpha >= 0.75</code>, agents with small queues may <em>never</em> be served. The fairness.py scenario proves this empirically. Always validate your alpha choice against sustained workloads before deploying.' +
        '</div>' +
        '' +
        '<h4>Scenario 3: webhook_spike.py &mdash; Sudden Traffic Spike</h4>' +
        '<p><strong>Setup:</strong> A baseline of background load across multiple agents, then a sudden spike of webhook-triggered tasks on a subset of agents.</p>' +
        '<p><strong>Validates:</strong> Dmax (maximum wait time) escalation prevents webhook agents from being starved by background load.</p>' +
        '' +
        '<pre><code># webhook_spike.py -- conceptual structure\n' +
        'from loco.testing import SyncTestScheduler, mock_agent\n' +
        '\n' +
        'def test_webhook_spike():\n' +
        '    # Background agents with steady load\n' +
        '    bg_agents = [mock_agent(f"bg-{i}", pending_tasks=5) for i in range(6)]\n' +
        '\n' +
        '    # Webhook agents start empty\n' +
        '    wh_agents = [mock_agent(f"webhook-{i}", pending_tasks=0) for i in range(2)]\n' +
        '\n' +
        '    scheduler = SyncTestScheduler(\n' +
        '        bg_agents + wh_agents, alpha=0.25, seed=42\n' +
        '    )\n' +
        '\n' +
        '    # Run background for a while\n' +
        '    for _ in range(20):\n' +
        '        scheduler.step()\n' +
        '\n' +
        '    # SPIKE: webhook agents suddenly receive heavy load\n' +
        '    for i in range(2):\n' +
        '        scheduler.add_tasks(f"webhook-{i}",\n' +
        '            [Task(f"wh-{i}-{j}") for j in range(15)])\n' +
        '\n' +
        '    # Continue running -- webhook agents should NOT be starved\n' +
        '    for _ in range(50):\n' +
        '        scheduler.step()\n' +
        '\n' +
        '    # Webhook agents\' wait time should not explode\n' +
        '    for i in range(2):\n' +
        '        wait = scheduler.mean_wait_time(f"webhook-{i}")\n' +
        '        assert wait < 15, f"webhook-{i} mean wait {wait} is too high"</code></pre>' +
        '' +
        '<p><strong>Why this matters:</strong> In production, webhook endpoints have SLA requirements. If background batch processing starves webhook handlers, requests time out and data is lost. The Dmax escalation mechanism ensures that newly arrived, high-urgency work rises in priority as its wait time grows.</p>' +
        '' +
        '<h4>Scenario 4: mdash_security.py &mdash; Security-Labeled Agents</h4>' +
        '<p><strong>Setup:</strong> 55 agents with security labels and dispatch policies.</p>' +
        '<p><strong>Validates:</strong> Security policies are enforced at dispatch time, regardless of scoring.</p>' +
        '' +
        '<pre><code># mdash_security.py -- conceptual structure\n' +
        'from loco.testing import SyncTestScheduler, mock_agent\n' +
        '\n' +
        'def test_security_policies_enforced():\n' +
        '    # Mix of agent types with security labels\n' +
        '    agents = []\n' +
        '    for i in range(40):\n' +
        '        agents.append(mock_agent(f"standard-{i}",\n' +
        '            pending_tasks=3, agent_type="standard"))\n' +
        '    for i in range(10):\n' +
        '        agents.append(mock_agent(f"restricted-{i}",\n' +
        '            pending_tasks=5, agent_type="restricted"))\n' +
        '    for i in range(5):\n' +
        '        agents.append(mock_agent(f"privileged-{i}",\n' +
        '            pending_tasks=8, agent_type="privileged"))\n' +
        '\n' +
        '    scheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)\n' +
        '    result = scheduler.run_all()\n' +
        '\n' +
        '    # Verify: all agents are served, policies are not bypassed\n' +
        '    assert len(result.service_counts) == 55\n' +
        '    # Verify: total tasks match expectations\n' +
        '    total = sum(result.service_counts.values())\n' +
        '    assert total == (40 * 3) + (10 * 5) + (5 * 8)  # 210</code></pre>' +
        '' +
        '<p><strong>Scale matters:</strong> With 55 agents, this scenario tests that scheduling remains correct and policies hold even at moderate scale. It catches bugs that only surface when many agents compete simultaneously.</p>' +
        '' +
        '<h4>Using the Scenarios as Templates</h4>' +
        '<p>Each of these four scenarios is a template for your own validation tests:</p>' +
        '<ul>' +
        '<li><strong>burst.py</strong> &rarr; Use when testing initial prioritization under simultaneous load</li>' +
        '<li><strong>fairness.py</strong> &rarr; Use when validating long-running fairness guarantees</li>' +
        '<li><strong>webhook_spike.py</strong> &rarr; Use when testing response to sudden workload changes</li>' +
        '<li><strong>mdash_security.py</strong> &rarr; Use when verifying policy enforcement at scale</li>' +
        '</ul>' +
        '<p>When writing a new test, start by asking: "Which of these four patterns does my scenario most resemble?" Then adapt that scenario\'s structure to your specific needs.</p>',
      summary: 'The four validated scenarios in examples/ are both regression tests and templates: burst.py tests simultaneous load prioritization, fairness.py validates Jain\'s fairness >= 0.98 at alpha=0.25 (and proves alpha >= 0.75 causes starvation), webhook_spike.py verifies Dmax escalation prevents starvation during traffic spikes, and mdash_security.py confirms policy enforcement across 55 agents.',
      mentalModel: 'Think of the four scenarios as crash tests for cars. Each one tests a specific failure mode: head-on collision (burst), long-distance endurance (fairness), sudden swerve (webhook spike), and security barrier (mdash). A car must pass all four to be road-worthy. Your scheduling configuration must pass all four to be production-worthy.',
      mistakes: [
        'Treating the example scenarios as optional documentation rather than mandatory regression tests -- they encode hard-won production lessons.',
        'Using alpha >= 0.75 in production without running the fairness scenario first -- the starvation behavior is empirically proven and not obvious from the formula alone.',
        'Testing only the burst scenario (immediate prioritization) and assuming fairness will follow -- burst and fairness test fundamentally different properties.',
        'Ignoring the mdash_security scenario when your system has no security labels -- the pattern of testing at 55 agents catches scale-dependent bugs regardless of security features.'
      ],
      exercise: 'Write a mini version of the fairness scenario: create 5 agents each with 10 tasks, run with alpha=0.25 and seed=42 using run_all(). Assert that Jain\'s fairness >= 0.95 and that every agent\'s service count equals 10. Then change alpha to 0.75 and observe whether fairness degrades. Document your findings as comments explaining why the alpha value matters.'
    }
  ]
});
