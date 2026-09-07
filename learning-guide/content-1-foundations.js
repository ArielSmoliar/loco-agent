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
      exercise: '<strong>Step 1 -- Get the code.</strong> Open a terminal and clone the repository:<br>' +
        '<pre><code>git clone https://github.com/ArielSmoliar/loco-agent.git</code></pre>' +
        'Then enter the project directory:<br>' +
        '<pre><code>cd loco-agent</code></pre>' +
        'Verify you are in the right place -- you should see <code>pyproject.toml</code> listed:<br>' +
        '<pre><code>ls pyproject.toml</code></pre>' +
        'If you get "No such file", make sure you are inside the <code>loco-agent</code> folder that was created by the clone command.<br><br>' +
        '<strong>Step 2 -- Install dependencies.</strong> LOCO-Agent requires <strong>Python 3.10 or newer</strong>. Check your version first:<br>' +
        '<pre><code>python3 --version</code></pre>' +
        'If it shows 3.9 or older, install a newer Python from <a href="https://www.python.org/downloads/" target="_blank">python.org/downloads</a>.<br><br>' +
        '<strong>Mac users:</strong> After installing, <code>python3</code> may still point to the old system Python. Use the versioned command instead (e.g. <code>python3.14</code> or <code>python3.12</code> depending on what you installed):<br>' +
        '<pre><code># Check which versions are available:\nls /usr/local/bin/python3.*\n\n# Use the newest one (example with 3.14):\npython3.14 --version</code></pre>' +
        'Create a virtual environment using the new Python. Run each line one at a time:<br>' +
        '<pre><code># Replace python3.14 with your installed version if different:\npython3.14 -m venv .venv</code></pre>' +
        'Activate the virtual environment:<br>' +
        '<pre><code># Mac / Linux:\nsource .venv/bin/activate\n\n# Windows:\n.venv\\Scripts\\activate</code></pre>' +
        'Upgrade pip (required -- the version bundled with the venv is too old for this project):<br>' +
        '<pre><code>pip3 install --upgrade pip</code></pre>' +
        'Install the project:<br>' +
        '<pre><code>pip3 install -e ".[dev]"</code></pre>' +
        '<strong>Step 3 -- Run the burst example.</strong><br>' +
        '<pre><code>python3 examples/burst.py</code></pre>' +
        'You will see output showing service order and service counts. Look at the first 12 ticks -- notice that agents with more tasks (like <code>agent-7</code> with 8 tasks) tend to get served, but agents that have been waiting longer also get a turn. This is the load function balancing queue depth against wait time.<br><br>' +
        '<strong>Step 4 -- Change the scheduling strategy.</strong> Open <code>examples/burst.py</code> in any text editor. Find line 23:<br>' +
        '<pre><code>scheduler = AsyncLOCOScheduler(\n    agents, resource, optimize_for="balanced", seed=42,</code></pre>' +
        'Change <code>"balanced"</code> to <code>"latency"</code> and run the script again. Notice that service order becomes more round-robin -- the scheduler now prioritizes whichever agent has waited the longest, regardless of backlog size.<br><br>' +
        '<strong>Step 5 -- Try the opposite extreme.</strong> Change <code>optimize_for</code> to <code>"throughput"</code> and run again. Now agents with deeper backlogs (more tasks) dominate the service order -- the scheduler prioritizes draining large queues over fairness.<br><br>' +
        '<strong>What to compare:</strong> Look at the "Service order (first 12)" section across all three runs. With <code>"latency"</code> you will see more variety in agent names (fair turns). With <code>"throughput"</code> you will see heavy agents repeated more often (drain big queues first). <code>"balanced"</code> sits in between.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated, then start Python:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create three agents with different workloads.</strong> Type (or paste) the following into the REPL:<br>' +
        '<pre><code>from loco import Agent, Task, LOCOScheduler\n\n# Agent A: 3 tasks, weight 2.0 each (Qi = 6), oldest waited 5 ticks\nagent_a = Agent(agent_id="A")\nagent_a.tasks = [Task(weight=2.0, age=5), Task(weight=2.0, age=3), Task(weight=2.0, age=1)]\n\n# Agent B: 1 task, weight 1.0 (Qi = 1), oldest waited 20 ticks\nagent_b = Agent(agent_id="B")\nagent_b.tasks = [Task(weight=1.0, age=20)]\n\n# Agent C: 2 tasks, weight 5.0 each (Qi = 10), oldest waited 2 ticks\nagent_c = Agent(agent_id="C")\nagent_c.tasks = [Task(weight=5.0, age=2), Task(weight=5.0, age=1)]</code></pre>' +
        '<strong>Step 3 -- Hand-calculate L(i) before running the code.</strong> Write these down on paper or in a note:<br>' +
        '<pre><code># The values:\n#   Agent A: Qi=6,  Dmax=5\n#   Agent B: Qi=1,  Dmax=20\n#   Agent C: Qi=10, Dmax=2\n#\n# Normalization: max_q=10, max_d=20\n#\n# --- alpha=0.0 (pure latency) ---\n# L(A) = 0.0*(6/10) + 1.0*(5/20)  = 0 + 0.25  = 0.25\n# L(B) = 0.0*(1/10) + 1.0*(20/20) = 0 + 1.0   = 1.0   &lt;-- winner\n# L(C) = 0.0*(10/10)+ 1.0*(2/20)  = 0 + 0.1   = 0.1\n#\n# --- alpha=0.25 (balanced) ---\n# L(A) = 0.25*(6/10) + 0.75*(5/20)  = 0.15 + 0.1875 = 0.3375\n# L(B) = 0.25*(1/10) + 0.75*(20/20) = 0.025 + 0.75  = 0.775  &lt;-- winner\n# L(C) = 0.25*(10/10)+ 0.75*(2/20)  = 0.25 + 0.075  = 0.325\n#\n# --- alpha=0.5 (throughput) ---\n# L(A) = 0.5*(6/10) + 0.5*(5/20)  = 0.3 + 0.125 = 0.425\n# L(B) = 0.5*(1/10) + 0.5*(20/20) = 0.05 + 0.5  = 0.55   &lt;-- winner\n# L(C) = 0.5*(10/10)+ 0.5*(2/20)  = 0.5 + 0.05  = 0.55   &lt;-- tied!\n#\n# B wins at alpha=0.0 and 0.25. At alpha=0.5, C catches up and ties B.\n# Notice how C (deep backlog) gains score as alpha increases.</code></pre>' +
        '<strong>Step 4 -- Verify with the scheduler.</strong> Back in the REPL, create a scheduler for each alpha and compare:<br>' +
        '<pre><code># alpha = 0.0\ns = LOCOScheduler([agent_a, agent_b, agent_c], alpha=0.0)\nprint("alpha=0.0:", s.compute_load_scores())\n\n# alpha = 0.25\ns = LOCOScheduler([agent_a, agent_b, agent_c], alpha=0.25)\nprint("alpha=0.25:", s.compute_load_scores())\n\n# alpha = 0.5\ns = LOCOScheduler([agent_a, agent_b, agent_c], alpha=0.5)\nprint("alpha=0.5:", s.compute_load_scores())</code></pre>' +
        'The output should match your hand calculations exactly. Notice how Agent B (long wait, small queue) dominates at low alpha, but Agent C (short wait, huge backlog) climbs as alpha increases -- until they tie at alpha=0.5.<br><br>' +
        '<strong>Step 5 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D to leave Python.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create three agents with different task counts.</strong> Paste the following:<br>' +
        '<pre><code>from loco.testing import SyncTestScheduler, mock_agent\n\n# Agent X: 5 tasks, Agent Y: 3 tasks, Agent Z: 1 task\nagents = [\n    mock_agent("X", pending_tasks=5),\n    mock_agent("Y", pending_tasks=3),\n    mock_agent("Z", pending_tasks=1),\n]\nscheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)</code></pre>' +
        '<strong>Step 3 -- Run step() and inspect ages after each tick.</strong> Paste this helper function, then run the loop:<br>' +
        '<pre><code>def show_state(scheduler, tick_label):\n    print(f"\\n=== After {tick_label} ===")\n    for aid, agent in scheduler.agents.items():\n        if agent.tasks:\n            ages = [t.age for t in agent.tasks]\n            print(f"  {aid}: {len(agent.tasks)} tasks, ages={ages}, Dmax={agent.dmax}")\n        else:\n            print(f"  {aid}: no tasks remaining")\n\n# Show initial state (all ages start at 0)\nshow_state(scheduler, "initial state")\n\n# Run 5 steps, inspecting after each\nfor i in range(1, 6):\n    result = scheduler.step()\n    served = result.selected_agent.agent_id if result.selected_agent else "none"\n    print(f"\\nTick {i}: served {served}")\n    show_state(scheduler, f"tick {i}")</code></pre>' +
        '<strong>Step 4 -- Read the output.</strong> Look for these patterns:<br>' +
        '<ul>' +
        '<li>All tasks start with age=0. After each tick, every <em>remaining</em> task across ALL agents has its age incremented by 1 -- not just the served agent\'s tasks.</li>' +
        '<li>A task that has been waiting since tick 1 and is still in the queue at tick 5 will have age=4 (it aged once per tick for 4 ticks after the one where it was submitted).</li>' +
        '<li>Agent Z has only 1 task. Once it gets served, it disappears from scoring entirely. But before that, its single task\'s age grows every tick -- making its Dmax climb and eventually winning a slot even though its backlog is tiny.</li>' +
        '<li>Notice that Dmax is always the age of the oldest task, not the average. One old task is enough to boost the agent\'s score.</li>' +
        '</ul>' +
        '<strong>Step 5 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
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
      exercise: '<strong>Step 1 -- Run the fairness example.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated, then run:<br>' +
        '<pre><code>python3 examples/fairness.py</code></pre>' +
        'You will see a table with one row per alpha value (0.0, 0.25, 0.5, 0.75, 1.0). Each row shows the Jain\'s fairness index, minimum completions, starved agent count, and average wait times for high-load vs low-load agents.<br><br>' +
        '<strong>Step 2 -- Read the output.</strong> Focus on these columns:<br>' +
        '<ul>' +
        '<li><strong>Jain\'s fairness index</strong> -- 1.0 means perfectly fair (all agents wait equally). Lower values mean some agents are favored over others.</li>' +
        '<li><strong>starved</strong> -- how many agents completed zero tasks. At alpha=0.0 and 0.25 this should be 0. At alpha=0.75 or 1.0, you may see agents that never got served at all.</li>' +
        '<li><strong>wait high / wait low</strong> -- average wait time for the high-load group (agents 0-4, more tasks arriving) vs the low-load group (agents 5-9, fewer tasks). Watch how the gap changes as alpha increases.</li>' +
        '</ul>' +
        '<strong>Step 3 -- Compare the safe zone vs the danger zone.</strong> You should see a pattern like this:<br>' +
        '<ul>' +
        '<li><strong>alpha=0.0:</strong> Fairness is near-perfect (close to 1.0). The scheduler only cares about wait time, so every agent gets a turn.</li>' +
        '<li><strong>alpha=0.25:</strong> Still very fair (>= 0.98). This is the recommended default -- good balance of fairness and throughput.</li>' +
        '<li><strong>alpha=0.5:</strong> Fairness starts dropping. High-load agents get more attention because their queue depth is weighted equally with wait time.</li>' +
        '<li><strong>alpha=0.75:</strong> Danger zone. Low-load agents may starve -- they have small queues that can never compete with the high-load agents\' deep backlogs.</li>' +
        '<li><strong>alpha=1.0:</strong> Pure queue-depth mode. Wait time is completely ignored. Some agents may get zero service.</li>' +
        '</ul>' +
        '<strong>Step 4 -- Experiment.</strong> Open <code>examples/fairness.py</code> in a text editor. Try changing these values and re-running:<br>' +
        '<ul>' +
        '<li>Change <code>N_TICKS = 500</code> (line 18) to <code>1000</code> -- does starvation get worse with more time?</li>' +
        '<li>Change <code>N_AGENTS = 10</code> (line 17) to <code>20</code> and adjust <code>ARRIVAL_RATES</code> (line 19) to <code>[0.4] * 10 + [0.1] * 10</code> -- does more contention make the alpha threshold sharper?</li>' +
        '</ul>' +
        '<strong>Key takeaway:</strong> The safe operating range for alpha is [0.0, 0.5]. Anything above 0.5 risks starvation under sustained load. The default <code>optimize_for="balanced"</code> (alpha=0.25) is the right choice for most systems.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Set up a scenario where Agent A arrives first.</strong> We will create two agents but only give tasks to Agent A initially. Agent B will arrive later with a much bigger backlog:<br>' +
        '<pre><code>from loco.testing import SyncTestScheduler, mock_agent\nfrom loco.task import Task\n\n# Both agents start empty\nagent_a = mock_agent("A", pending_tasks=0)\nagent_b = mock_agent("B", pending_tasks=0)\n\nscheduler = SyncTestScheduler([agent_a, agent_b], alpha=0.25, seed=42)</code></pre>' +
        '<strong>Step 3 -- Tick 1: Agent A arrives with 1 task.</strong> We use the <code>arrivals</code> parameter to submit tasks at a specific tick:<br>' +
        '<pre><code># Agent A arrives first with 1 task\nresult = scheduler.step(arrivals={"A": [Task(weight=1.0)]})\nprint(f"Tick 1: served {result.selected_agent.agent_id if result.selected_agent else \'none\'}")\nprint(f"  A tasks remaining: {len(scheduler.get_agent(\'A\').tasks)}")\nprint(f"  B tasks remaining: {len(scheduler.get_agent(\'B\').tasks)}")</code></pre>' +
        'A is the only agent with work, so A gets served. Makes sense -- no contention yet.<br><br>' +
        '<strong>Step 4 -- Tick 2: Agent B arrives later with 10 tasks.</strong> Now B shows up with a much heavier workload:<br>' +
        '<pre><code># Agent B arrives later with 10 tasks\nresult = scheduler.step(arrivals={"B": [Task(weight=1.0) for _ in range(10)]})\nprint(f"\\nTick 2: served {result.selected_agent.agent_id}")\nprint(f"  Scores: {result.scores}")</code></pre>' +
        'Even though A arrived first, B should win this tick because B has a much deeper backlog (Qi=10 vs Qi=0). The scores are computed <em>now</em>, not when the agents first appeared.<br><br>' +
        '<strong>Step 5 -- Run the remaining ticks and check service order.</strong> Let the scheduler drain all tasks and see who got served in what order:<br>' +
        '<pre><code># Give A one more task so it stays in the game\nscheduler.add_tasks("A", [Task(weight=1.0)])\n\n# Run until all tasks are done\nservice_order = []\nwhile scheduler.total_tasks_remaining() > 0:\n    result = scheduler.step()\n    if result.selected_agent:\n        service_order.append(result.selected_agent.agent_id)\n\nprint(f"\\nFull service order: {service_order}")\nprint(f"A served: {service_order.count(\'A\')} times")\nprint(f"B served: {service_order.count(\'B\')} times")</code></pre>' +
        '<strong>Step 6 -- Read the results.</strong> Look for these patterns:<br>' +
        '<ul>' +
        '<li>B gets served much more frequently than A, even though A arrived first. In a FIFO system, A would always go first -- LOCO does not work that way.</li>' +
        '<li>B\'s 10 tasks give it a higher Qi, so it dominates the queue depth term. But A\'s tasks age over time, so A still gets a turn eventually -- it is not completely starved.</li>' +
        '<li>This is grant-time scoring in action: every time a slot opens, ALL agents are re-scored using their <em>current</em> Qi and Dmax. Arrival order is irrelevant.</li>' +
        '</ul>' +
        '<strong>Step 7 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    }
  ]
});
