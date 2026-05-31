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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create mock agents with different configurations.</strong><br>' +
        '<pre><code>from loco.testing import mock_agent, mock_resource\n\n# Three agents with different task counts and weights\napi = mock_agent("api", pending_tasks=5, task_weight=1.0)\nworker = mock_agent("worker", pending_tasks=10, task_weight=2.0)\nbatch = mock_agent("batch", pending_tasks=2, task_weight=5.0)\n\nprint(f"api:    {len(api.tasks)} tasks, Qi={api.queue_depth_weighted}")\nprint(f"worker: {len(worker.tasks)} tasks, Qi={worker.queue_depth_weighted}")\nprint(f"batch:  {len(batch.tasks)} tasks, Qi={batch.queue_depth_weighted}")</code></pre>' +
        'Notice Qi is the sum of weights, not the count. Worker has 10 tasks but Qi=20 (10 * 2.0). Batch has only 2 tasks but Qi=10 (2 * 5.0).<br><br>' +
        '<strong>Step 3 -- Verify the predictable task ID naming pattern.</strong><br>' +
        '<pre><code># Task IDs follow the pattern "agent_id-tN"\nprint(f"\\napi task IDs: {[t.task_id for t in api.tasks]}")\nprint(f"First: {api.tasks[0].task_id}")  # "api-t0"\nprint(f"Last:  {api.tasks[-1].task_id}") # "api-t4"\n\nassert api.tasks[0].task_id == "api-t0"\nassert api.tasks[-1].task_id == "api-t4"\nassert worker.tasks[0].task_id == "worker-t0"\nassert worker.tasks[-1].task_id == "worker-t9"\nassert batch.tasks[0].task_id == "batch-t0"\nassert batch.tasks[-1].task_id == "batch-t1"\nprint("\\nAll task ID assertions passed!")</code></pre>' +
        'The naming convention makes it easy to trace which tasks belong to which agent when debugging test failures.<br><br>' +
        '<strong>Step 4 -- Create a mock resource.</strong><br>' +
        '<pre><code>gpu = mock_resource("gpu", capacity=2)\nprint(f"\\nResource: name={gpu.name}, capacity={gpu.capacity}")\nprint(f"Available slots: {gpu.available_slots}")\nprint(f"Utilization: {gpu.utilization}")</code></pre>' +
        'mock_resource creates a SharedResource for testing. Capacity=2 means two agents can hold it simultaneously.<br><br>' +
        '<strong>Step 5 -- Combine them into a scheduler.</strong><br>' +
        '<pre><code>from loco.testing import SyncTestScheduler\n\nscheduler = SyncTestScheduler([api, worker, batch], alpha=0.25, seed=42)\nresult = scheduler.step()\nprint(f"\\nFirst tick served: {result.selected_agent.agent_id}")\nprint(f"Scores: {result.scores}")</code></pre>' +
        'The mock factories are building blocks. Every LOCO test starts by creating agents and optionally a resource, then feeding them to a scheduler.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create three agents and step through three ticks.</strong><br>' +
        '<pre><code>from loco.testing import SyncTestScheduler, mock_agent\n\nagents = [\n    mock_agent("fast", pending_tasks=3),\n    mock_agent("medium", pending_tasks=6),\n    mock_agent("slow", pending_tasks=9),\n]\nscheduler = SyncTestScheduler(agents, alpha=0.5, seed=42)\n\nfor i in range(3):\n    result = scheduler.step()\n    aid = result.selected_agent.agent_id\n    print(f"Tick {i+1}: served {aid}  scores={result.scores}")</code></pre>' +
        'With alpha=0.5 (throughput), "slow" (deepest backlog, Qi=9) should dominate the first few ticks. Watch how scores shift as queues drain.<br><br>' +
        '<strong>Step 3 -- Use run_all() for a complete execution.</strong> Create a fresh scheduler (previous one has already consumed some tasks):<br>' +
        '<pre><code>agents2 = [\n    mock_agent("fast", pending_tasks=3),\n    mock_agent("medium", pending_tasks=6),\n    mock_agent("slow", pending_tasks=9),\n]\nscheduler2 = SyncTestScheduler(agents2, alpha=0.5, seed=42)\nresult = scheduler2.run_all()\n\nprint(f"Total ticks: {result.total_ticks}")\nprint(f"Service counts: {result.service_counts}")\nprint(f"Service order (first 10): {result.service_order[:10]}")</code></pre>' +
        '<strong>Step 4 -- Verify the results.</strong><br>' +
        '<pre><code># Every task must be served exactly once\nassert result.total_ticks == 18, f"Expected 18, got {result.total_ticks}"\nassert result.service_counts["fast"] == 3\nassert result.service_counts["medium"] == 6\nassert result.service_counts["slow"] == 9\nassert sum(result.service_counts.values()) == 18\nprint("All assertions passed!")\n\n# Check fairness\nfairness = scheduler2.jains_fairness()\nprint(f"Jain\\\'s fairness: {fairness:.4f}")</code></pre>' +
        'service_counts must match the original task assignments exactly. No tasks lost, no tasks duplicated. total_ticks equals the sum of all tasks (3+6+9=18).<br><br>' +
        '<strong>Step 5 -- Inspect individual steps from the RunResult.</strong><br>' +
        '<pre><code># RunResult stores every StepResult\nprint(f"\\nSteps recorded: {len(result.steps)}")\nfor step in result.steps[:5]:\n    aid = step.selected_agent.agent_id\n    print(f"  {aid}: task_age={step.served_task.age}")</code></pre>' +
        'The <code>steps</code> list gives you tick-by-tick access to every scheduling decision, which is invaluable for debugging unexpected behavior.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Hand-calculate the expected scores.</strong> Write this down before running any code:<br>' +
        '<pre><code># Given:\n#   Agent A: Qi=6, Dmax=5\n#   Agent B: Qi=3, Dmax=15\n#   Agent C: Qi=1, Dmax=30\n#   alpha=0.25\n#\n# Step 1: Find normalization values\n#   Qmax = max(6, 3, 1) = 6\n#   Dmax_global = max(5, 15, 30) = 30\n#\n# Step 2: Apply L(i) = alpha*(Qi/Qmax) + (1-alpha)*(Dmax_i/Dmax_global)\n#   L(A) = 0.25*(6/6) + 0.75*(5/30)  = 0.25  + 0.125 = 0.375\n#   L(B) = 0.25*(3/6) + 0.75*(15/30) = 0.125 + 0.375 = 0.500\n#   L(C) = 0.25*(1/6) + 0.75*(30/30) = 0.042 + 0.750 = 0.792\n#\n# Winner: C (score 0.792) -- despite having the smallest queue,\n# its Dmax=30 dominates at alpha=0.25 (75% weight on wait time)</code></pre>' +
        '<strong>Step 3 -- Build the scenario with real agents.</strong><br>' +
        '<pre><code>from loco.testing import SyncTestScheduler, mock_agent\nfrom loco import Agent, Task\n\n# Agent A: 6 tasks (weight 1.0 each -> Qi=6), oldest waited 5 ticks\nagent_a = Agent(agent_id="A")\nagent_a.tasks = [Task(weight=1.0, age=5-i) for i in range(6)]\n\n# Agent B: 3 tasks (weight 1.0 each -> Qi=3), oldest waited 15 ticks\nagent_b = Agent(agent_id="B")\nagent_b.tasks = [Task(weight=1.0, age=15-i*5) for i in range(3)]\n\n# Agent C: 1 task (weight 1.0 -> Qi=1), waited 30 ticks\nagent_c = Agent(agent_id="C")\nagent_c.tasks = [Task(weight=1.0, age=30)]\n\n# Verify our setup\nfor agent in [agent_a, agent_b, agent_c]:\n    print(f"{agent.agent_id}: Qi={agent.queue_depth_weighted}, Dmax={agent.dmax}")</code></pre>' +
        '<strong>Step 4 -- Run one step and compare against hand calculation.</strong><br>' +
        '<pre><code>scheduler = SyncTestScheduler([agent_a, agent_b, agent_c], alpha=0.25, seed=42)\nresult = scheduler.step()\n\nprint(f"\\nScores: {result.scores}")\nprint(f"Winner: {result.selected_agent.agent_id}")\n\n# Verify against hand calculations\nassert abs(result.scores["A"] - 0.375) < 0.01, f"A score wrong: {result.scores[\\\"A\\\"]}"\nassert abs(result.scores["B"] - 0.500) < 0.01, f"B score wrong: {result.scores[\\\"B\\\"]}"\nassert result.selected_agent.agent_id == "C", "C should win"\nprint("\\nAll assertions match hand calculations!")</code></pre>' +
        'The real scores should match your hand calculations. If they do not, re-check your Qi and Dmax values -- a common mistake is confusing Qi (sum of weights) with task count.<br><br>' +
        '<strong>Step 5 -- Write this as a proper pytest test.</strong> Save this pattern for your own tests:<br>' +
        '<pre><code>def test_wait_time_beats_backlog_at_alpha_025():\n    """Agent C (Dmax=30, Qi=1) should beat Agent A (Dmax=5, Qi=6)\n    at alpha=0.25 because wait time has 75% weight.\n    Hand-calc: L(C)=0.792 > L(A)=0.375"""\n    a = Agent(agent_id="A")\n    a.tasks = [Task(weight=1.0, age=5-i) for i in range(6)]\n    c = Agent(agent_id="C")\n    c.tasks = [Task(weight=1.0, age=30)]\n    scheduler = SyncTestScheduler([a, c], alpha=0.25, seed=42)\n    result = scheduler.step()\n    assert result.selected_agent.agent_id == "C"\n\ntest_wait_time_beats_backlog_at_alpha_025()\nprint("Test passed!")</code></pre>' +
        'Including the hand calculation as a docstring makes test failures easy to debug.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Run a mini fairness scenario at alpha=0.25.</strong><br>' +
        '<pre><code>from loco.testing import SyncTestScheduler, mock_agent\n\nagents = [mock_agent(f"agent-{i}", pending_tasks=10) for i in range(5)]\nscheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)\nresult = scheduler.run_all()\n\nprint("alpha=0.25 (balanced):")\nprint(f"  Total ticks: {result.total_ticks}")\nprint(f"  Service counts: {result.service_counts}")\nfairness = scheduler.jains_fairness()\nprint(f"  Jain\\\'s fairness: {fairness:.4f}")\n\n# Verify every agent was served exactly 10 times\nfor aid, count in result.service_counts.items():\n    assert count == 10, f"{aid} served {count} times, expected 10"\nassert fairness >= 0.95, f"Fairness {fairness} below threshold"\nprint("  All assertions passed!")</code></pre>' +
        '<strong>Step 3 -- Run the same scenario at alpha=0.75 (danger zone).</strong><br>' +
        '<pre><code>agents2 = [mock_agent(f"agent-{i}", pending_tasks=10) for i in range(5)]\nscheduler2 = SyncTestScheduler(agents2, alpha=0.75, seed=42)\nresult2 = scheduler2.run_all()\n\nprint("\\nalpha=0.75 (danger zone):")\nprint(f"  Service counts: {result2.service_counts}")\nfairness2 = scheduler2.jains_fairness()\nprint(f"  Jain\\\'s fairness: {fairness2:.4f}")\n\n# Compare wait times\nprint("\\n  Wait times per agent:")\nfor i in range(5):\n    aid = f"agent-{i}"\n    wait = scheduler2.mean_wait_time(aid)\n    print(f"    {aid}: mean wait = {wait:.1f} ticks")</code></pre>' +
        '<strong>Step 4 -- Compare the two runs.</strong> Look for:<br>' +
        '<ul>' +
        '<li>At alpha=0.25, all agents should be served exactly 10 times with fairness >= 0.95.</li>' +
        '<li>At alpha=0.75, service counts may still be equal (with equal starting conditions), but wait times should diverge more. In scenarios with unequal workloads, alpha=0.75 causes starvation.</li>' +
        '<li>The starvation risk at high alpha is why the AdaptiveAlphaTuner clamps to [0.0, 0.5].</li>' +
        '</ul>' +
        '<strong>Step 5 -- Run the actual fairness.py example for the full proof.</strong><br>' +
        '<pre><code>exit()  # leave the REPL first</code></pre>' +
        '<pre><code>python3 examples/fairness.py</code></pre>' +
        'This runs 10 agents over 500 ticks with unequal arrival rates. The output table shows that alpha >= 0.75 causes real starvation (agents with zero completions). This is the empirical proof behind the alpha safety range.<br><br>' +
        '<strong>Key takeaway:</strong> The four validated scenarios are not just examples -- they are regression tests encoding production lessons. Always validate your alpha choice against sustained workloads before deploying.'
    }
  ]
});
