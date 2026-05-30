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
      exercise: 'Clone the repo, install, and run <code>pytest</code>. All 389 tests should pass. Then run <code>ruff check .</code> to verify the codebase is clean. Finally, run <code>python examples/burst.py</code> and read the output to see LOCO in action.'
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
      exercise: 'Create a minimal adapter for a mock API client (one that just returns a fixed response after an asyncio.sleep). Implement the full lifecycle: weight estimation, task submission, acquire, "API call," token recording, dequeue, release. Test it with an AsyncLOCOScheduler and verify metrics are recorded correctly.'
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
      exercise: 'Create a <code>TimeOfDayPolicy</code> that restricts expensive tasks (weight > 3.0) to off-peak hours (8pm-6am). Allow cheap tasks anytime. Wire it into a PolicyEnforcer and test that expensive tasks during peak hours raise PolicyViolationError while cheap tasks always pass.'
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
      exercise: 'Pick a contribution type from the table above that interests you. Read the corresponding source file(s) from top to bottom. Then find the matching test file in tests/ and read 3-5 tests to understand how the code is validated. Finally, identify one small improvement or new test you could add.'
    }
  ]
});
