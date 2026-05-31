window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'contributing',
  title: 'Contributing',
  topics: [
    {
      id: 'project-setup',
      title: 'Project Setup',
      content: '<p>Getting LOCO-Agent running locally takes about 2 minutes. Here is everything you need.</p>' +
        '<h3>Clone and Install</h3>' +
        '<pre><code># Clone the repository\ngit clone https://github.com/ArielSmoliar/loco-agent.git\ncd loco-agent\n\n# Create a virtual environment\npython -m venv .venv\nsource .venv/bin/activate  # macOS/Linux\n# .venv\\Scripts\\activate   # Windows\n\n# Install with dev dependencies\npip install -e ".[dev]"</code></pre>' +
        '<h3>Dev Dependencies</h3>' +
        '<ul><li><strong>pytest >= 8.0</strong> -- test runner</li><li><strong>pytest-asyncio >= 0.23</strong> -- async test support</li><li><strong>ruff >= 0.4</strong> -- linter</li><li><strong>numpy >= 1.24</strong> -- used in some scenarios</li></ul>' +
        '<p>The core library has <strong>zero required dependencies</strong>. Framework adapters (anthropic, openai) are optional extras.</p>' +
        '<h3>Running Tests</h3>' +
        '<pre><code># Run all tests (389 tests)\npytest\n\n# Run a specific test file\npytest tests/test_scheduler.py -v\n\n# Run a specific test\npytest tests/test_scheduler.py::test_alpha_025_score_ordering -v\n\n# Run with coverage\npytest --cov=loco</code></pre>' +
        '<h3>Linting</h3>' +
        '<pre><code># Check for style issues\nruff check .\n\n# Auto-fix what it can\nruff check . --fix</code></pre>' +
        '<h3>Running Examples</h3>' +
        '<pre><code># Run the validated scenarios\npython examples/burst.py\npython examples/fairness.py</code></pre>' +
        '<h3>Python Version Support</h3>' +
        '<p>LOCO supports Python 3.10, 3.11, 3.12, and 3.13. The codebase uses Python 3.10+ features like <code>X | Y</code> type unions. The <code>asyncio.timeout</code> fallback in <code>async_scheduler.py</code> handles the 3.10/3.11 difference.</p>',
      summary: 'Clone, create a venv, pip install -e ".[dev]", run pytest. Zero runtime dependencies, dev deps are pytest, pytest-asyncio, ruff, and numpy. Supports Python 3.10-3.13.',
      mentalModel: 'Setting up LOCO is like assembling a LEGO set -- the base kit (zero deps) works out of the box. The dev kit (pytest, ruff) gives you the tools to build and test new pieces. Framework adapters are optional expansion packs.',
      mistakes: [
        'Installing without the [dev] extra -- pip install -e . will miss pytest and ruff. Always use pip install -e ".[dev]" for development',
        'Using Python 3.9 or earlier -- LOCO requires 3.10+ for X | Y type unions and other modern syntax',
        'Running tests without a venv -- system Python may have conflicting packages. Always use a virtual environment'
      ],
      exercise: '<strong>Step 1 -- Clone and install.</strong> If you have not already done this from the Foundations section, run:<br>' +
        '<pre><code>git clone https://github.com/ArielSmoliar/loco-agent.git\ncd loco-agent</code></pre>' +
        '<strong>Step 2 -- Create a virtual environment and install.</strong><br>' +
        '<pre><code>python3 -m venv .venv\nsource .venv/bin/activate\npip3 install --upgrade pip\npip3 install -e ".[dev]"</code></pre>' +
        'The <code>[dev]</code> extra installs pytest, pytest-asyncio, ruff, and numpy. The core library has zero required dependencies.<br><br>' +
        '<strong>Step 3 -- Run the full test suite.</strong><br>' +
        '<pre><code>pytest</code></pre>' +
        'All tests should pass. If any fail, check your Python version (must be 3.10+) and that you installed with <code>[dev]</code>.<br><br>' +
        '<strong>Step 4 -- Run a specific test file with verbose output.</strong><br>' +
        '<pre><code>pytest tests/test_scheduler.py -v</code></pre>' +
        'The <code>-v</code> flag shows each test name and its pass/fail status. Scan the test names to get a feel for what the scheduler tests cover.<br><br>' +
        '<strong>Step 5 -- Run the linter.</strong><br>' +
        '<pre><code>ruff check .</code></pre>' +
        'Should report zero issues. If it finds problems, run <code>ruff check . --fix</code> to auto-fix what it can.<br><br>' +
        '<strong>Step 6 -- Run the burst example.</strong><br>' +
        '<pre><code>python3 examples/burst.py</code></pre>' +
        'Read the output. You should see service order, service counts, and scheduling statistics. This is Scenario 1 -- the simultaneous work arrival test.<br><br>' +
        '<strong>Step 7 -- Run the fairness example.</strong><br>' +
        '<pre><code>python3 examples/fairness.py</code></pre>' +
        'Look at the table of alpha values vs fairness scores. This is Scenario 2 -- the proof that alpha >= 0.75 causes starvation.'
    },
    {
      id: 'adding-adapters',
      title: 'How to Add a New Adapter',
      content: '<p>Adding a new framework adapter is one of the highest-impact contributions. Here is the step-by-step process, using the Anthropic adapter as a reference.</p>' +
        '<h3>Step 1: Create the File</h3>' +
        '<p>Create <code>loco/adapters/my_framework.py</code>. Follow the existing naming convention.</p>' +
        '<h3>Step 2: Define Model Weights</h3>' +
        '<pre><code>MODEL_WEIGHTS = {\n    "my-model-large": 5.0,\n    "my-model-medium": 2.0,\n    "my-model-small": 1.0,\n}\n\ndef estimate_weight(model: str, input_tokens: int | None = None) -> float:\n    base = MODEL_WEIGHTS.get(model, 2.0)  # default to medium\n    if input_tokens and input_tokens > 0:\n        return base * max(input_tokens / 1000, 1.0)\n    return base</code></pre>' +
        '<h3>Step 3: Implement the Adapter</h3>' +
        '<pre><code>class MyFrameworkAdapter:\n    def __init__(self, scheduler: AsyncLOCOScheduler, client: Any):\n        self.scheduler = scheduler\n        self.client = client\n\n    async def call(self, agent_id: str, *, model: str,\n                   prompt: str, **kwargs) -> Any:\n        # 1. Estimate weight\n        weight = estimate_weight(model, len(prompt) // 4)\n        task = Task(weight=weight, task_type=f"myframework:{model}")\n\n        # 2. Submit task\n        await self.scheduler.submit_task(agent_id, task)\n\n        # 3. Acquire and execute\n        async with self.scheduler.acquire(agent_id):\n            response = await self.client.generate(\n                model=model, prompt=prompt, **kwargs\n            )\n\n            # 4. Record actual usage\n            if hasattr(response, "usage"):\n                actual = response.usage.total_tokens\n                self.scheduler.metrics.record_actual_tokens(\n                    agent_id, task, actual\n                )\n\n            # 5. Dequeue\n            self.scheduler.get_agent(agent_id).serve_oldest_task()\n\n        return response</code></pre>' +
        '<h3>Step 4: For Callback-Based Frameworks</h3>' +
        '<p>If the framework uses callbacks (on_llm_start/on_llm_end), use the split API:</p>' +
        '<pre><code>class MyCallbackAdapter:\n    def __init__(self, scheduler):\n        self.scheduler = scheduler\n        self._handles = {}  # request_id -> AcquireHandle\n\n    async def on_start(self, request_id, agent_id, model):\n        weight = estimate_weight(model)\n        task = Task(weight=weight)\n        await self.scheduler.submit_task(agent_id, task)\n        handle = await self.scheduler.acquire_start(agent_id)\n        self._handles[request_id] = handle\n\n    async def on_end(self, request_id):\n        handle = self._handles.pop(request_id)\n        await self.scheduler.release_handle(handle)</code></pre>' +
        '<h3>Step 5: Write Tests</h3>' +
        '<p>Use SyncTestScheduler for scoring logic tests, and pytest-asyncio for async integration tests.</p>',
      summary: 'To add an adapter: create the file, define model weights and estimate_weight(), implement the lifecycle (submit task, acquire, API call, record tokens, dequeue, release), and write tests. Use direct wrap for simple frameworks, split API for callback-based ones.',
      mentalModel: 'Building an adapter is like building a translator. You need to know both languages: your framework\'s vocabulary (model names, API patterns) and LOCO\'s vocabulary (weight, submit, acquire, release). The translator converts between them so they can communicate.',
      mistakes: [
        'Forgetting to call serve_oldest_task() -- without dequeuing, the task stays in the queue forever, corrupting Qi and all future scoring',
        'Not recording actual token usage -- empirical tracking improves weight estimates over time. Without it, you rely entirely on static estimates',
        'Storing AcquireHandle in a local variable for callback adapters -- if the callback loses the reference, the resource leaks. Store handles in a dict keyed by request ID'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create a mock API client.</strong><br>' +
        '<pre><code>import asyncio\n\nclass MockLLMClient:\n    """Simulates an LLM API that takes a short time to respond."""\n    async def generate(self, model, prompt, **kwargs):\n        await asyncio.sleep(0.05)  # simulate network latency\n        class Response:\n            text = f"Mock response to: {prompt[:30]}"\n            class usage:\n                input_tokens = len(prompt) // 4\n                output_tokens = 50\n                total_tokens = input_tokens + output_tokens\n        return Response()</code></pre>' +
        '<strong>Step 3 -- Create a minimal adapter implementing the full lifecycle.</strong><br>' +
        '<pre><code>from loco import AsyncLOCOScheduler, SharedResource, Task\n\nMODEL_WEIGHTS = {"large": 5.0, "medium": 2.0, "small": 1.0}\n\ndef estimate_weight(model, input_tokens=None):\n    base = MODEL_WEIGHTS.get(model, 2.0)\n    if input_tokens and input_tokens > 0:\n        return base * max(input_tokens / 1000, 1.0)\n    return base\n\nclass MockAdapter:\n    def __init__(self, scheduler, client):\n        self.scheduler = scheduler\n        self.client = client\n\n    async def call(self, agent_id, *, model="medium", prompt="", **kwargs):\n        # 1. Estimate weight\n        input_tokens = len(prompt) // 4\n        weight = estimate_weight(model, input_tokens or None)\n        task = Task(weight=weight, task_type=f"mock:{model}")\n\n        # 2. Submit task to scheduler\n        await self.scheduler.submit_task(agent_id, task)\n\n        # 3. Acquire resource and execute\n        async with self.scheduler.acquire(agent_id):\n            response = await self.client.generate(\n                model=model, prompt=prompt, **kwargs\n            )\n\n            # 4. Record actual token usage\n            if hasattr(response, "usage"):\n                self.scheduler.metrics.record_actual_tokens(\n                    agent_id, task, response.usage.total_tokens\n                )\n\n            # 5. Dequeue the served task\n            self.scheduler.get_agent(agent_id).serve_oldest_task()\n\n        # 6. Resource auto-released here\n        return response</code></pre>' +
        '<strong>Step 4 -- Test the adapter and verify metrics.</strong><br>' +
        '<pre><code>from loco import Agent\n\nasync def test_adapter():\n    agents = [Agent(agent_id="analyst")]\n    resource = SharedResource(name="mock_api", capacity=2)\n    scheduler = AsyncLOCOScheduler(agents, resource, optimize_for="balanced")\n    adapter = MockAdapter(scheduler, MockLLMClient())\n\n    # Make 3 calls\n    r1 = await adapter.call("analyst", model="large", prompt="Analyze this dataset")\n    r2 = await adapter.call("analyst", model="small", prompt="Hello")\n    r3 = await adapter.call("analyst", model="medium", prompt="Summarize")\n\n    print(f"Response: {r1.text}")\n    print(f"\\nMetrics:")\n    print(f"  Cost by agent: {scheduler.metrics.cost_by_agent()}")\n    print(f"  Total cost: {scheduler.metrics.total_cost()}")\n    print(f"  Completed: {scheduler.metrics.completed_by_agent()}")\n    print(f"  Logical tick: {scheduler.logical_tick}")\n\nasyncio.run(test_adapter())</code></pre>' +
        'You should see costs accumulated per agent and 3 completed tasks. The adapter handled the full lifecycle: weight estimation, submit, acquire, API call, token recording, dequeue, release.<br><br>' +
        '<strong>Step 5 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'adding-policies',
      title: 'How to Add a New Policy',
      content: '<p>Custom policies let you add governance rules without touching the scheduler core. Here is how to create one from scratch.</p>' +
        '<h3>Step 1: Subclass Policy</h3>' +
        '<pre><code>from loco.policy import Policy, PolicyViolationError\nfrom loco.task import Task\n\nclass TeamQuotaPolicy(Policy):\n    """Enforce per-team request quotas."""\n    name = "team_quota"  # Unique name for logs/audit\n\n    def __init__(self, team_limits: dict[str, int]):\n        self._limits = team_limits\n        self._counts: dict[str, int] = {}</code></pre>' +
        '<h3>Step 2: Implement check()</h3>' +
        '<pre><code>    def check(self, agent_id: str, task: Task) -> bool:\n        # Extract team from agent_id (e.g., "analytics-agent1" -> "analytics")\n        team = agent_id.split("-")[0]\n        limit = self._limits.get(team)\n        if limit is None:\n            return True  # No limit for this team\n\n        count = self._counts.get(team, 0)\n        if count >= limit:\n            raise PolicyViolationError(\n                self.name, agent_id,\n                f"Team {team} exceeded quota ({count}/{limit})"\n            )\n        return True</code></pre>' +
        '<h3>Step 3: Implement record() (Optional)</h3>' +
        '<pre><code>    def record(self, agent_id: str, task: Task) -> None:\n        team = agent_id.split("-")[0]\n        self._counts[team] = self._counts.get(team, 0) + 1</code></pre>' +
        '<h3>Step 4: Wire Into the Scheduler</h3>' +
        '<pre><code>from loco.policy import PolicyEnforcer\n\nenforcer = PolicyEnforcer([\n    RatePolicy(default_limit=100),\n    TeamQuotaPolicy({"analytics": 500, "chatbot": 2000}),\n    BudgetPolicy(default_limit=1000.0),\n])\n\nscheduler = AsyncLOCOScheduler(\n    [], resource,\n    enforcer=enforcer\n)</code></pre>' +
        '<h3>Guidelines</h3>' +
        '<ul><li><strong>check() should be fast</strong> -- it runs on every acquire(). Avoid I/O or expensive computation.</li><li><strong>check() should be idempotent</strong> -- the scheduler might call it multiple times for the same task.</li><li><strong>record() is for accounting</strong> -- update state after the task completes, not during check().</li><li><strong>Name must be unique</strong> -- PolicyEnforcer uses the name for lookup and removal.</li></ul>',
      summary: 'To add a policy: subclass Policy, set a unique name, implement check() to validate (return True or raise PolicyViolationError), optionally implement record() for accounting, and wire into PolicyEnforcer. Keep check() fast and idempotent.',
      mentalModel: 'Adding a policy is like adding a new checkpoint to airport security. Define what you are checking for (check), what you record about each passenger (record), and where it goes in the screening order (PolicyEnforcer position). The checkpoint must be fast -- you cannot interview everyone for 30 minutes.',
      mistakes: [
        'Modifying state in check() -- check should only validate, not update counters or spend. Use record() for state changes, which runs after task completion',
        'Not raising PolicyViolationError -- returning False silently may be swallowed. Raise the error with context (policy name, agent, detail) for proper error handling',
        'Duplicate policy names -- PolicyEnforcer uses names for lookup. Two policies named "budget" will confuse remove_policy() and get_policy()'
      ],
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create a custom TimeOfDayPolicy.</strong><br>' +
        '<pre><code>from datetime import datetime\nfrom loco import Task\nfrom loco.policy import Policy, PolicyEnforcer, PolicyViolationError\n\nclass TimeOfDayPolicy(Policy):\n    """Restrict expensive tasks to off-peak hours."""\n    name = "time_of_day"\n\n    def __init__(self, peak_start=9, peak_end=17, max_peak_weight=3.0):\n        self.peak_start = peak_start\n        self.peak_end = peak_end\n        self.max_peak_weight = max_peak_weight\n\n    def is_peak_hour(self):\n        hour = datetime.now().hour\n        return self.peak_start <= hour < self.peak_end\n\n    def check(self, agent_id, task):\n        if self.is_peak_hour() and task.weight > self.max_peak_weight:\n            raise PolicyViolationError(\n                self.name, agent_id,\n                f"weight {task.weight} exceeds peak-hour max {self.max_peak_weight} "\n                f"(peak hours: {self.peak_start}:00-{self.peak_end}:00)"\n            )\n        return True\n\npolicy = TimeOfDayPolicy()\nprint(f"Current hour: {datetime.now().hour}")\nprint(f"Is peak hour: {policy.is_peak_hour()}")</code></pre>' +
        '<strong>Step 3 -- Test the policy.</strong><br>' +
        '<pre><code># Cheap task -- always allowed regardless of time\ncheap = Task(weight=1.0)\ntry:\n    policy.check("agent-1", cheap)\n    print(f"Cheap task (weight=1.0): allowed")\nexcept PolicyViolationError as e:\n    print(f"Cheap task: rejected (unexpected)")\n\n# Expensive task -- depends on time of day\nexpensive = Task(weight=5.0)\ntry:\n    policy.check("agent-1", expensive)\n    print(f"Expensive task (weight=5.0): allowed (off-peak or non-peak hour)")\nexcept PolicyViolationError as e:\n    print(f"Expensive task (weight=5.0): REJECTED")\n    print(f"  {e.detail}")</code></pre>' +
        'If you are running this during business hours (9am-5pm), the expensive task should be rejected. Outside those hours, it passes.<br><br>' +
        '<strong>Step 4 -- Wire it into a PolicyEnforcer with other policies.</strong><br>' +
        '<pre><code>from loco import BudgetPolicy\n\nenforcer = PolicyEnforcer([\n    TimeOfDayPolicy(peak_start=9, peak_end=17, max_peak_weight=3.0),\n    BudgetPolicy(default_limit=50.0, on_exceeded="reject"),\n])\n\n# Test with a cheap task (should always pass both policies)\ncheap = Task(weight=1.0)\ntry:\n    passed = enforcer.check_all("agent-1", cheap)\n    print(f"Cheap task passed: {passed}")\nexcept PolicyViolationError as e:\n    print(f"Rejected by: {e.policy_name}")</code></pre>' +
        'The enforcer runs TimeOfDayPolicy first (cheapest check), then BudgetPolicy. If time-of-day rejects, the budget is never checked -- short-circuit evaluation.<br><br>' +
        '<strong>Step 5 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    },
    {
      id: 'key-files-reference',
      title: 'Key Files Quick Reference',
      content: '<p>When you need to understand or modify a specific part of LOCO, here is exactly where to look.</p>' +
        '<h3>By Contribution Type</h3>' +
        '<table style="width:100%; border-collapse:collapse; margin:16px 0;"><tr style="border-bottom:2px solid var(--border);"><th style="text-align:left; padding:8px;">Task</th><th style="text-align:left; padding:8px;">Files</th></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">Understand the core algorithm</td><td style="padding:8px;"><code>scheduler.py</code></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">Async resource management</td><td style="padding:8px;"><code>async_scheduler.py</code> + <code>resource.py</code></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">Add a new policy</td><td style="padding:8px;"><code>policy.py</code> (base + builtins)</td></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">Add a new adapter</td><td style="padding:8px;"><code>adapters/base.py</code> + <code>adapters/anthropic.py</code></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">Write tests</td><td style="padding:8px;"><code>testing.py</code> + <code>tests/test_scheduler.py</code></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">Cost tracking</td><td style="padding:8px;"><code>metrics.py</code></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">SLO monitoring</td><td style="padding:8px;"><code>slo.py</code></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">Budget enforcement</td><td style="padding:8px;"><code>budget.py</code> + <code>policy.py</code></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">Execution plans</td><td style="padding:8px;"><code>plan.py</code></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">Adaptive tuning</td><td style="padding:8px;"><code>adaptive.py</code></td></tr>' +
        '<tr style="border-bottom:1px solid var(--border);"><td style="padding:8px;">Convenience API</td><td style="padding:8px;"><code>convenience.py</code></td></tr>' +
        '<tr><td style="padding:8px;">CLI</td><td style="padding:8px;"><code>cli.py</code></td></tr></table>' +
        '<h3>The Three Architecture Layers</h3>' +
        '<pre><code>Layer 1: LOCOScheduler (scheduler.py)\n  Pure math: compute_load_scores(), select_agent(), _step()\n  No async, no I/O. Used directly for testing.\n         |\n         v\nLayer 2: AsyncLOCOScheduler (async_scheduler.py)\n  Async I/O: acquire(), release(), submit_task()\n  Manages SharedResource, policies, metrics, hooks.\n         |\n         v\nLayer 3: Adapters (adapters/*.py)\n  Framework glue: weight estimation, API wrapping.\n  Converts framework patterns to LOCO lifecycle.</code></pre>' +
        '<h3>Roadmap Context</h3>' +
        '<ul><li><strong>v0.1 (shipped):</strong> Core async scheduler + 4 validated scenarios</li><li><strong>v0.2 (shipped):</strong> 7 framework adapters + BudgetManager + A2A protocol</li><li><strong>v0.3 (current):</strong> PolicyEnforcer + static plans + SLO error budgets + security labels</li><li><strong>v0.4 (next):</strong> Enterprise dashboards (Prometheus, OTEL, Grafana)</li><li><strong>v0.5+ (future):</strong> Dynamic plans, cross-provider routing, LOCO Cloud</li></ul>' +
        '<h3>High-Impact Contribution Areas</h3>' +
        '<ul><li><strong>New framework adapters</strong> -- implement BaseAdapter for additional frameworks</li><li><strong>New policy types</strong> -- extend Policy for team quotas, time-based rules, etc.</li><li><strong>Multi-resource scenarios</strong> -- prove deadlock-safe semantics under load</li><li><strong>Observability</strong> -- OTEL exporter, Prometheus metrics, Grafana dashboards (v0.4)</li><li><strong>Enterprise cost governance</strong> -- per-team, per-workflow, per-model attribution</li></ul>',
      summary: 'Quick reference for which files to read for any contribution type. The architecture has three layers: LOCOScheduler (math), AsyncLOCOScheduler (async I/O), and Adapters (framework glue). High-impact areas include new adapters, policies, and observability.',
      mentalModel: 'This quick reference is your map of the LOCO codebase. Like a mall directory, it tells you which floor (layer) and which store (file) to visit for what you need. The three layers are like three floors: math on the ground floor, async I/O on the second floor, and framework adapters on the top floor.',
      mistakes: [
        'Modifying scheduler.py when you should modify async_scheduler.py -- the sync scheduler is for scoring math only. Resource management, policies, and hooks belong in the async layer',
        'Adding framework-specific logic to the core -- adapters exist to keep framework dependencies out of the core. Never import anthropic, openai, etc. in scheduler.py or async_scheduler.py',
        'Contributing without running the full test suite -- always run pytest before submitting. The 389 tests are fast and catch regressions'
      ],
      exercise: '<strong>This exercise is a guided exploration of the codebase.</strong><br><br>' +
        '<strong>Step 1 -- Pick a contribution area.</strong> Choose one from the table that interests you:<br>' +
        '<ul>' +
        '<li><strong>Core algorithm:</strong> <code>loco/scheduler.py</code> + <code>tests/test_scheduler.py</code></li>' +
        '<li><strong>Async scheduling:</strong> <code>loco/async_scheduler.py</code> + <code>tests/test_async_scheduler.py</code></li>' +
        '<li><strong>Policies:</strong> <code>loco/policy.py</code> + <code>tests/test_policy.py</code></li>' +
        '<li><strong>Adapters:</strong> <code>loco/adapters/anthropic.py</code> + <code>tests/test_adapters.py</code></li>' +
        '<li><strong>Metrics:</strong> <code>loco/metrics.py</code> + <code>tests/test_metrics.py</code></li>' +
        '</ul>' +
        '<strong>Step 2 -- Read the source file top to bottom.</strong> Note the class hierarchy, public methods, and internal helpers. Pay attention to docstrings and type hints -- they describe the contract each method promises.<br><br>' +
        '<strong>Step 3 -- Read 3-5 tests for that module.</strong> Run the specific test file with verbose output:<br>' +
        '<pre><code># Replace with your chosen test file:\npytest tests/test_scheduler.py -v --tb=short 2>&1 | head -40</code></pre>' +
        'Read the test names to understand what behaviors are validated. Good test names describe the expected behavior: <code>test_alpha_025_score_ordering</code> tells you exactly what it checks.<br><br>' +
        '<strong>Step 4 -- Identify one improvement.</strong> As you read, look for:<br>' +
        '<ul>' +
        '<li>A missing edge case test (e.g., empty input, single agent, all-tied scores)</li>' +
        '<li>A docstring that could be clearer</li>' +
        '<li>A test that does not include a hand-calculated expected value</li>' +
        '</ul>' +
        '<strong>Step 5 -- Write one new test.</strong> Open a Python REPL and draft it:<br>' +
        '<pre><code>python3</code></pre>' +
        '<pre><code>from loco.testing import SyncTestScheduler, mock_agent\n\ndef test_your_improvement():\n    """Describe what this test verifies and why."""\n    # Setup: create agents with specific properties\n    agents = [mock_agent("a", pending_tasks=5)]\n    scheduler = SyncTestScheduler(agents, alpha=0.25, seed=42)\n\n    # Act: run the scenario\n    result = scheduler.run_all()\n\n    # Assert: verify the expected behavior\n    assert result.total_ticks == 5\n    assert result.service_counts["a"] == 5\n    print("Your new test passes!")\n\ntest_your_improvement()</code></pre>' +
        'Modify this template for your specific improvement. When it passes in the REPL, save it to the appropriate test file.<br><br>' +
        '<strong>Step 6 -- Run the full suite to check for regressions.</strong><br>' +
        '<pre><code>exit()  # leave the REPL\npytest</code></pre>' +
        'All existing tests plus your new one should pass.'
    }
  ]
});
