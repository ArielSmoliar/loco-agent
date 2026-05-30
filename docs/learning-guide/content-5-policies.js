window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'policies',
  title: 'Policies & Governance',
  topics: [
    {
      id: 'policy-base-class',
      title: 'The Policy Base Class',
      content: '<p>The <strong>Policy</strong> class in <code>loco/policy.py</code> is the foundation for all governance rules in LOCO-Agent. It defines a simple interface that any custom policy must implement.</p>' +
        '<h3>The Interface</h3>' +
        '<pre><code>class Policy(ABC):\n    """Base class for all scheduling policies."""\n\n    name: str = "base"  # Identifies the policy in logs\n\n    @abstractmethod\n    def check(self, agent_id: str, task: Task) -> bool:\n        """Check if the task is allowed for this agent.\n        Returns True if allowed.\n        Raises PolicyViolationError on rejection.\"\"\"\n\n    def record(self, agent_id: str, task: Task) -> None:\n        """Called after task completes. Override for accounting."""</code></pre>' +
        '<h3>Two Responsibilities</h3>' +
        '<p><strong>check()</strong> is called BEFORE a task is granted. It is the gate -- return True to allow, raise PolicyViolationError to reject. This is the only required method.</p>' +
        '<p><strong>record()</strong> is called AFTER a task completes. Override this for accounting (e.g., tracking spend, counting calls). The default implementation does nothing.</p>' +
        '<h3>PolicyViolationError</h3>' +
        '<pre><code>class PolicyViolationError(Exception):\n    def __init__(self, policy_name: str, agent_id: str, detail: str):\n        self.policy_name = policy_name\n        self.agent_id = agent_id\n        self.detail = detail\n        super().__init__(\n            f"Policy {policy_name!r} violated by agent {agent_id!r}: {detail}"\n        )</code></pre>' +
        '<p>The error carries three pieces of context: which policy failed, which agent triggered it, and a human-readable detail message.</p>' +
        '<h3>Creating a Custom Policy</h3>' +
        '<pre><code>class MaxWeightPolicy(Policy):\n    """Reject tasks heavier than a threshold."""\n    name = "max_weight"\n\n    def __init__(self, max_weight: float = 10.0):\n        self.max_weight = max_weight\n\n    def check(self, agent_id: str, task: Task) -> bool:\n        if task.weight > self.max_weight:\n            raise PolicyViolationError(\n                self.name, agent_id,\n                f"weight {task.weight} > max {self.max_weight}"\n            )\n        return True</code></pre>',
      summary: 'Policy is an abstract base class with two methods: check() (gate before task execution, required) and record() (accounting after completion, optional). Custom policies subclass Policy, set a name, and implement check() to either return True or raise PolicyViolationError.',
      mentalModel: 'A Policy is like a bouncer at a club. check() is the bouncer looking at your ID at the door -- they either let you in (return True) or turn you away (raise PolicyViolationError). record() is the bouncer noting your visit in the logbook as you leave.',
      mistakes: [
        'Returning False instead of raising PolicyViolationError -- while False works for some internal paths, PolicyViolationError provides the context (policy name, agent, detail) needed for debugging and audit logs',
        'Forgetting to set the name class attribute -- the name identifies the policy in logs, error messages, and the PolicyEnforcer. Leaving it as "base" makes debugging hard',
        'Doing side effects in check() -- check should only validate, not modify state. Use record() for state changes after task completion'
      ],
      exercise: 'Create a custom Policy called <code>BusinessHoursPolicy</code> that only allows tasks between 9am and 5pm. Implement check() to raise PolicyViolationError outside business hours. Test it by creating tasks and checking them at different times.'
    },
    {
      id: 'policy-enforcer',
      title: 'PolicyEnforcer',
      content: '<p>The <strong>PolicyEnforcer</strong> evaluates an ordered list of policies at dispatch time. It is the bridge between individual policies and the scheduler.</p>' +
        '<h3>Core Design: Short-Circuit Evaluation</h3>' +
        '<pre><code>class PolicyEnforcer:\n    def __init__(self, policies: list[Policy] | None = None):\n        self._policies = list(policies) if policies else []\n\n    def check_all(self, agent_id: str, task: Task) -> list[str]:\n        """Run all policies in order. Short-circuits on first rejection."""\n        passed: list[str] = []\n        for policy in self._policies:\n            policy.check(agent_id, task)\n            passed.append(policy.name)\n        return passed\n\n    def record_all(self, agent_id: str, task: Task) -> None:\n        """Record task completion to ALL policies."""\n        for policy in self._policies:\n            policy.record(agent_id, task)</code></pre>' +
        '<p>Key behavior: <code>check_all()</code> runs policies in order. If any raises PolicyViolationError, subsequent policies are <strong>not checked</strong>. The returned list shows which policies passed before the failure.</p>' +
        '<p>In contrast, <code>record_all()</code> always runs ALL policies -- recording is not conditional.</p>' +
        '<h3>Managing Policies</h3>' +
        '<pre><code>enforcer.add_policy(my_policy)           # Append to list\nenforcer.remove_policy("budget")         # Remove by name\nenforcer.get_policy("rate")              # Look up by name\nlen(enforcer)                            # Number of policies\nbool(enforcer)                           # True if any policies</code></pre>' +
        '<h3>Wiring to the Scheduler</h3>' +
        '<pre><code>enforcer = PolicyEnforcer([\n    BudgetPolicy(default_limit=100.0),\n    AccessPolicy(rules={...}),\n    RatePolicy(limits={...}),\n])\n\nscheduler = AsyncLOCOScheduler(\n    agents, resource,\n    enforcer=enforcer  # Policies checked on every acquire()\n)</code></pre>' +
        '<h3>When Policies Run in the Lifecycle</h3>' +
        '<p>Policy checks happen <strong>BEFORE</strong> metrics recording, logging, and lifecycle hooks. This means rejected tasks do not inflate cost metrics or appear in grant logs. The order matters:</p>' +
        '<ol><li>Resource acquired</li><li>Policy check (can reject here)</li><li>Metrics recorded</li><li>Logs emitted</li><li>on_task_started hook fired</li><li>Caller code runs</li><li>Policies record completion</li><li>on_task_completed hook fired</li></ol>',
      summary: 'PolicyEnforcer evaluates an ordered list of policies at dispatch time. check_all() short-circuits on the first rejection. record_all() runs all policies after completion. Policy checks happen BEFORE metrics and hooks, so rejected tasks do not inflate costs.',
      mentalModel: 'PolicyEnforcer is like airport security with multiple checkpoints. You pass through ID check, luggage scan, and body scan in order. If you fail at any checkpoint, you are turned away -- you never reach the later checkpoints. But when you leave (record_all), every checkpoint notes your departure.',
      mistakes: [
        'Assuming all policies run even after a rejection -- check_all short-circuits on the first failure. Order your policies from cheapest to most expensive checks',
        'Forgetting that policy order matters -- if BudgetPolicy is first and rejects, AccessPolicy never runs. Put the most critical check first',
        'Not wiring the enforcer to the scheduler -- creating a PolicyEnforcer does nothing unless you pass it as enforcer= to AsyncLOCOScheduler'
      ],
      exercise: 'Create a PolicyEnforcer with two policies: one that always passes and one that always rejects. Wire it to an AsyncLOCOScheduler. Call acquire() and verify that PolicyViolationError is raised. Then swap the order and verify the error comes from the policy that is first in the list.'
    },
    {
      id: 'budget-policy',
      title: 'BudgetPolicy',
      content: '<p>The <strong>BudgetPolicy</strong> in <code>loco/budget.py</code> implements per-agent spend limits. It extends the Policy base class and tracks cumulative cost per agent.</p>' +
        '<h3>Three Enforcement Modes</h3>' +
        '<pre><code>budget = BudgetPolicy(\n    default_limit=100.0,    # Default budget for all agents\n    on_exceeded="reject"    # "reject", "alert", or "downgrade"\n)</code></pre>' +
        '<ul><li><strong>"reject" (default):</strong> Raises BudgetExceededError -- hard stop</li><li><strong>"alert":</strong> Logs a warning but allows the task -- soft warning</li><li><strong>"downgrade":</strong> Allows but flags for weight reduction -- cost awareness</li></ul>' +
        '<h3>Managing Budgets</h3>' +
        '<pre><code>budget.set_limit("expensive-agent", max_cost=50.0)  # Per-agent limit\nbudget.spent("expensive-agent")      # -> 23.5 (cumulative)\nbudget.remaining("expensive-agent")  # -> 26.5\nbudget.reset("expensive-agent")      # Reset spend counter\nbudget.reset_all()                   # Reset everything</code></pre>' +
        '<h3>Budget Units = Weight Units</h3>' +
        '<p>Budget units are the same as task weight units. An opus call (weight=5.0) costs 5 budget units. A haiku call (weight=1.0) costs 1 unit. If an agent\'s budget is 50.0, it can make 10 opus calls or 50 haiku calls.</p>' +
        '<h3>Recording Spend</h3>' +
        '<p>Spend is recorded via the <code>record()</code> method (called by PolicyEnforcer after task completion):</p>' +
        '<pre><code>def record(self, agent_id: str, task: Task) -> None:\n    """Record task completion cost."""\n    self.record_spend(agent_id, task.weight)</code></pre>' +
        '<h3>BudgetExceededError</h3>' +
        '<pre><code>class BudgetExceededError(PolicyViolationError):\n    def __init__(self, agent_id, current, limit, task_cost):\n        self.current = current\n        self.limit = limit\n        self.task_cost = task_cost\n        detail = f"current={current:.1f} + task={task_cost:.1f} > limit={limit:.1f}"</code></pre>' +
        '<h3>Legacy Compatibility</h3>' +
        '<p><code>BudgetManager</code> is an alias for <code>BudgetPolicy</code>. You can also pass <code>budget=</code> directly to AsyncLOCOScheduler (legacy v0.2 API), which auto-wraps it in a PolicyEnforcer.</p>',
      summary: 'BudgetPolicy tracks per-agent spend and enforces limits in three modes: reject (hard stop), alert (warn but allow), and downgrade (allow + flag). Budget units equal task weight units. BudgetManager is a backward-compatibility alias.',
      mentalModel: 'BudgetPolicy is like a prepaid debit card. Each agent has a balance (budget limit). Every API call deducts from the balance (by the task weight). When the balance hits zero, the card is declined (reject mode), or the bank sends a warning (alert mode), or the card switches to a cheaper plan (downgrade mode).',
      mistakes: [
        'Confusing budget units with dollars -- budget units are weight units. An opus call costs 5 units, not $5. The mapping to actual dollars depends on your pricing model',
        'Not calling reset() periodically -- budgets are cumulative. Without periodic resets, every agent eventually exhausts its budget. Consider resetting daily or per-session',
        'Using BudgetManager directly instead of through PolicyEnforcer -- while the legacy budget= parameter works, the modern approach is PolicyEnforcer([BudgetPolicy(...)]) for composability'
      ],
      exercise: 'Create a BudgetPolicy with default_limit=10.0. Set a tighter limit for one agent. Submit tasks with different weights and verify that BudgetExceededError is raised when the cumulative weight exceeds the limit. Test all three modes (reject, alert, downgrade) and observe the different behaviors.'
    },
    {
      id: 'builtin-policies',
      title: 'Built-in Policies: Access and Rate',
      content: '<p>LOCO ships with two additional built-in policies beyond BudgetPolicy: <strong>AccessPolicy</strong> for security labels and <strong>RatePolicy</strong> for request rate limits.</p>' +
        '<h3>AccessPolicy</h3>' +
        '<pre><code>class AccessPolicy(Policy):\n    name = "access"\n\n    def __init__(self, rules: dict[str, dict[str, list[str]]]):\n        self._rules = rules</code></pre>' +
        '<p><strong>Open by default:</strong> agents NOT listed in rules are allowed to process any task. Only agents with explicit rules are constrained.</p>' +
        '<pre><code>access = AccessPolicy(rules={\n    "intern-agent": {\n        "labels": ["public"]  # Can only handle public data\n    },\n    "senior-agent": {\n        "labels": ["public", "internal", "confidential"]\n    }\n})\n# "other-agent" has no rules -> allowed everything</code></pre>' +
        '<p>AccessPolicy checks task.labels against the agent\'s allowed labels. If a task has a label not in the agent\'s allowed set, PolicyViolationError is raised.</p>' +
        '<h3>RatePolicy</h3>' +
        '<pre><code>class RatePolicy(Policy):\n    name = "rate"\n\n    def __init__(\n        self,\n        limits: dict[str, float] | None = None,\n        period: float = 60.0,\n        default_limit: float | None = None,\n    ):</code></pre>' +
        '<p>Uses a <strong>token bucket algorithm</strong>. Each agent gets a bucket that refills at <code>limit / period</code> tokens per second. Each <code>check()</code> consumes one token. When the bucket is empty, PolicyViolationError is raised.</p>' +
        '<pre><code>rate = RatePolicy(\n    limits={"chatbot": 30.0},   # 30 requests per period\n    period=60.0,                # 60-second window\n    default_limit=None           # None = unlimited for unlisted agents\n)\n\nrate.remaining("chatbot")  # -> tokens left in bucket</code></pre>' +
        '<h3>Composing All Three</h3>' +
        '<pre><code>enforcer = PolicyEnforcer([\n    RatePolicy(limits={"chatbot": 30}, default_limit=100),\n    AccessPolicy(rules={"intern": {"labels": ["public"]}}),\n    BudgetPolicy(default_limit=500.0, on_exceeded="reject"),\n])\n\nscheduler = AsyncLOCOScheduler(\n    [], resource,\n    enforcer=enforcer,\n    optimize_for="balanced"\n)</code></pre>' +
        '<p>Order matters: RatePolicy runs first (cheapest check), then AccessPolicy, then BudgetPolicy. Short-circuit evaluation means a rate-limited agent never reaches the budget check.</p>',
      summary: 'AccessPolicy controls which agents can handle which security labels (open by default). RatePolicy enforces per-agent request rate limits using a token bucket algorithm. All three built-in policies (Rate, Access, Budget) compose into a PolicyEnforcer for layered governance.',
      mentalModel: 'The three built-in policies are like three guards at a building entrance. The rate guard checks if you have visited too many times today (token bucket). The access guard checks your security clearance badge (labels). The budget guard checks your spending account balance. You must pass all three to enter.',
      mistakes: [
        'Assuming AccessPolicy is deny-by-default -- it is OPEN by default. Agents without rules in the dict are allowed everything. Only add rules for agents you want to restrict',
        'Setting rate limits too low without considering burst patterns -- the token bucket refills smoothly, so a limit of 10/minute means roughly 1 request every 6 seconds on average, not 10 requests in the first second',
        'Putting expensive policy checks first in the enforcer -- order from cheapest to most expensive for efficiency, since check_all short-circuits'
      ],
      exercise: 'Create a PolicyEnforcer with all three built-in policies. Write tests that trigger each type of violation: exceed a rate limit, access a restricted label, and exceed a budget. Verify that the correct PolicyViolationError subclass is raised in each case.'
    }
  ]
});
