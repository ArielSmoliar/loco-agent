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
      exercise: 'Create an AsyncLOCOScheduler with an empty agent list and a SharedResource with capacity=2. Submit a task to an unknown agent_id and verify it auto-registers by checking <code>scheduler.agents</code>. Then try <code>register_agent()</code> with a duplicate ID and observe the ValueError.'
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
      exercise: 'Write an async test with a SharedResource(capacity=1). Have two agents acquire concurrently (using asyncio.gather). Verify that one acquires immediately and the other blocks until the first releases. Add a timeout of 0.1 seconds and verify TimeoutError is raised when the slot is not released in time.'
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
      exercise: 'Write a mock callback handler class with <code>on_start</code> and <code>on_end</code> methods. In <code>on_start</code>, call <code>acquire_start()</code> and store the handle. In <code>on_end</code>, call <code>release_handle()</code>. Test that the resource is properly acquired and released across the two method calls.'
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
      exercise: 'Read through the <code>_on_release()</code> and <code>_grant_next_waiter()</code> source code. Then write a scenario with 3 agents and 1 resource slot. Trace what happens after each release: which agents\' tasks age, what scores are computed, and who gets granted next. Draw the sequence as a timeline.'
    }
  ]
});
