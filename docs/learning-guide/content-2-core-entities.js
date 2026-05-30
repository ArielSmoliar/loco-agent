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
      exercise: 'Create an Agent manually, add 5 tasks with different weights and ages, then call <code>queue_depth_weighted</code> and <code>dmax</code>. Call <code>serve_oldest_task()</code> twice and verify the correct tasks were served (highest age first) and moved to completed_tasks.'
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
      exercise: 'Try creating a Task with weight=0.5 and observe the ValueError. Then create tasks with weights 1.0, 2.0, and 5.0, add them to an Agent, and check that queue_depth_weighted equals 8.0 (the sum).'
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
      exercise: 'Create a SharedResource with capacity=2. Write an async test that has 3 agents try_acquire. Verify that the first two succeed (return True) and the third fails (returns False). Then release one agent and verify available_slots increases.'
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
      exercise: 'Trace through the lifecycle of a single task by reading the source code. Start at <code>AsyncLOCOScheduler.submit_task()</code>, follow to <code>acquire()</code>, through <code>_grant_next_waiter()</code>, and finally <code>_on_release()</code>. Write down each step and which entity is involved at each point.'
    }
  ]
});
