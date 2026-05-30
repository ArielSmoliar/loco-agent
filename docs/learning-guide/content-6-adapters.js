window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'adapters',
  title: 'Framework Adapters',
  topics: [
    {
      id: 'base-adapter',
      title: 'BaseAdapter Interface',
      content: '<p>The <strong>BaseAdapter</strong> in <code>loco/adapters/base.py</code> defines the abstract interface that all framework-specific adapters must implement. It translates framework patterns into the LOCO acquire/release lifecycle.</p>' +
        '<h3>The Interface</h3>' +
        '<pre><code>class BaseAdapter(ABC):\n    """Translates framework-specific agent patterns\n    into the LOCO acquire/release lifecycle.\n\n    Two directions:\n      Framework -> LOCO: context (model, prompt) -> Task(weight)\n      LOCO -> Framework: grant/wait decisions -> proceed/block\n    """\n\n    @abstractmethod\n    async def register_agent(self, agent_id: str, handler: Callable) -> Agent:\n        """Register a callable as a LOCO agent."""\n\n    @abstractmethod\n    async def submit_task(self, agent_id: str, task: Task) -> None:\n        """Enqueue a task to the specified agent."""\n\n    @abstractmethod\n    async def on_scheduled(self, agent_id: str, task: Task) -> Any:\n        """Called when the scheduler grants a resource."""\n\n    @abstractmethod\n    async def on_completed(self, agent_id: str, task: Task, result: Any) -> None:\n        """Called when task execution completes."""</code></pre>' +
        '<h3>Two Integration Patterns</h3>' +
        '<p>Adapters use one of two patterns depending on the framework:</p>' +
        '<p><strong>Pattern 1: Direct Wrap</strong> -- for frameworks that let you wrap API calls (Anthropic, OpenAI, vanilla):</p>' +
        '<pre><code># The adapter wraps the call in acquire/release\nasync with scheduler.acquire(agent_id):\n    response = await client.messages.create(...)</code></pre>' +
        '<p><strong>Pattern 2: Split Acquire/Release</strong> -- for callback-based frameworks (Google ADK, LangChain, CrewAI):</p>' +
        '<pre><code># on_llm_start callback:\nhandle = await scheduler.acquire_start(agent_id)\n\n# on_llm_end callback:\nawait scheduler.release_handle(handle)</code></pre>' +
        '<h3>Available Adapters</h3>' +
        '<ul><li><code>vanilla.py</code> -- plain async callables (no framework)</li><li><code>anthropic.py</code> -- Anthropic SDK (Claude)</li><li><code>openai.py</code> -- OpenAI Agents SDK</li><li><code>google_adk.py</code> -- Google ADK callbacks</li><li><code>langchain.py</code> -- LangChain callbacks</li><li><code>crewai.py</code> -- CrewAI integration</li><li><code>aws_bedrock.py</code> -- AWS Bedrock wrapper</li><li><code>autogen.py</code> -- Azure/AutoGen wrapper</li></ul>',
      summary: 'BaseAdapter defines four abstract methods for translating framework patterns into LOCO scheduling. Adapters use either direct wrap (async with acquire) or split acquire/release (for callback-based frameworks). Eight adapters ship with LOCO.',
      mentalModel: 'An adapter is like a power plug converter. The wall outlet is LOCO (acquire/release). Different devices (frameworks) have different plug shapes (API patterns). The adapter converts between them so any device can draw power from the same outlet.',
      mistakes: [
        'Implementing BaseAdapter directly when a simpler pattern works -- most adapters do not need all four abstract methods. The Anthropic adapter uses a single create() method that handles the full lifecycle',
        'Using the direct wrap pattern for callback-based frameworks -- if acquire and release happen in separate callbacks (on_llm_start/on_llm_end), you MUST use the split API',
        'Forgetting that adapters handle weight estimation -- the adapter is responsible for converting framework-specific context (model name, prompt length) into a Task.weight'
      ],
      exercise: 'Read <code>loco/adapters/anthropic.py</code> and <code>loco/adapters/base.py</code> side by side. Map each step in AnthropicAdapter.create() back to the BaseAdapter interface. Note which abstract methods are implemented and which are handled differently.'
    },
    {
      id: 'weight-estimation',
      title: 'Weight Estimation',
      content: '<p><strong>Weight estimation</strong> is the most critical responsibility of an adapter. The scheduler needs accurate relative costs to make fair decisions. Bad weight estimates lead to unfair scheduling.</p>' +
        '<h3>Model Tier Weights</h3>' +
        '<p>From <code>loco/adapters/anthropic.py</code>:</p>' +
        '<pre><code>MODEL_WEIGHTS = {\n    "claude-opus-4-20250514": 5.0,\n    "claude-sonnet-4-20250514": 2.0,\n    "claude-haiku-4-5-20251001": 1.0,\n}\n\n# Fallback patterns for model families\n_MODEL_FAMILY_WEIGHTS = {\n    "opus": 5.0,\n    "sonnet": 2.0,\n    "haiku": 1.0,\n}</code></pre>' +
        '<h3>The estimate_weight() Function</h3>' +
        '<pre><code>def estimate_weight(model: str, input_tokens: int | None = None) -> float:\n    # 1. Exact match first\n    base = MODEL_WEIGHTS.get(model)\n\n    # 2. Fall back to family name matching\n    if base is None:\n        model_lower = model.lower()\n        for family, weight in _MODEL_FAMILY_WEIGHTS.items():\n            if family in model_lower:\n                base = weight\n                break\n        else:\n            base = 2.0  # default to sonnet-tier\n\n    # 3. Scale by prompt size if available\n    if input_tokens is not None and input_tokens > 0:\n        token_multiplier = max(input_tokens / 1000, 1.0)\n        return base * token_multiplier\n\n    return base</code></pre>' +
        '<h3>How Scaling Works</h3>' +
        '<p>The weight scales linearly with input token count above 1000 tokens:</p>' +
        '<ul><li>Sonnet (base=2.0) + 500 tokens: 2.0 * max(0.5, 1.0) = <strong>2.0</strong></li><li>Sonnet (base=2.0) + 5000 tokens: 2.0 * max(5.0, 1.0) = <strong>10.0</strong></li><li>Opus (base=5.0) + 10000 tokens: 5.0 * max(10.0, 1.0) = <strong>50.0</strong></li></ul>' +
        '<p>This captures two cost dimensions: model capability (opus > sonnet > haiku) and prompt size (longer prompts cost more).</p>' +
        '<h3>Input Token Estimation</h3>' +
        '<p>Since exact token count is not known before the API call, adapters estimate from character count:</p>' +
        '<pre><code>input_chars = sum(len(str(m.get("content", ""))) for m in messages)\ninput_tokens_est = input_chars // 4  # rough char-to-token ratio</code></pre>',
      summary: 'Weight estimation converts model name and prompt size into a task weight. Model tier sets the base (opus=5, sonnet=2, haiku=1). Input token count scales the weight above 1000 tokens. Accurate weights are critical for fair scheduling.',
      mentalModel: 'Weight estimation is like pricing shipping packages. The base rate depends on the shipping class (express=opus, standard=sonnet, economy=haiku). Then it scales by package size (token count). A small express package costs less than a huge standard package, but an equally-sized express package always costs more than standard.',
      mistakes: [
        'Hardcoding weights instead of using estimate_weight() -- new models will not be recognized. The fallback pattern matching (looking for "opus", "sonnet", "haiku" in the model name) handles most cases',
        'Ignoring input token count -- a 100-token prompt and a 50,000-token prompt to the same model have very different costs. The token multiplier captures this',
        'Using exact dollar costs as weights -- weights are relative proxies for scheduling, not billing amounts. The scheduler normalizes them anyway'
      ],
      exercise: 'Call <code>estimate_weight()</code> with different model names and token counts. Try an exact model name, a family match (e.g., "my-custom-opus-v2"), and a completely unknown model name. Verify the fallback behavior matches the code.'
    },
    {
      id: 'anthropic-adapter',
      title: 'The Anthropic Adapter',
      content: '<p>The <strong>AnthropicAdapter</strong> in <code>loco/adapters/anthropic.py</code> is the reference implementation. Study this adapter to understand how to build adapters for other frameworks.</p>' +
        '<h3>Setup</h3>' +
        '<pre><code>from anthropic import AsyncAnthropic\nfrom loco import AsyncLOCOScheduler, SharedResource\nfrom loco.adapters.anthropic import AnthropicAdapter\n\nclient = AsyncAnthropic()\nscheduler = AsyncLOCOScheduler(\n    [], SharedResource("claude_api", capacity=3)\n)\nadapter = AnthropicAdapter(scheduler, client)</code></pre>' +
        '<h3>The create() Method Lifecycle</h3>' +
        '<pre><code>async def create(self, agent_id=None, *, model="claude-sonnet-4-20250514",\n                 messages=None, max_tokens=1024, **kwargs) -> Any:\n    aid = agent_id or self.default_agent_id\n    messages = messages or []\n\n    # 1. Estimate input tokens from message content\n    input_chars = sum(len(str(m.get("content", ""))) for m in messages)\n    input_tokens_est = input_chars // 4\n\n    # 2. Compute weight from model + tokens\n    weight = estimate_weight(model, input_tokens_est or None)\n    task = Task(weight=weight, task_type=f"anthropic:{model}")\n\n    # 3. Submit task to scheduler\n    await self.scheduler.submit_task(aid, task)\n\n    # 4. Acquire resource (blocks until L(i) wins)\n    async with self.scheduler.acquire(aid):\n        # 5. Make the API call\n        response = await self.client.messages.create(\n            model=model, messages=messages,\n            max_tokens=max_tokens, **kwargs\n        )\n\n        # 6. Record actual token usage\n        if hasattr(response, "usage") and response.usage:\n            actual_cost = response.usage.input_tokens + \\\n                          response.usage.output_tokens\n            self.scheduler.metrics.record_actual_tokens(\n                aid, task, actual_cost\n            )\n\n        # 7. Dequeue the served task\n        agent = self.scheduler.get_agent(aid)\n        agent.serve_oldest_task()\n\n    # 8. Resource released, _on_release() runs\n    return response</code></pre>' +
        '<h3>Usage</h3>' +
        '<pre><code>response = await adapter.create(\n    "analyst",\n    model="claude-sonnet-4-20250514",\n    messages=[{"role": "user", "content": "Analyze this data..."}]\n)</code></pre>',
      summary: 'AnthropicAdapter wraps messages.create() in LOCO scheduling: estimate weight from model + prompt, submit task, acquire resource, call the API, record actual tokens for empirical tracking, dequeue the task, and release. It is the reference implementation for all adapters.',
      mentalModel: 'The Anthropic adapter is like a valet parking service for API calls. You hand over your car (the API call spec), the valet estimates how long you will need (weight), takes a ticket (submit task), waits for a parking spot (acquire), parks the car (API call), records the actual time (token usage), and returns your car (response).',
      mistakes: [
        'Forgetting to call serve_oldest_task() after the API call -- without dequeuing, the task stays in the agent\'s queue, inflating Qi and corrupting future scoring',
        'Not recording actual token usage -- empirical tracking via record_actual_tokens() allows the scheduler to refine weight estimates over time with EMA',
        'Using a synchronous Anthropic client -- the adapter requires AsyncAnthropic, not the sync Anthropic client'
      ],
      exercise: 'Read the full AnthropicAdapter source code and draw a sequence diagram showing every method call in order: from create() being called, through submit_task, acquire, client.messages.create, record_actual_tokens, serve_oldest_task, to release. Label which object handles each step.'
    },
    {
      id: 'convenience-api',
      title: 'The Convenience API',
      content: '<p>The <strong>convenience API</strong> in <code>loco/convenience.py</code> provides one-liner LOCO integration via a module-level singleton. For simple use cases, this is all you need.</p>' +
        '<h3>configure()</h3>' +
        '<pre><code>import loco\n\n# Configure once at app startup\nloco.configure(\n    capacity=3,                  # Max concurrent API calls\n    optimize_for="balanced",     # "latency", "balanced", "throughput"\n    resource_name="llm_api",     # Name for the shared resource\n    auto_tune=True,              # Enable adaptive alpha tuning\n    max_waiters=100,             # Backpressure limit\n    budget_mode="reject",        # Enable budgets: "reject"/"alert"/"downgrade"\n)</code></pre>' +
        '<h3>wrap() -- One-Line Scheduling</h3>' +
        '<pre><code>response = await loco.wrap(\n    client.messages.create,      # Any async callable\n    agent_id="analyst",          # Agent ID (auto-registers)\n    weight=2.0,                  # Task weight\n    # Everything below passed through to the callable:\n    model="claude-sonnet-4-20250514",\n    messages=[{"role": "user", "content": "Hello"}]\n)</code></pre>' +
        '<p><code>wrap()</code> handles the full lifecycle: create task, submit, acquire, call the function, dequeue, release. One line replaces five method calls.</p>' +
        '<h3>scheduled() -- Decorator</h3>' +
        '<pre><code>@loco.scheduled(agent_id="webhook", weight=1.0)\nasync def handle_webhook(payload):\n    return await client.messages.create(\n        model="claude-haiku-4-5-20251001",\n        messages=[{"role": "user", "content": payload}]\n    )\n\n# Now every call to handle_webhook() is automatically scheduled\nresult = await handle_webhook(my_payload)</code></pre>' +
        '<h3>set_budget()</h3>' +
        '<pre><code>loco.configure(capacity=3, budget_mode="reject")\nloco.set_budget("analyst", max_cost=50.0)\nloco.set_budget("chatbot", max_cost=200.0)\n# Now budget is enforced on every wrap() or scheduled() call</code></pre>' +
        '<h3>When to Use What</h3>' +
        '<ul><li><strong>Convenience API:</strong> Simple apps, quick prototyping, single resource</li><li><strong>AsyncLOCOScheduler directly:</strong> Multiple resources, custom policies, lifecycle hooks</li><li><strong>Framework adapters:</strong> Deep integration with specific frameworks (weight estimation, token tracking)</li></ul>',
      summary: 'The convenience API provides configure(), wrap(), scheduled(), and set_budget() as module-level functions backed by a singleton scheduler. Use it for simple apps; use AsyncLOCOScheduler directly for advanced control.',
      mentalModel: 'The convenience API is like a food delivery app (one-tap ordering). AsyncLOCOScheduler is like calling the restaurant directly (full menu, special requests). Framework adapters are like having the chef come to your kitchen (deep integration). Each level trades simplicity for control.',
      mistakes: [
        'Calling wrap() before configure() -- raises RuntimeError. Always call loco.configure() once at startup',
        'Using set_budget() without budget_mode in configure() -- raises RuntimeError. Budget must be enabled in configure(budget_mode="reject")',
        'Using the convenience API when you need multiple resources -- the singleton manages one resource. For multi-resource setups, use AsyncLOCOScheduler directly',
        'Forgetting that wrap() auto-registers agents -- you do not need to pre-register agents when using the convenience API'
      ],
      exercise: 'Build a minimal async script that uses <code>loco.configure()</code> and <code>loco.wrap()</code> to schedule 3 concurrent mock API calls (use <code>asyncio.sleep</code> as the callable). Add budget limits and verify that BudgetExceededError is raised when an agent exceeds its budget.'
    }
  ]
});
