window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'foundations',
  title: 'Foundations',
  topics: [
    {
      id: 'what-is-loco',
      title: 'What is LOCO-Agent',
      content: '<p><strong>LOCO-Agent</strong> (Load-Conscious Orchestration for Concurrent Operations) is a production-ready, async-first scheduling layer for multi-agent AI systems. It sits underneath any Python agent framework and decides which agent gets access to shared LLM resources next.</p>' +
        '<h3>The Problem It Solves</h3>' +
        '<p>Imagine you have 10 AI agents all trying to call the Claude API at the same time. Without coordination, you get rate limits, unfair resource distribution, and runaway costs. A naive queue (first-come-first-served) ignores urgency -- an agent that has been waiting for ages gets treated the same as one that just arrived.</p>' +
        '<p>LOCO-Agent solves this with a <strong>load-conscious scheduler</strong> that considers three factors when deciding who goes next: <strong>queue depth</strong> (how much work is waiting), <strong>wait time</strong> (how long the oldest task has been waiting), and <strong>task cost</strong> (how expensive the work is).</p>' +
        '<h3>Framework Agnostic</h3>' +
        '<p>LOCO-Agent works with any Python agent framework:</p>' +
        '<ul><li><strong>Anthropic</strong> (Claude API)</li><li><strong>OpenAI</strong> (GPT, Agents SDK)</li><li><strong>Google ADK</strong></li><li><strong>LangChain</strong></li><li><strong>CrewAI</strong></li><li><strong>AWS Bedrock</strong></li><li><strong>Azure / AutoGen</strong></li></ul>' +
        '<p>It has <strong>zero required dependencies</strong> -- the core scheduler is pure Python 3.10+. Framework adapters are optional.</p>' +
        '<h3>Three API Levels</h3>' +
        '<pre><code># Level 1: One-liner (convenience API)\nimport loco\nloco.configure(capacity=3)\nresponse = await loco.wrap(client.messages.create,\n    agent_id="analyst", weight=2.0, model="claude-sonnet-4-20250514",\n    messages=[...])\n\n# Level 2: Direct async (full control)\nasync with scheduler.acquire(agent_id="analyst"):\n    result = await api_call()\n\n# Level 3: Sync testing (deterministic)\nfrom loco.testing import SyncTestScheduler, mock_agent\nscheduler = SyncTestScheduler([mock_agent("a", 10)], alpha=0.25)\nresult = scheduler.step()</code></pre>',
      summary: 'LOCO-Agent is an async-first scheduling layer for multi-agent AI systems. It decides which agent gets access to shared LLM resources next based on queue depth, wait time, and task cost -- framework agnostic with zero required dependencies.',
      mentalModel: 'Think of LOCO-Agent as a smart traffic controller at a busy intersection. Instead of a simple stoplight (FIFO queue), it watches how many cars are backed up on each road, how long each car has been waiting, and whether it is a fire truck or a bicycle -- then dynamically decides who goes next.',
      mistakes: [
        'Thinking LOCO-Agent replaces your agent framework -- it sits underneath frameworks like LangChain or CrewAI, not instead of them',
        'Assuming you need all the adapters installed -- the core scheduler has zero dependencies; only install adapters for frameworks you actually use',
        'Treating it as a rate limiter -- LOCO is a fairness-aware scheduler, not just a concurrency limiter. A semaphore limits throughput; LOCO decides priority'
      ],
      exercise: 'Clone the loco-agent repo, install it with <code>pip install -e ".[dev]"</code>, and run <code>python examples/burst.py</code>. Read the output and observe which agents get served first and why. Then change the <code>optimize_for</code> parameter and see how behavior changes.'
    },
    {
      id: 'load-function',
      title: 'The Load Function',
      content: '<p>The <strong>load function</strong> is the central algorithm of LOCO-Agent. Every scheduling decision flows through this single formula:</p>' +
        '<pre><code>L(i) = alpha * (Qi / max Qj) + (1 - alpha) * (Dmax_i / max Dmax_j)</code></pre>' +
        '<p>This computes a score for each agent. The agent with the highest score gets the next resource slot.</p>' +
        '<h3>Breaking Down the Terms</h3>' +
        '<p><strong>Qi (Queue Depth Weighted)</strong> -- the sum of task weights in agent i\'s queue. An agent with three opus tasks (weight=5 each) has Qi=15. An agent with one haiku task (weight=1) has Qi=1. Higher Qi means more work is backed up.</p>' +
        '<p><strong>Dmax_i (Max Wait Time)</strong> -- the age of the oldest waiting task for agent i. This prevents starvation: even if an agent has a small queue, if its tasks have been waiting forever, Dmax grows and the agent eventually wins.</p>' +
        '<p><strong>Normalization</strong> -- both terms are divided by their maximum across all agents, keeping scores in [0, 1]. This ensures the two terms are comparable regardless of absolute magnitudes.</p>' +
        '<h3>The Actual Code</h3>' +
        '<pre><code>def compute_load_scores(self) -> dict[str, float]:\n    active = [a for a in self.agents.values() if a.tasks]\n    if not active:\n        return {}\n\n    q_vals = {a.agent_id: a.queue_depth_weighted for a in active}\n    d_vals = {a.agent_id: a.dmax for a in active}\n\n    max_q = max(q_vals.values()) or 1.0\n    max_d = max(d_vals.values()) or 1.0\n\n    return {\n        aid: self.alpha * (q_vals[aid] / max_q)\n             + (1 - self.alpha) * (d_vals[aid] / max_d)\n        for aid in q_vals\n    }</code></pre>' +
        '<h3>Hand Calculation Example</h3>' +
        '<p>Two agents, alpha=0.25:</p>' +
        '<ul><li>Agent A: 2 tasks (weight 2.0 each) → Qi=4, oldest task waited 10 ticks → Dmax=10</li><li>Agent B: 1 task (weight 2.0) → Qi=2, oldest task waited 20 ticks → Dmax=20</li></ul>' +
        '<pre><code># Normalization: max_q = 4, max_d = 20\n# L(a) = 0.25 * (4/4) + 0.75 * (10/20) = 0.25 + 0.375 = 0.625\n# L(b) = 0.25 * (2/4) + 0.75 * (20/20) = 0.125 + 0.75 = 0.875\n# B wins! Its longer wait time outweighs A\'s deeper backlog.</code></pre>',
      summary: 'The load function L(i) = alpha * (Qi/Qmax) + (1-alpha) * (Dmax_i/Dmax_max) scores each agent by combining normalized queue depth and max wait time. The highest-scoring agent gets the next resource slot.',
      mentalModel: 'The load function is like a two-factor scoring system for a hospital ER triage. One factor is how many patients are waiting (queue depth), the other is how long the sickest patient has been waiting (Dmax). Alpha controls whether you prioritize throughput (treat the biggest group) or fairness (treat whoever has waited longest).',
      mistakes: [
        'Forgetting that only agents with non-empty queues get scored -- an idle agent is invisible to the load function',
        'Confusing Qi with task count -- Qi is the SUM of task weights, not the number of tasks. Three opus tasks (weight=5) give Qi=15, not Qi=3',
        'Ignoring normalization -- both terms are divided by their max across agents, which means the absolute numbers do not matter, only relative differences'
      ],
      exercise: 'Open a Python REPL. Create three agents with different task counts and weights. Hand-calculate L(i) for each at alpha=0.0, 0.25, and 0.5. Verify your results match <code>LOCOScheduler.compute_load_scores()</code>. Notice how alpha shifts the winner.'
    },
    {
      id: 'logical-ticks',
      title: 'Logical Ticks',
      content: '<p>LOCO-Agent does not use wall-clock time. Instead, it uses <strong>logical ticks</strong> -- an internal counter that increments every time a unit of work completes.</p>' +
        '<h3>What Triggers a Tick</h3>' +
        '<p>Each time <code>release()</code> is called (a resource slot becomes available), the following happens:</p>' +
        '<ol><li>The <code>_logical_tick</code> counter increments by 1</li><li>All waiting tasks across ALL agents have their <code>age</code> incremented by 1</li><li>Scores are recomputed using the updated ages</li><li>The next waiter is granted the slot</li></ol>' +
        '<h3>Why Not Wall Clock?</h3>' +
        '<p>Consider two scenarios:</p>' +
        '<ul><li><strong>Heavy load:</strong> 50 agents, all resources busy. Tasks complete every 100ms. Ticks fire 10x/second -- priorities shift rapidly.</li><li><strong>Light load:</strong> 2 agents, plenty of capacity. Tasks complete every 5 seconds. Ticks fire slowly -- no need to shift priorities because there is no contention.</li></ul>' +
        '<p>With wall-clock time, you would need arbitrary time windows and risk over- or under-reacting. With logical ticks, <strong>priority only shifts when there is actual contention</strong> -- when real work completes and a slot opens.</p>' +
        '<h3>In the Sync Scheduler</h3>' +
        '<pre><code># In LOCOScheduler._step():\n# Age all remaining waiting tasks\nfor agent in self.agents.values():\n    for task in agent.tasks:\n        task.age += 1\n\nself.tick += 1</code></pre>' +
        '<h3>In the Async Scheduler</h3>' +
        '<pre><code># In AsyncLOCOScheduler._on_release():\nasync with self._lock:\n    self._logical_tick += 1\n    for agent in self.agents.values():\n        for task in agent.tasks:\n            task.age += 1\n    await self._grant_next_waiter()</code></pre>',
      summary: 'Logical ticks are driven by work completion, not wall time. Each release() increments the tick counter and ages all waiting tasks by 1. Under heavy load ticks fire fast; under light load they fire slowly. Priority shifts only when there is real contention.',
      mentalModel: 'Logical ticks are like rounds in a board game. The clock does not matter -- a new round starts whenever someone finishes their turn. If nobody is playing, the game pauses. If everyone is playing fast, rounds fly by. Tasks age one "round" at a time, not one "second" at a time.',
      mistakes: [
        'Thinking task.age is measured in seconds -- it is measured in logical ticks (units of work completed)',
        'Expecting ticks to fire at a constant rate -- they are driven by system load, not a timer',
        'Forgetting that ALL waiting tasks age on every tick, not just the tasks of the agent that was served -- this is how Dmax grows globally'
      ],
      exercise: 'Create a SyncTestScheduler with 3 agents (5, 3, and 1 pending tasks). Run <code>step()</code> manually 5 times and after each step, print the age of every remaining task and each agent\'s Dmax. Observe how ages accumulate differently for tasks that wait longer.'
    },
    {
      id: 'alpha-tradeoff',
      title: 'The Alpha Tradeoff',
      content: '<p><strong>Alpha</strong> is the single most important tuning parameter in LOCO. It controls the balance between throughput (draining deep backlogs) and latency (serving whoever has waited longest).</p>' +
        '<h3>The Three Presets</h3>' +
        '<pre><code>OPTIMIZE_FOR_ALPHA = {\n    "latency": 0.0,\n    "balanced": 0.25,\n    "throughput": 0.5,\n}</code></pre>' +
        '<p><strong>alpha=0.0 ("latency"):</strong> The load function becomes <code>L(i) = Dmax_i / max Dmax_j</code>. Only wait time matters. The agent whose oldest task has waited longest always wins. Maximum fairness.</p>' +
        '<p><strong>alpha=0.25 ("balanced"):</strong> The default. 25% weight on queue depth, 75% on wait time. Good balance of throughput and fairness. This is what most systems should use.</p>' +
        '<p><strong>alpha=0.5 ("throughput"):</strong> Equal weight on both terms. Deeper backlogs get more attention. Best for draining work quickly.</p>' +
        '<h3>The Danger Zone</h3>' +
        '<p><strong>CRITICAL:</strong> Alpha values >= 0.75 cause starvation. This was proven by Scenario 2 (fairness.py), which runs 10 agents over 500 ticks:</p>' +
        '<ul><li>alpha=0.25: Jain\'s fairness index >= 0.98 (excellent)</li><li>alpha=0.5: fairness still good, throughput slightly better</li><li>alpha >= 0.75: some agents are completely starved -- deep backlogs monopolize the resource</li></ul>' +
        '<p>The safe operating range is <strong>[0.0, 0.5]</strong>. The AdaptiveAlphaTuner enforces this range.</p>' +
        '<h3>Usage</h3>' +
        '<pre><code># Use the preset:\nscheduler = LOCOScheduler(agents, optimize_for="balanced")\n\n# Or set alpha directly:\nscheduler = LOCOScheduler(agents, alpha=0.3)\n\n# Cannot use both (raises ValueError):\nscheduler = LOCOScheduler(agents, alpha=0.3, optimize_for="balanced")  # ERROR</code></pre>',
      summary: 'Alpha controls the tradeoff between throughput (serving deep backlogs first, higher alpha) and latency/fairness (serving longest-waiting agents first, lower alpha). The safe range is [0.0, 0.5] -- alpha >= 0.75 causes starvation.',
      mentalModel: 'Alpha is like a dial on a radio between two stations. Turn it to 0.0 and you hear pure "fairness FM" -- serve whoever waited longest. Turn it to 0.5 and you hear equal parts "fairness" and "throughput" -- drain the biggest backlogs while still being fair. Past 0.5, the throughput signal drowns out fairness and some agents never get served.',
      mistakes: [
        'Setting alpha above 0.5 in production -- this is proven to cause starvation under sustained load',
        'Using alpha=0.0 when throughput matters -- pure latency mode ignores backlog depth entirely, which can leave large queues growing unboundedly',
        'Passing both alpha and optimize_for -- LOCOScheduler raises ValueError if you specify both. Pick one.',
        'Forgetting that the default is "balanced" (alpha=0.25) -- if you pass neither alpha nor optimize_for, you get 0.25'
      ],
      exercise: 'Run <code>python examples/fairness.py</code> and observe the Jain\'s fairness index at different alpha values. Then modify the script to test alpha=0.75 and alpha=1.0. Watch how service counts become increasingly uneven, proving the starvation threshold.'
    },
    {
      id: 'grant-time-scoring',
      title: 'Grant-Time Scoring',
      content: '<p>This is the most important design decision in LOCO, and the one most likely to confuse new contributors: <strong>waiters are re-scored when a slot becomes available, not when they request it</strong>.</p>' +
        '<h3>Why This Matters</h3>' +
        '<p>Consider this scenario:</p>' +
        '<ol><li>Tick 0: Agent A requests a slot. All slots are full. A registers as a waiter.</li><li>Tick 1: Agent B requests a slot. B also registers as a waiter.</li><li>Ticks 2-100: Both A and B wait. On each tick, their tasks age by 1.</li><li>Tick 101: A slot becomes available. Who gets it?</li></ol>' +
        '<p>In a <strong>naive FIFO system</strong>, A gets it because A arrived first. But what if B has 50 critical tasks backed up and A has just 1?</p>' +
        '<p>In <strong>LOCO</strong>, when the slot opens, ALL waiters are re-scored using the <strong>current</strong> L(i) values. B\'s Qi is much higher, and both agents\' Dmax values reflect their actual wait times at tick 101, not tick 0 or 1. The score reflects reality, not history.</p>' +
        '<h3>The Implementation</h3>' +
        '<pre><code># In AsyncLOCOScheduler._grant_next_waiter():\nasync def _grant_next_waiter(self) -> None:\n    if not self.resource._waiters or self.resource.available_slots == 0:\n        return\n\n    # Only score agents that are actually waiting\n    waiting_ids = set(self.resource._waiters.keys())\n    scores = self._scorer.compute_load_scores()\n    waiter_scores = {aid: s for aid, s in scores.items()\n                     if aid in waiting_ids}\n\n    if not waiter_scores:\n        return\n\n    # Grant to highest scorer\n    best_id = max(waiter_scores, key=waiter_scores.get)\n    await self.resource.grant(best_id)</code></pre>' +
        '<h3>Preventing Priority Inversion</h3>' +
        '<p>Grant-time scoring is what prevents <strong>priority inversion</strong> -- a situation where a low-priority task blocks a high-priority one. Because Dmax grows as tasks wait, any starved agent\'s score naturally climbs over time, guaranteeing it will eventually win a slot. No static priority levels needed.</p>',
      summary: 'LOCO re-scores ALL waiting agents when a resource slot becomes available, using their current queue depth and wait times. This prevents priority inversion -- scores reflect the present state, not the moment the request was made.',
      mentalModel: 'Grant-time scoring is like a hospital ER that re-triages every patient whenever a doctor becomes free. You do not keep your original triage score -- if your condition worsened while waiting, you move up. If someone more urgent arrived after you, they might go first. The score always reflects current reality.',
      mistakes: [
        'Assuming first-come-first-served ordering -- LOCO explicitly rejects FIFO in favor of grant-time re-scoring. Arrival order does not determine service order',
        'Thinking scores are computed once at request time -- scores are recomputed at grant time, which means they incorporate all the waiting that happened since the request',
        'Forgetting that only WAITING agents are scored for granting -- agents that already hold the resource or have no tasks are excluded from the grant decision'
      ],
      exercise: 'Write a test using SyncTestScheduler where Agent A arrives first with 1 task, and Agent B arrives later with 10 tasks. Run enough steps to show that B gets served before A (or more frequently than A) despite arriving later. Verify by checking the service_order in RunResult.'
    }
  ]
});
