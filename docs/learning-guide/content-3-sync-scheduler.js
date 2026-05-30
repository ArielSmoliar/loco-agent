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
      exercise: 'Create a LOCOScheduler with 3 agents, first with optimize_for="balanced", then with alpha=0.25. Verify that both produce the same scores for the same input. Try passing both and confirm the ValueError.'
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
      exercise: 'Write a function that takes a list of (Qi, Dmax) tuples and an alpha, and computes L(i) scores by hand. Compare your results against LOCOScheduler.compute_load_scores() with the same inputs to verify your understanding.'
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
      exercise: 'Create two agents with identical task distributions (same number of tasks, same weights, same ages). Run <code>compute_load_scores()</code> to confirm they tie, then call <code>select_agent()</code> multiple times with different seeds. Verify the winner changes with the seed but is consistent for a given seed.'
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
      exercise: 'Create a LOCOScheduler with 2 agents (3 and 7 tasks each). Call <code>_step()</code> in a loop until <code>total_tasks_remaining()</code> is 0. After each step, print the selected agent ID and the served task\'s age. Observe how the agent with more tasks gets served more often (at alpha=0.5) or how the pattern changes at alpha=0.0.'
    }
  ]
});
