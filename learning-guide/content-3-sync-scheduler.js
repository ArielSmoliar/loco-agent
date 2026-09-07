window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'sync-scheduler',
  title: 'The Sync Scheduler',
  topics: [
    {
      id: 'loco-scheduler-overview',
      title: 'LOCOScheduler Overview',
      content: '<p>The <strong>LOCOScheduler</strong> in <code>loco/scheduler.py</code> is the sync scoring core of LOCO-Agent. It contains the pure math -- no async, no I/O, no network calls. This makes it perfect for testing and scenario replay.</p>' +
        '<h3>Constructor</h3>' +
        '<pre><code>class LOCOScheduler:\n    def __init__(\n        self,\n        agents: list[Agent],\n        *,\n        alpha: float | None = None,\n        optimize_for: str | None = None,\n        max_history: int = 10_000,\n        seed: int | None = None,\n    ) -> None:</code></pre>' +
        '<p>Key rules:</p>' +
        '<ul><li>Pass <strong>alpha</strong> OR <strong>optimize_for</strong>, never both (raises ValueError)</li><li>If neither is passed, defaults to <code>optimize_for="balanced"</code> (alpha=0.25)</li><li><code>alpha</code> must be in [0.0, 1.0]</li><li><code>optimize_for</code> must be one of "latency", "balanced", "throughput"</li></ul>' +
        '<h3>Internal State</h3>' +
        '<pre><code>self.agents = {a.agent_id: a for a in agents}  # dict keyed by ID\nself.alpha = resolved_alpha                     # float\nself.rng = random.Random(seed)                  # seeded RNG for tie-breaks\nself.tick = 0                                   # current tick counter\nself.history: deque[...] = deque(maxlen=max_history)  # step history\nself._task_counter = 0                          # for new_task() IDs</code></pre>' +
        '<h3>Helper Methods</h3>' +
        '<p><code>get_agent(agent_id)</code> -- looks up an agent by ID. Raises ValueError if not found.</p>' +
        '<p><code>new_task(weight=1.0, task_type="default")</code> -- creates a task with an auto-incremented ID and the current tick as arrival_tick. Useful for scenario replay.</p>' +
        '<p><code>total_tasks_remaining()</code> -- counts unserved tasks across all agents.</p>' +
        '<p><code>mean_wait_time(agent_id)</code> -- average age of completed tasks for a given agent.</p>',
      summary: 'LOCOScheduler is the pure-math scoring core. It takes a list of agents, an alpha value (or optimize_for preset), and a seed for deterministic tie-breaking. No async or I/O -- just scoring logic.',
      mentalModel: 'LOCOScheduler is the rulebook of a board game. It defines how to score players and pick the winner, but it does not handle the physical cards or timer. The async scheduler (AsyncLOCOScheduler) is the game host who applies the rules to real resources.',
      mistakes: [
        'Passing both alpha and optimize_for -- this raises ValueError. Pick one approach',
        'Forgetting the seed parameter -- without a seed, tie-breaking is non-deterministic, making tests flaky',
        'Accessing agents by list index instead of dict key -- self.agents is a dict keyed by agent_id, not a list'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create three agents with different workloads.</strong><br>' +
        '<pre><code>from loco import Agent, Task, LOCOScheduler\n\nagent_a = Agent(agent_id="A")\nagent_a.tasks = [Task(weight=2.0, age=5), Task(weight=2.0, age=3)]\n\nagent_b = Agent(agent_id="B")\nagent_b.tasks = [Task(weight=1.0, age=10)]\n\nagent_c = Agent(agent_id="C")\nagent_c.tasks = [Task(weight=5.0, age=1), Task(weight=5.0, age=1)]</code></pre>' +
        '<strong>Step 3 -- Create a scheduler with optimize_for="balanced".</strong><br>' +
        '<pre><code>s1 = LOCOScheduler([agent_a, agent_b, agent_c], optimize_for="balanced")\nprint(f"alpha from optimize_for: {s1.alpha}")\nscores1 = s1.compute_load_scores()\nprint(f"scores (optimize_for): {scores1}")</code></pre>' +
        'You should see <code>alpha=0.25</code> and a dict of scores for agents A, B, and C.<br><br>' +
        '<strong>Step 4 -- Create a second scheduler with alpha=0.25 directly.</strong><br>' +
        '<pre><code>s2 = LOCOScheduler([agent_a, agent_b, agent_c], alpha=0.25)\nprint(f"alpha from direct: {s2.alpha}")\nscores2 = s2.compute_load_scores()\nprint(f"scores (alpha=0.25): {scores2}")</code></pre>' +
        'The scores should be identical to Step 3. <code>optimize_for="balanced"</code> is a shortcut for <code>alpha=0.25</code>.<br><br>' +
        '<strong>Step 5 -- Verify that passing both raises an error.</strong><br>' +
        '<pre><code>try:\n    bad = LOCOScheduler([agent_a], alpha=0.25, optimize_for="balanced")\nexcept ValueError as e:\n    print(f"Error: {e}")</code></pre>' +
        'You should see a ValueError. The scheduler refuses ambiguous configuration -- pick one approach or the other, never both.<br><br>' +
        '<strong>Step 6 -- Try all three presets and compare.</strong><br>' +
        '<pre><code>for preset in ["latency", "balanced", "throughput"]:\n    s = LOCOScheduler([agent_a, agent_b, agent_c], optimize_for=preset)\n    scores = s.compute_load_scores()\n    print(f"{preset:>12}: alpha={s.alpha}  scores={scores}")</code></pre>' +
        'Notice how latency (alpha=0.0) makes Agent B win (longest wait time, Dmax=10), while throughput (alpha=0.5) shifts toward Agent C (deepest backlog, Qi=10). Balanced sits in between.<br><br>' +
        '<strong>Step 7 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'compute-load-scores',
      title: 'compute_load_scores()',
      content: '<p>This method is the <strong>heart of LOCO</strong>. It implements the load function and returns a score for every agent with pending work.</p>' +
        '<h3>The Implementation</h3>' +
        '<pre><code>def compute_load_scores(self) -> dict[str, float]:\n    """L(i) = alpha * (Qi / max Qj) + (1 - alpha) * (Dmax_i / max Dmax_j)"""\n    active = [a for a in self.agents.values() if a.tasks]\n    if not active:\n        return {}\n\n    q_vals = {a.agent_id: a.queue_depth_weighted for a in active}\n    d_vals = {a.agent_id: a.dmax for a in active}\n\n    max_q = max(q_vals.values()) or 1.0\n    max_d = max(d_vals.values()) or 1.0\n\n    return {\n        aid: self.alpha * (q_vals[aid] / max_q)\n             + (1 - self.alpha) * (d_vals[aid] / max_d)\n        for aid in q_vals\n    }</code></pre>' +
        '<h3>Step by Step</h3>' +
        '<ol><li><strong>Filter active agents:</strong> Only agents with non-empty task queues are scored. Idle agents are invisible.</li>' +
        '<li><strong>Collect Qi values:</strong> Each active agent\'s <code>queue_depth_weighted</code> (sum of task weights).</li>' +
        '<li><strong>Collect Dmax values:</strong> Each active agent\'s <code>dmax</code> (age of oldest task).</li>' +
        '<li><strong>Normalize:</strong> Divide by the max value (using <code>or 1.0</code> to avoid division by zero).</li>' +
        '<li><strong>Compute L(i):</strong> Weighted sum of normalized Qi and Dmax using alpha.</li></ol>' +
        '<h3>Example with Three Agents</h3>' +
        '<pre><code># Agent A: 3 tasks (weight 2.0 each) -> Qi=6, Dmax=15\n# Agent B: 1 task  (weight 5.0)      -> Qi=5, Dmax=3\n# Agent C: 4 tasks (weight 1.0 each) -> Qi=4, Dmax=25\n# alpha=0.25, max_q=6, max_d=25\n#\n# L(a) = 0.25*(6/6) + 0.75*(15/25) = 0.25 + 0.45  = 0.70\n# L(b) = 0.25*(5/6) + 0.75*(3/25)  = 0.208 + 0.09 = 0.298\n# L(c) = 0.25*(4/6) + 0.75*(25/25) = 0.167 + 0.75 = 0.917\n#\n# C wins: despite having the shallowest queue per task,\n# its Dmax=25 dominates at alpha=0.25.</code></pre>',
      summary: 'compute_load_scores() filters to active agents, normalizes their Qi and Dmax by dividing by the respective maximums, and returns alpha-weighted scores. Only agents with tasks are scored. Returns empty dict if all agents are idle.',
      mentalModel: 'compute_load_scores is like grading contestants in a two-category competition (backlog size and waiting time). Each contestant is scored relative to the best in each category, then the two scores are blended using alpha as the weight. The highest overall score wins.',
      mistakes: [
        'Expecting idle agents to appear in the scores -- agents with empty task queues return 0.0 for both Qi and dmax, and are filtered out entirely',
        'Forgetting the "or 1.0" guard -- when all Qi or Dmax values are 0, the code uses 1.0 as the divisor to avoid division by zero',
        'Misunderstanding normalization -- scores are relative to the current max, not to any fixed scale. If the highest Qi is 10, an agent with Qi=5 gets 0.5 for that term'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Write a hand-calculation function.</strong> This implements the same formula as <code>compute_load_scores()</code>:<br>' +
        '<pre><code>def hand_calc(agents_data, alpha):\n    """agents_data: list of (agent_id, Qi, Dmax) tuples"""\n    max_q = max(qi for _, qi, _ in agents_data) or 1.0\n    max_d = max(dmax for _, _, dmax in agents_data) or 1.0\n    return {\n        aid: alpha * (qi / max_q) + (1 - alpha) * (dmax / max_d)\n        for aid, qi, dmax in agents_data\n    }</code></pre>' +
        '<strong>Step 3 -- Define test data and compute by hand.</strong><br>' +
        '<pre><code># Three agents with known values:\n# Agent A: Qi=6 (3 tasks, weight 2.0 each), Dmax=15\n# Agent B: Qi=5 (1 task, weight 5.0),      Dmax=3\n# Agent C: Qi=4 (4 tasks, weight 1.0 each), Dmax=25\ndata = [("A", 6, 15), ("B", 5, 3), ("C", 4, 25)]\n\nfor alpha in [0.0, 0.25, 0.5]:\n    scores = hand_calc(data, alpha)\n    winner = max(scores, key=scores.get)\n    print(f"alpha={alpha}: {scores}  -> winner={winner}")</code></pre>' +
        'Predict the winners before running. At alpha=0.0, C wins (highest Dmax=25). At alpha=0.5, A becomes competitive (highest Qi=6).<br><br>' +
        '<strong>Step 4 -- Build the same scenario with real LOCO objects.</strong><br>' +
        '<pre><code>from loco import Agent, Task, LOCOScheduler\n\nagent_a = Agent(agent_id="A")\nagent_a.tasks = [Task(weight=2.0, age=15), Task(weight=2.0, age=10), Task(weight=2.0, age=5)]\n\nagent_b = Agent(agent_id="B")\nagent_b.tasks = [Task(weight=5.0, age=3)]\n\nagent_c = Agent(agent_id="C")\nagent_c.tasks = [Task(weight=1.0, age=25), Task(weight=1.0, age=20),\n                 Task(weight=1.0, age=15), Task(weight=1.0, age=10)]\n\nfor alpha in [0.0, 0.25, 0.5]:\n    s = LOCOScheduler([agent_a, agent_b, agent_c], alpha=alpha)\n    scores = s.compute_load_scores()\n    winner = max(scores, key=scores.get)\n    print(f"alpha={alpha}: {scores}  -> winner={winner}")</code></pre>' +
        'The scores from the real scheduler should match your hand calculations exactly. This proves <code>compute_load_scores()</code> implements the formula you computed by hand.<br><br>' +
        '<strong>Step 5 -- Verify edge case: all agents idle.</strong><br>' +
        '<pre><code>for agent in [agent_a, agent_b, agent_c]:\n    agent.tasks = []\n\ns = LOCOScheduler([agent_a, agent_b, agent_c], alpha=0.25)\nprint(f"Scores when all idle: {s.compute_load_scores()}")</code></pre>' +
        'The result should be an empty dict <code>{}</code>. Agents with no tasks are invisible to the scoring function.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'select-agent',
      title: 'select_agent() and Tie-Breaking',
      content: '<p>After computing scores, the scheduler needs to pick a winner. <code>select_agent()</code> handles this, including deterministic tie-breaking.</p>' +
        '<h3>The Implementation</h3>' +
        '<pre><code>def select_agent(self, scores: dict[str, float]) -> Agent | None:\n    """Highest score wins. Random tie-break (seeded for determinism)."""\n    if not scores:\n        return None\n    max_score = max(scores.values())\n    candidates = [\n        self.agents[aid] for aid, s in scores.items()\n        if s == max_score\n    ]\n    return self.rng.choice(candidates)</code></pre>' +
        '<h3>How Tie-Breaking Works</h3>' +
        '<p>When two or more agents have exactly the same L(i) score, the scheduler uses <code>self.rng.choice()</code> -- a seeded random selection. Because the RNG is seeded (via the <code>seed</code> parameter), the same tie always resolves the same way in tests.</p>' +
        '<p>Ties happen more often than you might expect:</p>' +
        '<ul><li>Two agents with identical queue depths and wait times</li><li>All agents have exactly one fresh task (Qi=1, Dmax=0 for all)</li><li>At alpha=0.0 when multiple agents share the same Dmax</li></ul>' +
        '<h3>Why Not Just Pick the First?</h3>' +
        '<p>Using dict iteration order would be implementation-dependent and unfair (agents registered earlier would always win ties). Seeded randomness ensures fairness while maintaining determinism for testing.</p>',
      summary: 'select_agent() picks the agent with the highest L(i) score. When agents tie, it uses a seeded random choice for deterministic but fair tie-breaking. Returns None if no agents have scores.',
      mentalModel: 'select_agent is like a photo finish in a race. If two runners cross at the exact same instant, you flip a (loaded, repeatable) coin to pick the winner rather than always giving it to the runner in lane 1.',
      mistakes: [
        'Assuming dict ordering determines tie-breaks -- ties use seeded random, not insertion order',
        'Forgetting to pass a seed to LOCOScheduler -- without a seed, tie-breaks are non-deterministic and tests become flaky',
        'Not handling the None return -- select_agent returns None when scores is empty (all agents idle). Always check for None before accessing the result'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create two agents with identical workloads.</strong> Same number of tasks, same weights, same ages -- guaranteed to produce a tie:<br>' +
        '<pre><code>from loco import Agent, Task, LOCOScheduler\n\ndef make_tied_agents():\n    a = Agent(agent_id="X")\n    a.tasks = [Task(weight=2.0, age=5), Task(weight=2.0, age=3)]\n    b = Agent(agent_id="Y")\n    b.tasks = [Task(weight=2.0, age=5), Task(weight=2.0, age=3)]\n    return a, b\n\nagent_x, agent_y = make_tied_agents()\ns = LOCOScheduler([agent_x, agent_y], alpha=0.25, seed=42)\nscores = s.compute_load_scores()\nprint(f"Scores: {scores}")</code></pre>' +
        'Both agents should have the exact same score (1.0), confirming a perfect tie.<br><br>' +
        '<strong>Step 3 -- Break the tie with select_agent().</strong><br>' +
        '<pre><code>winner = s.select_agent(scores)\nprint(f"Winner with seed=42: {winner.agent_id}")</code></pre>' +
        'One of them wins. Note which one -- with seed=42, the same agent will always win.<br><br>' +
        '<strong>Step 4 -- Try different seeds and verify determinism.</strong><br>' +
        '<pre><code>for seed in [42, 42, 42, 99, 99, 123]:\n    a, b = make_tied_agents()\n    s = LOCOScheduler([a, b], alpha=0.25, seed=seed)\n    scores = s.compute_load_scores()\n    winner = s.select_agent(scores)\n    print(f"seed={seed:>3}: winner={winner.agent_id}")</code></pre>' +
        'The same seed always produces the same winner (deterministic), but different seeds may produce different winners (fair). This is why tests must always set a seed -- without one, tie-breaks are random and tests become flaky.<br><br>' +
        '<strong>Step 5 -- Verify select_agent returns None when scores are empty.</strong><br>' +
        '<pre><code>result = s.select_agent({})\nprint(f"Empty scores result: {result}")</code></pre>' +
        'Returns <code>None</code>. Always check for None before accessing <code>.agent_id</code> on the result.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'step-method',
      title: 'The _step() Method',
      content: '<p>The <code>_step()</code> method runs one complete simulation tick. It is the main loop of the sync scheduler and is also used by <code>SyncTestScheduler</code> for deterministic testing.</p>' +
        '<h3>The Seven Phases</h3>' +
        '<pre><code>def _step(self, arrivals: dict[str, list[Task]] | None = None) -> StepResult:\n    # 1. Accept new task arrivals\n    if arrivals:\n        for agent_id, tasks in arrivals.items():\n            agent = self.get_agent(agent_id)\n            for task in tasks:\n                agent.tasks.append(task)\n\n    # 2. Compute load scores for all active agents\n    scores = self.compute_load_scores()\n\n    # 3. Select the winning agent (highest L(i))\n    selected = self.select_agent(scores)\n\n    # 4. Serve one task from the winner\n    served = selected.serve_oldest_task() if selected else None\n\n    # 5. Age all remaining waiting tasks by 1\n    for agent in self.agents.values():\n        for task in agent.tasks:\n            task.age += 1\n\n    # 6. Record history entry\n    self.history.append({...})\n\n    # 7. Increment tick counter\n    self.tick += 1\n\n    return StepResult(selected_agent=selected,\n                      served_task=served, scores=scores)</code></pre>' +
        '<h3>StepResult</h3>' +
        '<pre><code>@dataclass\nclass StepResult:\n    selected_agent: Agent | None  # Who won this tick\n    served_task: Task | None      # Which task was served\n    scores: dict[str, float]      # L(i) scores for all active agents</code></pre>' +
        '<h3>Arrivals</h3>' +
        '<p>The <code>arrivals</code> parameter lets you inject new tasks at the start of each tick. This is how you simulate dynamic workloads in scenarios:</p>' +
        '<pre><code># Tick 0: Agent A gets 5 tasks, Agent B gets 2\nresult = scheduler._step(arrivals={\n    "a": [Task(weight=1.0) for _ in range(5)],\n    "b": [Task(weight=2.0) for _ in range(2)],\n})\n\n# Tick 1: No new arrivals, just process existing\nresult = scheduler._step()</code></pre>' +
        '<h3>History</h3>' +
        '<p>Each tick appends a record to <code>self.history</code> (a deque with max length). The record includes tick number, scores, served agent/task, queue depths, and Dmax values. This is used for debugging and scenario analysis.</p>',
      summary: 'The _step() method runs one simulation tick: accept arrivals, score agents, select winner, serve a task, age all remaining tasks, record history, increment tick. Returns StepResult with the selected agent, served task, and scores.',
      mentalModel: '_step() is one round of a board game. First new players sit down (arrivals). Then the referee scores everyone (compute_load_scores). The best player takes their turn (serve_oldest_task). Everyone else waits one more round (age += 1). The scorekeeper records the round (history). Next round begins.',
      mistakes: [
        'Calling _step() directly in production code -- use AsyncLOCOScheduler.acquire() instead. _step() is for testing and scenario replay only',
        'Forgetting that aging happens AFTER serving -- the served task does not age, but all remaining tasks do',
        'Not checking StepResult.selected_agent for None -- when all agents are idle, no one is selected and no task is served'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create two unevenly loaded agents.</strong> We use <code>SyncTestScheduler</code> which exposes the public <code>step()</code> method (it wraps <code>LOCOScheduler._step()</code> internally):<br>' +
        '<pre><code>from loco.testing import SyncTestScheduler, mock_agent\n\nagents = [\n    mock_agent("light", pending_tasks=3),\n    mock_agent("heavy", pending_tasks=7),\n]\nscheduler = SyncTestScheduler(agents, alpha=0.5, seed=42)\nprint(f"Total tasks: {scheduler.total_tasks_remaining()}")</code></pre>' +
        'You should see 10 total tasks.<br><br>' +
        '<strong>Step 3 -- Step through and observe which agent gets served.</strong><br>' +
        '<pre><code>while scheduler.total_tasks_remaining() > 0:\n    result = scheduler.step()\n    if result.selected_agent:\n        aid = result.selected_agent.agent_id\n        task_age = result.served_task.age if result.served_task else 0\n        light_left = len(scheduler.get_agent("light").tasks)\n        heavy_left = len(scheduler.get_agent("heavy").tasks)\n        print(f"Tick {scheduler.tick:>2}: served={aid:>5}  "\n              f"task_age={task_age:>2}  "\n              f"light={light_left}  heavy={heavy_left}")</code></pre>' +
        'With alpha=0.5 (throughput), "heavy" (deeper backlog) gets served more often in early ticks. As its queue drains toward "light"\'s size, the balance shifts.<br><br>' +
        '<strong>Step 4 -- Run the same scenario with alpha=0.0 (latency).</strong><br>' +
        '<pre><code>agents2 = [\n    mock_agent("light", pending_tasks=3),\n    mock_agent("heavy", pending_tasks=7),\n]\nscheduler2 = SyncTestScheduler(agents2, alpha=0.0, seed=42)\n\nprint("\\nalpha=0.0 (latency mode):")\nwhile scheduler2.total_tasks_remaining() > 0:\n    result = scheduler2.step()\n    if result.selected_agent:\n        aid = result.selected_agent.agent_id\n        print(f"Tick {scheduler2.tick:>2}: served={aid:>5}")</code></pre>' +
        'With alpha=0.0, only Dmax matters. The service pattern should alternate more evenly -- whichever agent has waited longest gets the next turn, regardless of backlog size.<br><br>' +
        '<strong>Step 5 -- Compare the two runs.</strong> Look at the task_age column from Step 3. Each tick, ALL remaining tasks across both agents age by 1. A task submitted at tick 0 and served at tick 5 has age=5. This is the logical tick mechanism driving Dmax growth and preventing starvation.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    }
  ]
});
