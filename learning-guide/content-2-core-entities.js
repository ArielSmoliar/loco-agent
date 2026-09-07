window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'core-entities',
  title: 'Core Entities',
  topics: [
    {
      id: 'agent-entity',
      title: 'The Agent Entity',
      content: '<p>The <strong>Agent</strong> is a dataclass in <code>loco/agent.py</code> that represents a task-holding entity competing for shared resources. Each agent has a queue of pending tasks and a record of completed tasks.</p>' +
        '<h3>Fields</h3>' +
        '<pre><code>@dataclass\nclass Agent:\n    agent_id: str           # Unique identifier\n    name: str = ""          # Human-readable name (optional)\n    agent_type: str = "default"  # Category (e.g., "scheduled", "webhook")\n    tasks: list[Task] = field(default_factory=list)  # Pending queue\n    completed_tasks: list[Task] = field(default_factory=list)  # Done</code></pre>' +
        '<h3>Key Properties</h3>' +
        '<p>The scheduler uses two properties to compute L(i):</p>' +
        '<pre><code>@property\ndef queue_depth_weighted(self) -> float:\n    """Qi: sum of task weights in queue."""\n    return sum(t.weight for t in self.tasks)\n\n@property\ndef dmax(self) -> float:\n    """Dmax_i: age of the oldest waiting task."""\n    if not self.tasks:\n        return 0.0\n    return float(max(t.age for t in self.tasks))</code></pre>' +
        '<p><code>queue_depth_weighted</code> (Qi) is NOT the number of tasks -- it is the sum of their weights. Three opus tasks (weight=5) gives Qi=15.</p>' +
        '<p><code>dmax</code> returns 0.0 if the queue is empty, which effectively excludes idle agents from scoring.</p>' +
        '<h3>serve_oldest_task()</h3>' +
        '<pre><code>def serve_oldest_task(self) -> Task | None:\n    """Remove and return the task with the highest age."""\n    if not self.tasks:\n        return None\n    oldest = max(self.tasks, key=lambda t: t.age)\n    self.tasks.remove(oldest)\n    self.completed_tasks.append(oldest)\n    return oldest</code></pre>' +
        '<p>This method always serves the OLDEST task (highest age), not the first in the list. It moves the task from <code>tasks</code> to <code>completed_tasks</code> for metrics tracking.</p>',
      summary: 'An Agent is a dataclass with a task queue (tasks) and completion record (completed_tasks). The scheduler reads queue_depth_weighted (Qi) and dmax (Dmax_i) to score it. serve_oldest_task() dequeues the task that waited longest.',
      mentalModel: 'An Agent is like a customer at a deli counter holding numbered tickets. The tickets are tasks, each with a weight (how much meat to slice). queue_depth_weighted is the total pounds of meat they need. dmax is how long their first ticket has been waiting. The agent is the customer, not the person behind the counter.',
      mistakes: [
        'Confusing queue_depth_weighted (Qi) with len(tasks) -- Qi is the SUM of weights, not the count. An agent with one task of weight=5 has Qi=5, not Qi=1',
        'Assuming serve_oldest_task returns the first task in the list -- it returns the task with the highest age, which may be anywhere in the list',
        'Forgetting that dmax returns 0.0 for empty queues -- this effectively excludes idle agents from the load function'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create an Agent and add 5 tasks with different weights and ages.</strong><br>' +
        '<pre><code>from loco import Agent, Task\n\nagent = Agent(agent_id="my-agent", name="Test Agent")\n\n# Add 5 tasks with different weights and ages\nagent.tasks = [\n    Task(task_id="t1", weight=1.0, age=3),   # cheap task, waited 3 ticks\n    Task(task_id="t2", weight=5.0, age=10),  # expensive task, waited 10 ticks\n    Task(task_id="t3", weight=2.0, age=1),   # medium task, waited 1 tick\n    Task(task_id="t4", weight=5.0, age=7),   # expensive task, waited 7 ticks\n    Task(task_id="t5", weight=1.0, age=0),   # cheap task, just arrived\n]</code></pre>' +
        '<strong>Step 3 -- Check queue_depth_weighted (Qi) and dmax.</strong><br>' +
        '<pre><code># Qi = sum of all weights: 1.0 + 5.0 + 2.0 + 5.0 + 1.0 = 14.0\nprint(f"Qi (queue_depth_weighted): {agent.queue_depth_weighted}")\n\n# Dmax = age of the oldest task: max(3, 10, 1, 7, 0) = 10\nprint(f"Dmax: {agent.dmax}")\n\n# Note: Qi is NOT the task count (5). It is the SUM of weights.\nprint(f"Task count: {len(agent.tasks)}")  # 5 -- different from Qi!</code></pre>' +
        'Verify that Qi is 14.0 (not 5) and Dmax is 10 (the age of task t2).<br><br>' +
        '<strong>Step 4 -- Serve the oldest task and see what happens.</strong><br>' +
        '<pre><code># serve_oldest_task() removes the task with the HIGHEST age\nserved = agent.serve_oldest_task()\nprint(f"\\nFirst served: {served.task_id}, weight={served.weight}, age={served.age}")\nprint(f"Tasks remaining: {len(agent.tasks)}")\nprint(f"Completed tasks: {len(agent.completed_tasks)}")\nprint(f"New Qi: {agent.queue_depth_weighted}")   # 14.0 - 5.0 = 9.0\nprint(f"New Dmax: {agent.dmax}")                  # next oldest is age=7</code></pre>' +
        'Task t2 (age=10) should be served first -- it waited the longest. It moves from <code>tasks</code> to <code>completed_tasks</code>. Qi drops from 14.0 to 9.0 because t2 had weight=5.0.<br><br>' +
        '<strong>Step 5 -- Serve again and verify the pattern.</strong><br>' +
        '<pre><code>served2 = agent.serve_oldest_task()\nprint(f"\\nSecond served: {served2.task_id}, weight={served2.weight}, age={served2.age}")\nprint(f"Tasks remaining: {len(agent.tasks)}")\nprint(f"Completed tasks: {len(agent.completed_tasks)}")\nprint(f"New Qi: {agent.queue_depth_weighted}")   # 9.0 - 5.0 = 4.0\nprint(f"New Dmax: {agent.dmax}")                  # next oldest is age=3</code></pre>' +
        'Task t4 (age=7) should be served second. Now Qi is 4.0 and Dmax is 3. Notice that serve_oldest_task always picks by highest age, not by position in the list or by weight.<br><br>' +
        '<strong>Step 6 -- Inspect the completed_tasks list.</strong><br>' +
        '<pre><code>print("\\nCompleted tasks:")\nfor t in agent.completed_tasks:\n    print(f"  {t.task_id}: weight={t.weight}, age={t.age}")\n\nprint("\\nRemaining tasks:")\nfor t in agent.tasks:\n    print(f"  {t.task_id}: weight={t.weight}, age={t.age}")</code></pre>' +
        'You should see t2 and t4 in completed_tasks, and t1, t3, t5 still in tasks. The Agent keeps a full record of everything it has processed.<br><br>' +
        '<strong>Step 7 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'task-entity',
      title: 'The Task Entity',
      content: '<p>The <strong>Task</strong> is the unit of work in LOCO-Agent, defined in <code>loco/task.py</code>.</p>' +
        '<h3>Fields</h3>' +
        '<pre><code>@dataclass\nclass Task:\n    task_id: str = field(default_factory=lambda: uuid4().hex[:12])\n    weight: float = 1.0         # Cost proxy (>= 1.0)\n    arrival_tick: int = 0       # Tick when created\n    age: int = 0                # Ticks spent waiting\n    task_type: str = "default"  # Category (e.g., "llm_call")\n    labels: dict[str, SecurityLabel] | None = None  # Security metadata\n    session_id: str | None = None  # For cost attribution</code></pre>' +
        '<h3>Weight: The Cost Proxy</h3>' +
        '<p>Weight is a <strong>relative cost proxy</strong>, not dollars or tokens. It must be >= 1.0 (enforced in <code>__post_init__</code>):</p>' +
        '<pre><code>def __post_init__(self) -> None:\n    if self.weight < 1.0:\n        raise ValueError(f"Task weight must be >= 1.0, got {self.weight}")</code></pre>' +
        '<p>Typical weights by model tier:</p>' +
        '<ul><li><strong>1.0:</strong> Haiku, gpt-4o-mini, Gemini Flash (cheap, fast)</li><li><strong>2.0:</strong> Sonnet, gpt-4o, Gemini Pro (medium)</li><li><strong>5.0:</strong> Opus, o1 (expensive, powerful)</li></ul>' +
        '<p>The scheduler normalizes weights across agents, so the exact numbers matter less than the relative ratios. Opus being 5x the weight of haiku means the scheduler "knows" it costs 5x more.</p>' +
        '<h3>Who Assigns the Weight?</h3>' +
        '<p>It depends on how you use LOCO-Agent:</p>' +
        '<ul><li><strong>With an adapter</strong> (Anthropic, OpenAI, Google ADK, etc.) -- the adapter assigns weight automatically based on the model name. For example, the Anthropic adapter has a built-in mapping: <code>opus=5.0</code>, <code>sonnet=2.0</code>, <code>haiku=1.0</code>. It can also scale by input token count. You never need to set weight manually.</li>' +
        '<li><strong>Without an adapter</strong> (direct scheduler API) -- you set <code>weight</code> yourself when creating a <code>Task(weight=2.0)</code>. Use the model tier table above as a guide.</li></ul>' +
        '<p>In most real-world usage, the adapter handles weight assignment so you do not have to think about it.</p>' +
        '<h3>Age: The Waiting Counter</h3>' +
        '<p><code>age</code> starts at 0 and is incremented by the scheduler on each logical tick. You never set age manually -- the scheduler manages it. Age drives the Dmax term in the load function, preventing starvation.</p>' +
        '<h3>task_id: Auto-Generated</h3>' +
        '<p>By default, task_id is a random 12-character hex string from uuid4. The LOCOScheduler also has a <code>new_task()</code> method that uses auto-incremented integer IDs for deterministic testing.</p>',
      summary: 'A Task is a unit of work with a weight (cost proxy, >= 1.0), an age (ticks waited, managed by scheduler), and optional metadata like security labels and session IDs. Weight represents relative cost: haiku=1, sonnet=2, opus=5.',
      mentalModel: 'A Task is like a package at a shipping center. The weight is the shipping cost (heavier = more expensive), the age is how many days it has been sitting on the shelf, and the label says what security clearance you need to handle it. The shipping center (scheduler) tracks the age automatically.',
      mistakes: [
        'Setting weight below 1.0 -- this raises ValueError. The minimum is 1.0, representing the cheapest possible task',
        'Manually incrementing task.age -- the scheduler does this automatically on each logical tick. If you set age manually, the scheduling math breaks',
        'Using weight as an exact dollar cost -- weight is a relative proxy for scheduling priority, not a billing amount. 5.0 means "5x more expensive than the baseline," not "$5"'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Try creating an invalid Task.</strong> Weight must be >= 1.0. See what happens when you break that rule:<br>' +
        '<pre><code>from loco import Agent, Task\n\ntry:\n    bad_task = Task(weight=0.5)\nexcept ValueError as e:\n    print(f"Error: {e}")</code></pre>' +
        'You should see: <code>Task weight must be >= 1.0, got 0.5</code>. This guardrail prevents accidentally undervaluing a task.<br><br>' +
        '<strong>Step 3 -- Create three valid tasks representing different model tiers.</strong><br>' +
        '<pre><code># Simulate three model tiers:\nhaiku_task = Task(task_id="haiku-1", weight=1.0, task_type="llm_call")\nsonnet_task = Task(task_id="sonnet-1", weight=2.0, task_type="llm_call")\nopus_task = Task(task_id="opus-1", weight=5.0, task_type="llm_call")\n\nprint(f"Haiku weight:  {haiku_task.weight}")\nprint(f"Sonnet weight: {sonnet_task.weight}")\nprint(f"Opus weight:   {opus_task.weight}")</code></pre>' +
        '<strong>Step 4 -- Add them to an Agent and check queue_depth_weighted.</strong><br>' +
        '<pre><code>agent = Agent(agent_id="test-agent")\nagent.tasks = [haiku_task, sonnet_task, opus_task]\n\n# Qi = sum of weights: 1.0 + 2.0 + 5.0 = 8.0\nprint(f"\\nQi (queue_depth_weighted): {agent.queue_depth_weighted}")  # 8.0\nprint(f"Task count: {len(agent.tasks)}")                          # 3\nprint(f"\\nQi is {agent.queue_depth_weighted}, NOT {len(agent.tasks)}")</code></pre>' +
        'Qi is 8.0 -- the sum of weights, not the number of tasks (3). An agent with one opus task (Qi=5.0) has more scheduling weight than an agent with four haiku tasks (Qi=4.0).<br><br>' +
        '<strong>Step 5 -- See how adapters assign weight automatically.</strong> You do not need an API key for this -- just look at the estimate_weight function:<br>' +
        '<pre><code>from loco.adapters.anthropic import estimate_weight\n\n# The adapter maps model names to weights:\nprint(f"\\nAuto-assigned weights:")\nprint(f"  claude-haiku-4-5:  {estimate_weight(\'claude-haiku-4-5-20251001\')}")\nprint(f"  claude-sonnet-4:   {estimate_weight(\'claude-sonnet-4-20250514\')}")\nprint(f"  claude-opus-4:     {estimate_weight(\'claude-opus-4-20250514\')}")\nprint(f"  unknown-model:     {estimate_weight(\'some-new-model\')}")  # defaults to 2.0</code></pre>' +
        'When you use an adapter, you never set weight manually -- it looks up the model name and assigns the right value. Unknown models default to 2.0 (sonnet-tier).<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'shared-resource',
      title: 'SharedResource',
      content: '<p>The <strong>SharedResource</strong> in <code>loco/resource.py</code> represents a capacity-bounded shared resource (like an LLM API with a concurrency limit). Agents compete for slots via acquire/release.</p>' +
        '<h3>Fields and Properties</h3>' +
        '<pre><code>@dataclass\nclass SharedResource:\n    name: str              # e.g., "llm_api"\n    capacity: int = 1      # Max concurrent holders (>= 1)\n\n# Properties:\n    utilization -> float   # holders / capacity [0.0, 1.0]\n    available_slots -> int # capacity - total_holds\n    holder_count -> int    # active holds\n    waiter_count -> int    # agents waiting for a slot</code></pre>' +
        '<h3>Key Methods</h3>' +
        '<p><strong>try_acquire(agent_id) -> bool</strong> -- Non-blocking. Returns True if a slot was available and granted immediately.</p>' +
        '<p><strong>wait_for_slot(agent_id)</strong> -- Registers as a waiter and blocks (via asyncio.Event) until granted. The scheduler calls <code>grant()</code> to wake the waiter.</p>' +
        '<p><strong>grant(agent_id)</strong> -- Wakes a specific waiting agent. Called by the scheduler after re-scoring all waiters. This is the mechanism for grant-time scoring.</p>' +
        '<p><strong>release(agent_id)</strong> -- Frees a slot. Returns silently if the agent was not holding.</p>' +
        '<p><strong>held_by(agent_id)</strong> -- Async context manager that ensures release on exit (including exceptions):</p>' +
        '<pre><code>@asynccontextmanager\nasync def held_by(self, agent_id: str) -> AsyncIterator[None]:\n    try:\n        yield\n    finally:\n        await self.release(agent_id)</code></pre>' +
        '<h3>Multiple Holds Per Agent</h3>' +
        '<p>The same agent_id can hold multiple slots simultaneously and have multiple concurrent waiters. Internally, <code>_hold_counts</code> is a dict tracking per-agent hold counts, and <code>_waiters</code> maps each agent to a list of asyncio.Event objects.</p>',
      summary: 'SharedResource is a capacity-bounded pool of slots. Agents try_acquire for immediate access or wait_for_slot to block. The scheduler calls grant() to wake the highest-priority waiter after re-scoring. release() frees slots. Multiple concurrent holds per agent are supported.',
      mentalModel: 'A SharedResource is like a parking garage with a fixed number of spaces. try_acquire is driving in -- if there is a space, you park immediately. wait_for_slot is joining a queue outside. grant is the attendant waving in a specific car (not first-come-first-served). release is driving out, freeing a space.',
      mistakes: [
        'Forgetting that grant() wakes a SPECIFIC agent, not the next in line -- the scheduler decides who to grant based on L(i) scores, then calls grant with that agent_id',
        'Assuming capacity must be 1 -- you can set capacity to any value >= 1. A value of 5 means 5 agents can hold the resource concurrently',
        'Not using held_by() context manager -- if your code raises an exception between acquire and release, the slot leaks. held_by() ensures cleanup'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create a SharedResource with capacity=2.</strong> This means two agents can hold the resource at the same time:<br>' +
        '<pre><code>import asyncio\nfrom loco import SharedResource\n\nresource = SharedResource(name="llm_api", capacity=2)\n\nprint(f"Capacity: {resource.capacity}")\nprint(f"Available slots: {resource.available_slots}")  # 2\nprint(f"Utilization: {resource.utilization}")           # 0.0</code></pre>' +
        '<strong>Step 3 -- Have 3 agents try to acquire slots.</strong> Since <code>try_acquire</code> is async, we wrap it in <code>asyncio.run()</code>:<br>' +
        '<pre><code>async def test_acquire():\n    # Agent 1 tries to acquire -- should succeed (2 slots available)\n    result1 = await resource.try_acquire("agent-1")\n    print(f"\\nagent-1 acquired: {result1}")       # True\n    print(f"Available slots: {resource.available_slots}")  # 1\n\n    # Agent 2 tries to acquire -- should succeed (1 slot left)\n    result2 = await resource.try_acquire("agent-2")\n    print(f"\\nagent-2 acquired: {result2}")       # True\n    print(f"Available slots: {resource.available_slots}")  # 0\n    print(f"Utilization: {resource.utilization}")  # 1.0 (full!)\n\n    # Agent 3 tries to acquire -- should FAIL (no slots left)\n    result3 = await resource.try_acquire("agent-3")\n    print(f"\\nagent-3 acquired: {result3}")       # False\n    print(f"Holder count: {resource.holder_count}")  # 2\n\nasyncio.run(test_acquire())</code></pre>' +
        'The first two agents get in, the third is rejected. The resource is at 100% utilization.<br><br>' +
        '<strong>Step 4 -- Release a slot and check availability.</strong> We need a fresh resource since <code>asyncio.run()</code> closes the event loop. Paste this complete example:<br>' +
        '<pre><code>async def test_release():\n    res = SharedResource(name="llm_api", capacity=2)\n\n    # Fill both slots\n    await res.try_acquire("agent-1")\n    await res.try_acquire("agent-2")\n    print(f"Before release:")\n    print(f"  Available slots: {res.available_slots}")  # 0\n    print(f"  Utilization: {res.utilization}")          # 1.0\n    print(f"  agent-1 holding: {res.is_holding(\'agent-1\')}")  # True\n\n    # Release agent-1\n    await res.release("agent-1")\n    print(f"\\nAfter releasing agent-1:")\n    print(f"  Available slots: {res.available_slots}")  # 1\n    print(f"  Utilization: {res.utilization}")          # 0.5\n    print(f"  agent-1 holding: {res.is_holding(\'agent-1\')}")  # False\n\n    # Now agent-3 can get in\n    result = await res.try_acquire("agent-3")\n    print(f"\\nagent-3 acquired after release: {result}")  # True\n    print(f"  Available slots: {res.available_slots}")     # 0\n\nasyncio.run(test_release())</code></pre>' +
        'After releasing agent-1, a slot opens up and agent-3 can acquire it.<br><br>' +
        '<strong>Step 5 -- Try creating an invalid resource.</strong><br>' +
        '<pre><code>try:\n    bad = SharedResource(name="broken", capacity=0)\nexcept ValueError as e:\n    print(f"\\nError: {e}")  # Capacity must be >= 1</code></pre>' +
        'Capacity must be at least 1 -- a resource with zero capacity would be useless.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'entity-connections',
      title: 'How Entities Connect',
      content: '<p>Understanding how Agent, Task, and SharedResource interact is key to understanding LOCO\'s architecture. Here is the complete lifecycle of a request:</p>' +
        '<h3>The Full Flow</h3>' +
        '<ol><li><strong>Submit:</strong> A task is created and added to an agent\'s queue<br><code>task = Task(weight=2.0)</code><br><code>agent.tasks.append(task)</code></li>' +
        '<li><strong>Acquire:</strong> The agent requests a resource slot<br><code>granted = await resource.try_acquire(agent_id)</code><br>If no slot available, register as waiter: <code>await resource.wait_for_slot(agent_id)</code></li>' +
        '<li><strong>Score:</strong> When a slot opens, the scheduler computes L(i) for all waiters using their current Qi and Dmax<br><code>scores = scorer.compute_load_scores()</code></li>' +
        '<li><strong>Grant:</strong> The highest-scoring waiter gets the slot<br><code>await resource.grant(best_id)</code></li>' +
        '<li><strong>Execute:</strong> The agent makes its API call while holding the resource</li>' +
        '<li><strong>Dequeue:</strong> The served task moves from tasks to completed_tasks<br><code>agent.serve_oldest_task()</code></li>' +
        '<li><strong>Release:</strong> The resource slot is freed<br><code>await resource.release(agent_id)</code></li>' +
        '<li><strong>Age & Re-grant:</strong> All remaining tasks age by 1, scores recompute, next waiter is granted</li></ol>' +
        '<h3>The Three Layers</h3>' +
        '<pre><code>LOCOScheduler          # Pure math: compute_load_scores(), select_agent()\n    |\n    v\nAsyncLOCOScheduler     # Async I/O: acquire(), release(), submit_task()\n    |\n    v\nAdapters               # Framework glue: AnthropicAdapter, OpenAIAdapter, etc.</code></pre>' +
        '<p>Each layer has a clear boundary:</p>' +
        '<ul><li><strong>LOCOScheduler</strong> knows about Agents and Tasks but nothing about I/O or async</li><li><strong>AsyncLOCOScheduler</strong> wraps LOCOScheduler with SharedResource and async primitives</li><li><strong>Adapters</strong> wrap AsyncLOCOScheduler with framework-specific API calls and weight estimation</li></ul>',
      summary: 'Tasks live in Agent queues. Agents compete for SharedResource slots. The scheduler scores agents by Qi and Dmax, grants to the highest scorer, and on release ages all tasks and re-grants. The architecture has three layers: LOCOScheduler (math), AsyncLOCOScheduler (async I/O), and Adapters (framework glue).',
      mentalModel: 'The three entities form a food chain: Tasks are fish in a pond (the Agent\'s queue). Agents are fishermen competing for a single dock (the SharedResource). The scheduler is the harbor master who decides which fisherman gets the dock next based on how many fish they have waiting and how long they have been standing in line.',
      mistakes: [
        'Calling resource.grant() yourself -- the scheduler handles granting via _grant_next_waiter(). Calling grant directly bypasses scoring and breaks fairness',
        'Forgetting that aging happens on EVERY release, for ALL agents -- even agents not involved in the current transaction have their tasks aged',
        'Mixing up the three layers -- LOCOScheduler should never touch SharedResource directly, and Adapters should use AsyncLOCOScheduler, not LOCOScheduler'
      ],
      exercise: '<strong>This exercise is a guided code reading.</strong> You will trace the lifecycle of a single task through the source code to see how all three entities (Agent, Task, SharedResource) connect. Open each file as instructed.<br><br>' +
        '<strong>Step 1 -- Submit: a task enters an agent\'s queue.</strong> Open <code>loco/async_scheduler.py</code> and find the <code>submit_task()</code> method (around line 178). Read it and notice:<br>' +
        '<ul>' +
        '<li>If the agent_id is unknown, the scheduler auto-registers a new Agent (<code>_auto_register</code>). You do not need to pre-create agents.</li>' +
        '<li>The task is appended to <code>agent.tasks</code> -- this is the Agent\'s pending queue.</li>' +
        '<li>A log event is emitted with the current tick, agent_id, and queue depth.</li>' +
        '</ul>' +
        '<strong>Step 2 -- Acquire: the agent requests a resource slot.</strong> In the same file, find the <code>acquire()</code> method (around line 200). Read it and notice:<br>' +
        '<ul>' +
        '<li>First it tries <code>resource.try_acquire()</code> -- a non-blocking attempt. If a slot is free, the agent gets it immediately.</li>' +
        '<li>If no slot is available, the agent calls <code>resource.wait_for_slot()</code> and blocks until the scheduler grants it a slot later.</li>' +
        '<li>There is a backpressure check: if too many agents are already waiting (<code>max_waiters</code>), a <code>BackpressureError</code> is raised instead of queueing forever.</li>' +
        '</ul>' +
        '<strong>Step 3 -- Grant: the scheduler picks the winner.</strong> Now find <code>_grant_next_waiter()</code> (around line 446). This is where grant-time scoring happens:<br>' +
        '<ul>' +
        '<li>It collects all waiting agent IDs from <code>resource._waiters</code>.</li>' +
        '<li>It calls <code>compute_load_scores()</code> on the sync LOCOScheduler core -- this computes L(i) using <em>current</em> Qi and Dmax values.</li>' +
        '<li>It filters scores to only include waiting agents, then grants the slot to the highest scorer via <code>resource.grant(best_id)</code>.</li>' +
        '<li>This is why arrival order does not matter -- scores are computed fresh every time.</li>' +
        '</ul>' +
        '<strong>Step 4 -- Execute and release.</strong> Back in <code>acquire()</code>, look at the <code>try/finally</code> block (around line 290):<br>' +
        '<ul>' +
        '<li>The <code>yield</code> inside <code>resource.held_by()</code> is where your code runs (e.g., making an API call). The resource is held during this time.</li>' +
        '<li>When your code finishes (or raises an exception), <code>held_by()</code> automatically calls <code>resource.release()</code> -- the slot is freed.</li>' +
        '<li>After release, <code>_on_release()</code> is called.</li>' +
        '</ul>' +
        '<strong>Step 5 -- Age and re-grant.</strong> Find <code>_on_release()</code> (around line 430). This is the heartbeat of the system:<br>' +
        '<ul>' +
        '<li>The <code>_logical_tick</code> counter increments by 1.</li>' +
        '<li>ALL waiting tasks across ALL agents have their <code>age</code> incremented by 1 -- not just the agent that was served.</li>' +
        '<li>If adaptive alpha tuning is enabled, the alpha value is adjusted.</li>' +
        '<li>Finally, <code>_grant_next_waiter()</code> is called again -- re-scoring and granting the next slot. The cycle repeats.</li>' +
        '</ul>' +
        '<strong>Step 6 -- Verify the full chain.</strong> Open a Python REPL and run a complete lifecycle to see it in action:<br>' +
        '<pre><code>python3</code></pre>' +
        '<pre><code>import asyncio\nfrom loco import Agent, AsyncLOCOScheduler, SharedResource, Task\n\nasync def lifecycle_demo():\n    agents = [Agent(agent_id="demo-agent")]\n    resource = SharedResource(name="llm_api", capacity=1)\n    scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")\n\n    # 1. Submit a task\n    await scheduler.submit_task("demo-agent", Task(weight=2.0))\n    agent = scheduler.get_agent("demo-agent")\n    print(f"After submit: {len(agent.tasks)} task(s) in queue")\n\n    # 2-4. Acquire, execute, release\n    async with scheduler.acquire("demo-agent"):\n        print(f"Inside acquire: holding resource, utilization={resource.utilization}")\n        agent.serve_oldest_task()  # move task to completed\n\n    # 5. After release\n    print(f"After release: {len(agent.tasks)} tasks, {len(agent.completed_tasks)} completed")\n    print(f"Logical tick: {scheduler.logical_tick}")\n    print(f"Resource utilization: {resource.utilization}")\n\nasyncio.run(lifecycle_demo())</code></pre>' +
        'You should see the task move from the queue to completed, the resource go from utilized back to free, and the logical tick increment.<br><br>' +
        '<strong>Step 7 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    }
  ]
});
