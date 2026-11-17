window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'async-scheduler',
  title: 'The Async Scheduler',
  topics: [
    {
      id: 'async-scheduler-overview',
      title: 'AsyncLOCOScheduler Overview',
      content: '<p>The <strong>AsyncLOCOScheduler</strong> in <code>loco/async_scheduler.py</code> is the production-facing scheduler. It wraps the sync <code>LOCOScheduler</code> scoring core with async resource management, lifecycle hooks, policy enforcement, and metrics.</p>' +
        '<h3>Constructor</h3>' +
        '<pre><code>class AsyncLOCOScheduler:\n    def __init__(\n        self,\n        agents: list[Agent],\n        resource: SharedResource,\n        *,\n        alpha: float | None = None,\n        optimize_for: str | None = None,\n        max_waiters: int = 100,\n        seed: int | None = None,\n        on_task_started: Callable | None = None,\n        on_task_completed: Callable | None = None,\n        auto_tune: bool = False,\n        budget: BudgetManager | None = None,\n        enforcer: PolicyEnforcer | None = None,\n    ) -> None:</code></pre>' +
        '<h3>Internal Architecture</h3>' +
        '<pre><code>self._scorer = LOCOScheduler(...)   # The sync scoring core\nself.resource = resource             # SharedResource for slot management\nself._lock = asyncio.Lock()          # Protects _on_release critical section\nself._logical_tick = 0               # Global tick counter\nself._active_handles = {}            # For split acquire/release API\nself.metrics = SchedulerMetrics(self) # Auto-created metrics tracker\nself._enforcer = PolicyEnforcer(...) # Combined budget + policies\nself._tuner = AdaptiveAlphaTuner(self) if auto_tune else None</code></pre>' +
        '<h3>Auto-Registration</h3>' +
        '<p>Agents can be registered in advance or auto-registered on first contact:</p>' +
        '<pre><code>def _auto_register(self, agent_id: str) -> Agent:\n    """Create and register an agent on first contact."""\n    agent = Agent(agent_id=agent_id)\n    self._scorer.agents[agent_id] = agent\n    return agent</code></pre>' +
        '<p>When <code>submit_task()</code> is called with an unknown agent_id, it auto-registers. You can also explicitly register with <code>register_agent()</code> or unregister with <code>unregister_agent()</code>.</p>',
      summary: 'AsyncLOCOScheduler wraps LOCOScheduler with async resource management, policy enforcement, metrics, and lifecycle hooks. It creates a LOCOScheduler internally as the scoring core, and auto-registers agents on first contact.',
      mentalModel: 'If LOCOScheduler is the rulebook, AsyncLOCOScheduler is the game host. It manages the physical game board (SharedResource), enforces house rules (policies), keeps score (metrics), announces plays (lifecycle hooks), and lets new players join mid-game (auto-registration).',
      mistakes: [
        'Creating a LOCOScheduler directly for production use -- use AsyncLOCOScheduler which wraps it with async I/O and resource management',
        'Forgetting that AsyncLOCOScheduler auto-creates SchedulerMetrics -- you do not need to create metrics separately, just access scheduler.metrics',
        'Pre-registering agents when auto-registration works -- for most use cases, agents auto-register on first submit_task() call, simplifying setup'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create an AsyncLOCOScheduler with no agents.</strong> We need <code>asyncio.run()</code> to call async methods from the REPL:<br>' +
        '<pre><code>import asyncio\nfrom loco import AsyncLOCOScheduler, SharedResource, Task\n\nresource = SharedResource(name="llm_api", capacity=2)\nscheduler = AsyncLOCOScheduler([], resource, optimize_for="balanced")\nprint(f"Agents at start: {list(scheduler.agents.keys())}")</code></pre>' +
        'You should see an empty list -- no agents registered yet.<br><br>' +
        '<strong>Step 3 -- Submit a task to an unknown agent and watch it auto-register.</strong><br>' +
        '<pre><code>async def test_auto_register():\n    await scheduler.submit_task("mystery-agent", Task(weight=2.0))\n    print(f"Agents after submit: {list(scheduler.agents.keys())}")\n    agent = scheduler.get_agent("mystery-agent")\n    print(f"Agent type: {agent.agent_type}")\n    print(f"Tasks in queue: {len(agent.tasks)}")\n\nasyncio.run(test_auto_register())</code></pre>' +
        'The agent "mystery-agent" was created automatically on first contact. You never had to pre-register it. It has one task in its queue.<br><br>' +
        '<strong>Step 4 -- Try registering a duplicate agent.</strong><br>' +
        '<pre><code>from loco import Agent\n\ntry:\n    scheduler.register_agent(Agent(agent_id="mystery-agent"))\nexcept ValueError as e:\n    print(f"Error: {e}")</code></pre>' +
        'You should see a ValueError because "mystery-agent" already exists (it was auto-registered in Step 3). You cannot have two agents with the same ID.<br><br>' +
        '<strong>Step 5 -- Check that metrics were auto-created.</strong><br>' +
        '<pre><code>print(f"Metrics object exists: {scheduler.metrics is not None}")\nprint(f"Resource utilization: {scheduler.metrics.resource_utilization()}")\nprint(f"Logical tick: {scheduler.logical_tick}")</code></pre>' +
        'SchedulerMetrics is auto-created on every AsyncLOCOScheduler -- you never create it manually.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'acquire-context-manager',
      title: 'acquire() -- The Context Manager',
      content: '<p>The <code>acquire()</code> method is the primary API for production use. It is an async context manager that handles the full lifecycle: acquire, hold, release, re-score.</p>' +
        '<h3>Basic Usage</h3>' +
        '<pre><code>async with scheduler.acquire(agent_id="analyst", timeout=30.0):\n    # Resource is held -- make your API call\n    response = await client.messages.create(\n        model="claude-sonnet-4-20250514",\n        messages=[{"role": "user", "content": "Hello"}]\n    )\n# Resource auto-released on exit, even on exception</code></pre>' +
        '<h3>The Full Flow</h3>' +
        '<ol><li><strong>Shutdown check:</strong> Raises <code>ShutdownError</code> if scheduler is shutting down</li>' +
        '<li><strong>Immediate try:</strong> Calls <code>resource.try_acquire()</code> for a non-blocking slot grab</li>' +
        '<li><strong>Wait if needed:</strong> If no slot, checks backpressure (raises <code>BackpressureError</code> if waiters >= max_waiters), then blocks via <code>resource.wait_for_slot()</code></li>' +
        '<li><strong>Timeout:</strong> If <code>timeout</code> is set, raises <code>TimeoutError</code> after that many seconds</li>' +
        '<li><strong>Policy check:</strong> Runs <code>enforcer.check_all()</code> BEFORE metrics or hooks. If a policy rejects, releases the resource and re-raises</li>' +
        '<li><strong>Record metrics:</strong> Records task cost via <code>metrics.record_task_cost()</code></li>' +
        '<li><strong>Fire hooks:</strong> Calls <code>on_task_started(agent_id, task)</code></li>' +
        '<li><strong>Yield:</strong> The caller\'s code runs inside <code>resource.held_by()</code> -- ensuring cleanup</li>' +
        '<li><strong>On exit:</strong> Records completion to policies, fires <code>on_task_completed</code>, emits logs</li>' +
        '<li><strong>Re-score:</strong> Calls <code>_on_release()</code> to age tasks and grant next waiter</li></ol>' +
        '<h3>Error Types</h3>' +
        '<pre><code>BackpressureError  # Too many waiters (>= max_waiters)\nShutdownError      # Scheduler is shutting down\nTimeoutError       # Wait exceeded timeout seconds\nPolicyViolationError  # A policy rejected the task\nBudgetExceededError   # Budget policy specifically (subclass of above)</code></pre>',
      summary: 'acquire() is an async context manager that acquires a resource slot (blocking if needed), enforces policies, records metrics, fires lifecycle hooks, and auto-releases on exit. It handles backpressure, timeouts, and policy violations.',
      mentalModel: 'acquire() is like a "take a number" system at a government office, but smarter. You take a number, wait until your number is called (based on priority, not order). When you reach the counter, your ID is checked (policy). If approved, you do your business. When you leave, the next person is called based on current priorities.',
      mistakes: [
        'Not handling BackpressureError -- under extreme load, acquire() raises this instead of queuing indefinitely. Callers should catch it and either retry or reject the request',
        'Forgetting to submit a task before acquiring -- acquire() checks the agent\'s task queue for policy evaluation. Without a task, policy checks may behave unexpectedly',
        'Using acquire() in callback-based frameworks -- if acquire and release happen in different callbacks, use acquire_start()/release_handle() instead'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Set up a scheduler with capacity=1 and two agents.</strong><br>' +
        '<pre><code>import asyncio\nfrom loco import Agent, AsyncLOCOScheduler, SharedResource, Task\n\nasync def test_contention():\n    agents = [Agent(agent_id="fast"), Agent(agent_id="slow")]\n    resource = SharedResource(name="api", capacity=1)\n    scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")\n\n    # Give both agents tasks\n    await scheduler.submit_task("fast", Task(weight=1.0))\n    await scheduler.submit_task("slow", Task(weight=1.0))\n\n    results = []\n\n    async def use_slot(agent_id, delay):\n        async with scheduler.acquire(agent_id):\n            results.append(f"{agent_id} acquired")\n            await asyncio.sleep(delay)\n            scheduler.get_agent(agent_id).serve_oldest_task()\n        results.append(f"{agent_id} released")\n\n    # Fast finishes in 0.1s, slow takes 0.3s\n    await asyncio.gather(\n        use_slot("fast", 0.1),\n        use_slot("slow", 0.3),\n    )\n\n    for r in results:\n        print(r)\n\nasyncio.run(test_contention())</code></pre>' +
        'With capacity=1, only one agent can hold the resource at a time. One acquires immediately; the other blocks until the first releases. Look at the order of "acquired" and "released" messages.<br><br>' +
        '<strong>Step 3 -- Test timeout behavior.</strong><br>' +
        '<pre><code>async def test_timeout():\n    agents = [Agent(agent_id="holder"), Agent(agent_id="waiter")]\n    resource = SharedResource(name="api", capacity=1)\n    scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")\n\n    await scheduler.submit_task("holder", Task(weight=1.0))\n    await scheduler.submit_task("waiter", Task(weight=1.0))\n\n    async def hold_forever(agent_id):\n        async with scheduler.acquire(agent_id):\n            await asyncio.sleep(10)  # holds for a long time\n\n    async def try_with_timeout(agent_id):\n        try:\n            async with scheduler.acquire(agent_id, timeout=0.1):\n                print("Should not reach here")\n        except TimeoutError:\n            print(f"{agent_id} timed out after 0.1s -- correct!")\n\n    await asyncio.gather(\n        hold_forever("holder"),\n        try_with_timeout("waiter"),\n        return_exceptions=True,\n    )\n\nasyncio.run(test_timeout())</code></pre>' +
        '"waiter" should time out after 0.1 seconds because "holder" never releases the single slot. The timeout parameter prevents indefinite blocking.<br><br>' +
        '<strong>Step 4 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'split-api',
      title: 'The Split API',
      content: '<p>Some frameworks like Google ADK, LangChain, and CrewAI use callback-based patterns where you cannot wrap a single call in <code>async with</code>. The <strong>split API</strong> handles this.</p>' +
        '<h3>The Problem</h3>' +
        '<pre><code># Callback-based frameworks have separate start/end hooks:\nclass MyCallbackHandler:\n    async def on_llm_start(self, prompt, **kwargs):\n        # Need to acquire HERE\n        pass\n\n    async def on_llm_end(self, response, **kwargs):\n        # Need to release HERE\n        pass</code></pre>' +
        '<p>You cannot use <code>async with scheduler.acquire()</code> because acquire and release happen in different methods.</p>' +
        '<h3>acquire_start() / release_handle()</h3>' +
        '<pre><code># Acquire and get a handle:\nhandle = await scheduler.acquire_start(agent_id, timeout=30.0)\n\n# ... later, in a different callback ...\n\n# Release using the handle:\nawait scheduler.release_handle(handle)</code></pre>' +
        '<h3>AcquireHandle</h3>' +
        '<pre><code>@dataclass\nclass AcquireHandle:\n    handle_id: str = field(default_factory=lambda: uuid4().hex[:12])\n    agent_id: str = ""\n    _released: bool = False\n    _serving_task: Task | None = None</code></pre>' +
        '<p>The handle captures the task being served at acquire time. This is important because the task may have been dequeued by the time release_handle is called.</p>' +
        '<h3>Safety</h3>' +
        '<p><code>release_handle()</code> is idempotent -- calling it multiple times is safe. The second call is a no-op:</p>' +
        '<pre><code>async def release_handle(self, handle: AcquireHandle) -> None:\n    if handle._released:\n        return\n    handle._released = True\n    ...</code></pre>' +
        '<p>Active handles are tracked in <code>self._active_handles</code> for debugging and shutdown.</p>',
      summary: 'The split API (acquire_start/release_handle) enables LOCO integration with callback-based frameworks where acquire and release happen in different methods. AcquireHandle carries the context between calls. release_handle is safe to call multiple times.',
      mentalModel: 'The split API is like a coat check. acquire_start() is handing over your coat and getting a ticket (the handle). release_handle() is presenting your ticket to get your coat back. You can wave the ticket around as many times as you want -- only the first redemption does anything.',
      mistakes: [
        'Losing the AcquireHandle between callbacks -- if the handle is garbage collected, you cannot release the resource. Store it as an instance variable or in a dict keyed by request ID',
        'Using acquire() in callback-based frameworks instead of the split API -- the context manager cannot span separate callback methods',
        'Forgetting that release_handle runs the same _on_release() logic -- it ages tasks, re-scores, and grants the next waiter, just like the context manager exit'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create a mock callback handler using the split API.</strong><br>' +
        '<pre><code>import asyncio\nfrom loco import Agent, AsyncLOCOScheduler, SharedResource, Task\n\nclass MockCallbackHandler:\n    def __init__(self, scheduler):\n        self.scheduler = scheduler\n        self._handles = {}  # request_id -> AcquireHandle\n\n    async def on_start(self, request_id, agent_id):\n        """Called when an LLM request begins."""\n        await self.scheduler.submit_task(agent_id, Task(weight=2.0))\n        handle = await self.scheduler.acquire_start(agent_id)\n        self._handles[request_id] = handle\n        print(f"  [{request_id}] acquired slot for {agent_id}")\n\n    async def on_end(self, request_id):\n        """Called when an LLM request completes."""\n        handle = self._handles.pop(request_id)\n        agent = self.scheduler.get_agent(handle.agent_id)\n        agent.serve_oldest_task()\n        await self.scheduler.release_handle(handle)\n        print(f"  [{request_id}] released slot for {handle.agent_id}")</code></pre>' +
        '<strong>Step 3 -- Test the handler with two sequential requests.</strong><br>' +
        '<pre><code>async def test_split_api():\n    agents = [Agent(agent_id="bot")]\n    resource = SharedResource(name="api", capacity=1)\n    scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")\n    handler = MockCallbackHandler(scheduler)\n\n    # Request 1: start -> end\n    print("Request 1:")\n    await handler.on_start("req-1", "bot")\n    print(f"  Utilization: {resource.utilization}")  # 1.0 (slot held)\n    await handler.on_end("req-1")\n    print(f"  Utilization: {resource.utilization}")  # 0.0 (slot freed)\n\n    # Request 2: start -> end\n    print("\\nRequest 2:")\n    await handler.on_start("req-2", "bot")\n    print(f"  Utilization: {resource.utilization}")  # 1.0\n    await handler.on_end("req-2")\n    print(f"  Utilization: {resource.utilization}")  # 0.0\n\n    print(f"\\nCompleted tasks: {len(scheduler.get_agent(\\\"bot\\\").completed_tasks)}")\n\nasyncio.run(test_split_api())</code></pre>' +
        'Utilization should go to 1.0 after each <code>on_start</code> and back to 0.0 after each <code>on_end</code>. The handle carries context between the two methods -- this is how callback-based frameworks like LangChain and Google ADK integrate with LOCO.<br><br>' +
        '<strong>Step 4 -- Verify release_handle is idempotent.</strong><br>' +
        '<pre><code>async def test_double_release():\n    agents = [Agent(agent_id="bot")]\n    resource = SharedResource(name="api", capacity=1)\n    scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")\n    handler = MockCallbackHandler(scheduler)\n\n    await handler.on_start("req-3", "bot")\n    handle = handler._handles["req-3"]\n\n    # Release once (normal)\n    await scheduler.release_handle(handle)\n    print(f"After first release: utilization={resource.utilization}")\n\n    # Release again (idempotent -- no error)\n    await scheduler.release_handle(handle)\n    print(f"After second release: utilization={resource.utilization}")\n    print("Double release is safe -- no error raised")\n\nasyncio.run(test_double_release())</code></pre>' +
        'The second <code>release_handle()</code> is a no-op. This safety net prevents resource leaks when cleanup code runs twice.<br><br>' +
        '<strong>Step 5 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'on-release-grant',
      title: '_on_release() and Re-scoring',
      content: '<p>The <code>_on_release()</code> method is called after every resource release. This is where the core scheduling magic happens -- aging, re-scoring, and granting.</p>' +
        '<h3>The Implementation</h3>' +
        '<pre><code>async def _on_release(self) -> None:\n    async with self._lock:\n        # 1. Increment logical tick\n        self._logical_tick += 1\n\n        # 2. Age ALL waiting tasks\n        for agent in self.agents.values():\n            for task in agent.tasks:\n                task.age += 1\n\n        # 3. Adaptive alpha tuning (if enabled)\n        if self._tuner:\n            self._tuner.update()\n\n        # 4. Re-score and grant next waiter\n        await self._grant_next_waiter()</code></pre>' +
        '<h3>_grant_next_waiter()</h3>' +
        '<pre><code>async def _grant_next_waiter(self) -> None:\n    if not self.resource._waiters or \\\n       self.resource.available_slots == 0:\n        return\n\n    # Only score agents that are actually waiting\n    waiting_ids = set(self.resource._waiters.keys())\n    scores = self._scorer.compute_load_scores()\n    waiter_scores = {\n        aid: s for aid, s in scores.items()\n        if aid in waiting_ids\n    }\n\n    if not waiter_scores:\n        return\n\n    # Grant to highest scorer\n    best_id = max(waiter_scores, key=waiter_scores.get)\n    await self.resource.grant(best_id)</code></pre>' +
        '<h3>Why This is Under a Lock</h3>' +
        '<p>The lock (<code>self._lock</code>) ensures that aging, re-scoring, and granting happen atomically. Without it, two concurrent releases could both age tasks (double-aging) or both try to grant the same slot.</p>' +
        '<h3>The Grant-Time Scoring Guarantee</h3>' +
        '<p>Because tasks are aged BEFORE re-scoring, the scores reflect the latest waiting times. An agent that just waited through the current tick has its Dmax updated before the grant decision. This is the implementation of the grant-time scoring design principle.</p>',
      summary: '_on_release() is the scheduling engine: it increments the logical tick, ages all waiting tasks, optionally tunes alpha, then re-scores waiters and grants to the highest scorer. Everything happens under a lock to prevent race conditions.',
      mentalModel: '_on_release() is like the moment a parking space opens up. The attendant (lock) ensures only one car moves at a time. First, everyone\'s wait timer ticks up. Then the attendant looks at the queue, calculates who needs the space most, and waves them in. No cutting in line, no double-granting.',
      mistakes: [
        'Thinking aging only affects the released agent -- ALL waiting tasks across ALL agents age by 1 on every release',
        'Calling _on_release() manually -- it is called automatically by acquire() and release_handle(). Manual calls would double-age tasks and potentially double-grant',
        'Assuming _grant_next_waiter scores ALL agents -- it only scores agents that are actually in the waiter queue, not all agents with tasks',
        'Forgetting the lock -- without the asyncio.Lock, concurrent releases cause race conditions in aging and granting'
      ],
      exercise: '<strong>This exercise is a guided code reading combined with a hands-on trace.</strong><br><br>' +
        '<strong>Step 1 -- Read the source code.</strong> Open <code>loco/async_scheduler.py</code> and find <code>_on_release()</code> (around line 430). Read the four operations in order: tick increment, task aging, adaptive tuning, and grant next waiter. Then find <code>_grant_next_waiter()</code> (around line 446) and read how it filters scores to waiting agents only.<br><br>' +
        '<strong>Step 2 -- Open a Python REPL and set up a trace scenario.</strong><br>' +
        '<pre><code>python3</code></pre>' +
        '<pre><code>from loco.testing import SyncTestScheduler, mock_agent\n\n# 3 agents, 1 resource slot (simulated by step-by-step execution)\nagents = [\n    mock_agent("A", pending_tasks=2),  # Qi=2, Dmax starts at 0\n    mock_agent("B", pending_tasks=3),  # Qi=3, Dmax starts at 0\n    mock_agent("C", pending_tasks=1),  # Qi=1, Dmax starts at 0\n]\nscheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)</code></pre>' +
        '<strong>Step 3 -- Trace each tick manually.</strong> After each step, inspect ages and scores to see the _on_release() effect:<br>' +
        '<pre><code>for tick in range(1, 7):\n    result = scheduler.step()\n    served = result.selected_agent.agent_id if result.selected_agent else "none"\n    print(f"\\n=== Tick {tick}: served {served} ===")\n    print(f"  Scores: {result.scores}")\n    for aid in ["A", "B", "C"]:\n        agent = scheduler.get_agent(aid)\n        if agent.tasks:\n            ages = [t.age for t in agent.tasks]\n            print(f"  {aid}: {len(agent.tasks)} tasks, ages={ages}, Dmax={agent.dmax}")\n        else:\n            print(f"  {aid}: done")</code></pre>' +
        '<strong>Step 4 -- Read the output.</strong> Look for these patterns:<br>' +
        '<ul>' +
        '<li>After each tick, ALL remaining tasks across ALL agents have their age incremented by 1 -- not just the served agent\\\'s tasks. This is _on_release() aging.</li>' +
        '<li>Agent C has only 1 task. Its Dmax grows each tick it waits. Even with the smallest queue (Qi=1), C eventually gets served because its Dmax climbs.</li>' +
        '<li>The scores change every tick because ages change. This is grant-time re-scoring in action.</li>' +
        '<li>Once an agent\\\'s queue is empty, it disappears from the scores dict entirely.</li>' +
        '</ul>' +
        '<strong>Step 5 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    }
  ]
});
