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
      exercise: '<strong>This exercise is a guided code reading.</strong> You will trace how the AnthropicAdapter implements the BaseAdapter interface.<br><br>' +
        '<strong>Step 1 -- Open both files side by side.</strong> Use your editor or two terminal tabs to view:<br>' +
        '<pre><code># File 1: the abstract interface\nloco/adapters/base.py\n\n# File 2: the concrete implementation\nloco/adapters/anthropic.py</code></pre>' +
        '<strong>Step 2 -- Read BaseAdapter.</strong> Find the four abstract methods: <code>register_agent()</code>, <code>submit_task()</code>, <code>on_scheduled()</code>, and <code>on_completed()</code>. Note that each defines one step of the LOCO lifecycle.<br><br>' +
        '<strong>Step 3 -- Read AnthropicAdapter.create().</strong> Map each line back to the lifecycle:<br>' +
        '<ul>' +
        '<li>Lines computing <code>input_chars</code> and <code>input_tokens_est</code> -- this is weight estimation, which BaseAdapter delegates to the concrete class.</li>' +
        '<li>The call to <code>estimate_weight(model, input_tokens_est)</code> -- converts model name + prompt size into a Task weight. This is the adapter\\\'s core responsibility.</li>' +
        '<li><code>await self.scheduler.submit_task(aid, task)</code> -- maps to BaseAdapter.submit_task().</li>' +
        '<li><code>async with self.scheduler.acquire(aid)</code> -- acquires the resource slot. This is the direct wrap pattern (not the split API).</li>' +
        '<li><code>await self.client.messages.create(...)</code> -- the actual API call, inside the resource hold.</li>' +
        '<li><code>self.scheduler.metrics.record_actual_tokens()</code> -- empirical tracking after the call. BaseAdapter does not require this but it improves weight estimates over time.</li>' +
        '<li><code>agent.serve_oldest_task()</code> -- dequeues the task. Without this, Qi would be inflated forever.</li>' +
        '</ul>' +
        '<strong>Step 4 -- Note the pattern.</strong> AnthropicAdapter does not implement all four abstract methods separately. Instead, <code>create()</code> handles the full lifecycle in one method. This is the "direct wrap" pattern -- frameworks that let you wrap a single API call. Compare this to <code>google_adk.py</code> which uses the "split" pattern with separate on_start/on_end methods.<br><br>' +
        '<strong>Step 5 -- Verify in a REPL (no API key needed).</strong><br>' +
        '<pre><code>python3</code></pre>' +
        '<pre><code>from loco.adapters.anthropic import estimate_weight\n\n# Verify weight estimation without making any API calls:\nmodels = [\n    ("claude-haiku-4-5-20251001", None),\n    ("claude-sonnet-4-20250514", None),\n    ("claude-opus-4-20250514", None),\n    ("claude-sonnet-4-20250514", 5000),  # with token scaling\n    ("unknown-model-v3", None),          # falls back to 2.0\n]\nfor model, tokens in models:\n    w = estimate_weight(model, tokens)\n    print(f"  {model:>35} tokens={str(tokens):>5} -> weight={w}")</code></pre>' +
        'Notice how weight scales with model tier (haiku=1, sonnet=2, opus=5) and with token count (5000 tokens multiplies by 5x).<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Test exact model name matches.</strong><br>' +
        '<pre><code>from loco.adapters.anthropic import estimate_weight\n\n# Exact matches from MODEL_WEIGHTS dict\nprint("Exact matches:")\nprint(f"  claude-opus-4-20250514:     {estimate_weight(\\\"claude-opus-4-20250514\\\")}")      # 5.0\nprint(f"  claude-sonnet-4-20250514:   {estimate_weight(\\\"claude-sonnet-4-20250514\\\")}")    # 2.0\nprint(f"  claude-haiku-4-5-20251001:  {estimate_weight(\\\"claude-haiku-4-5-20251001\\\")}")   # 1.0</code></pre>' +
        '<strong>Step 3 -- Test family name fallback matching.</strong><br>' +
        '<pre><code># Family fallback: looks for "opus", "sonnet", "haiku" in the model name\nprint("\\nFamily fallback:")\nprint(f"  my-custom-opus-v2:   {estimate_weight(\\\"my-custom-opus-v2\\\")}")    # 5.0 (contains "opus")\nprint(f"  fine-tuned-sonnet:   {estimate_weight(\\\"fine-tuned-sonnet\\\")}")    # 2.0 (contains "sonnet")\nprint(f"  mini-haiku-fast:     {estimate_weight(\\\"mini-haiku-fast\\\")}")      # 1.0 (contains "haiku")</code></pre>' +
        'Even model names that are not in the exact dict work, as long as they contain a family keyword.<br><br>' +
        '<strong>Step 4 -- Test unknown model fallback.</strong><br>' +
        '<pre><code># Completely unknown model -- defaults to 2.0 (sonnet-tier)\nprint("\\nUnknown model fallback:")\nprint(f"  gpt-4o:              {estimate_weight(\\\"gpt-4o\\\")}")               # 2.0\nprint(f"  mystery-model-v7:    {estimate_weight(\\\"mystery-model-v7\\\")}")     # 2.0\nprint(f"  gemini-pro:          {estimate_weight(\\\"gemini-pro\\\")}")           # 2.0</code></pre>' +
        'Unknown models default to 2.0 -- a conservative sonnet-tier estimate.<br><br>' +
        '<strong>Step 5 -- Test token count scaling.</strong><br>' +
        '<pre><code># Weight scales linearly with input tokens above 1000\nprint("\\nToken scaling (sonnet base=2.0):")\nfor tokens in [100, 500, 1000, 5000, 10000, 50000]:\n    w = estimate_weight("claude-sonnet-4-20250514", tokens)\n    multiplier = max(tokens / 1000, 1.0)\n    print(f"  {tokens:>6} tokens: weight={w:>6.1f}  (base * max({tokens}/1000, 1.0) = 2.0 * {multiplier})")</code></pre>' +
        'Below 1000 tokens, the multiplier floors at 1.0 (no reduction). Above 1000, weight scales linearly. A 50K-token opus prompt has weight 250 -- the scheduler treats it as 250x more expensive than a haiku with a short prompt.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
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
      exercise: '<strong>This exercise is a guided code reading + diagramming exercise.</strong><br><br>' +
        '<strong>Step 1 -- Read the source.</strong> Open <code>loco/adapters/anthropic.py</code> and find the <code>create()</code> method. Read it top to bottom, noting every method call and which object handles it.<br><br>' +
        '<strong>Step 2 -- Draw the sequence.</strong> On paper or in a notes app, draw this sequence diagram showing the 8 steps of <code>create()</code>:<br>' +
        '<pre><code>Caller          AnthropicAdapter     AsyncLOCOScheduler     SharedResource     Anthropic API\n  |                    |                     |                    |                  |\n  |-- create() ------->|                     |                    |                  |\n  |                    |-- 1. estimate_weight (local)             |                  |\n  |                    |-- 2. submit_task --->|                   |                  |\n  |                    |-- 3. acquire ------->|-- try_acquire ---->|                  |\n  |                    |                     |  (or wait_for_slot)|                  |\n  |                    |-- 4. policy check   |                   |                  |\n  |                    |-- 5. messages.create |--------------------|-- API call ----->|\n  |                    |                     |                    |                  |\n  |                    |<- 6. record_actual_tokens               |                  |\n  |                    |-- 7. serve_oldest_task (dequeue)         |                  |\n  |                    |                     |<-- release --------|                  |\n  |                    |                     |-- 8. _on_release   |                  |\n  |<-- response -------|                     |                    |                  |</code></pre>' +
        '<strong>Step 3 -- Verify your understanding.</strong> Open a REPL and inspect the adapter without making API calls:<br>' +
        '<pre><code>python3</code></pre>' +
        '<pre><code>from loco import AsyncLOCOScheduler, SharedResource\nfrom loco.adapters.anthropic import AnthropicAdapter, estimate_weight\n\n# You can create the adapter without an API key to inspect its structure\nresource = SharedResource(name="claude_api", capacity=3)\nscheduler = AsyncLOCOScheduler([], resource, optimize_for="balanced")\n\nprint(f"Resource capacity: {resource.capacity}")\nprint(f"Scheduler agents: {list(scheduler.agents.keys())}")\nprint(f"Logical tick: {scheduler.logical_tick}")\n\n# The adapter class exists even without a real client\nprint(f"\\nAnthropicAdapter methods: {[m for m in dir(AnthropicAdapter) if not m.startswith(\\\"_\\\")]}")</code></pre>' +
        '<strong>Step 4 -- Answer these questions</strong> (check your answers against the source):<br>' +
        '<ul>' +
        '<li>Why does create() call submit_task BEFORE acquire? (Answer: the task must be in the agent\\\'s queue for scoring to work correctly)</li>' +
        '<li>Why is serve_oldest_task called INSIDE the acquire context? (Answer: to ensure the task is dequeued before release triggers re-scoring)</li>' +
        '<li>What happens if record_actual_tokens is skipped? (Answer: the EMA weight estimates stay at static values, never improving)</li>' +
        '</ul>' +
        '<strong>Step 5 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Configure LOCO with the convenience API.</strong><br>' +
        '<pre><code>import asyncio\nimport loco\n\n# Reset in case configure was called before in this session\nloco.reset()\nloco.configure(\n    capacity=2,\n    optimize_for="balanced",\n    budget_mode="reject",\n)\nprint("LOCO configured with capacity=2 and budget enforcement")</code></pre>' +
        '<strong>Step 3 -- Use wrap() to schedule mock API calls.</strong><br>' +
        '<pre><code>async def mock_api_call(prompt, delay=0.1):\n    """Simulates an LLM API call with a short delay."""\n    await asyncio.sleep(delay)\n    return f"Response to: {prompt}"\n\nasync def test_wrap():\n    # Schedule 3 calls from different agents\n    r1 = await loco.wrap(mock_api_call, agent_id="analyst", weight=2.0,\n                         prompt="analyze data", delay=0.1)\n    print(f"analyst: {r1}")\n\n    r2 = await loco.wrap(mock_api_call, agent_id="chatbot", weight=1.0,\n                         prompt="hello", delay=0.05)\n    print(f"chatbot: {r2}")\n\n    r3 = await loco.wrap(mock_api_call, agent_id="analyst", weight=5.0,\n                         prompt="deep analysis", delay=0.1)\n    print(f"analyst: {r3}")\n\n    # Check cumulative costs\n    scheduler = loco.get_scheduler()\n    print(f"\\nCosts: {scheduler.metrics.cost_by_agent()}")\n\nasyncio.run(test_wrap())</code></pre>' +
        'You should see all three calls succeed. The analyst spent 7.0 (2.0 + 5.0) and the chatbot spent 1.0.<br><br>' +
        '<strong>Step 4 -- Add budget limits and trigger a rejection.</strong><br>' +
        '<pre><code>loco.reset()\nloco.configure(capacity=2, optimize_for="balanced", budget_mode="reject")\nloco.set_budget("analyst", max_cost=5.0)\n\nasync def test_budget():\n    # First call: weight=3.0, under budget\n    r1 = await loco.wrap(mock_api_call, agent_id="analyst", weight=3.0,\n                         prompt="first call")\n    print(f"Call 1: OK (spent 3.0 of 5.0)")\n\n    # Second call: weight=3.0, would exceed budget (3+3=6 > 5)\n    try:\n        r2 = await loco.wrap(mock_api_call, agent_id="analyst", weight=3.0,\n                             prompt="second call")\n    except Exception as e:\n        print(f"Call 2: REJECTED -- {type(e).__name__}")\n\n    # Chatbot has no budget limit -- unlimited\n    r3 = await loco.wrap(mock_api_call, agent_id="chatbot", weight=10.0,\n                         prompt="unlimited")\n    print(f"Call 3: chatbot OK (no budget limit)")\n\nasyncio.run(test_budget())</code></pre>' +
        'The analyst\\\'s second call is rejected because cumulative weight (6.0) would exceed the 5.0 budget. The chatbot has no specific limit set, so it uses the default (which is None -- unlimited unless you set a default_limit).<br><br>' +
        '<strong>Step 5 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    }
  ]
});
