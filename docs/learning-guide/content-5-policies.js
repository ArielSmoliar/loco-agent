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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create a custom Policy subclass.</strong> This policy rejects tasks heavier than a configurable threshold:<br>' +
        '<pre><code>from loco import Task\nfrom loco.policy import Policy, PolicyViolationError\n\nclass MaxWeightPolicy(Policy):\n    """Reject tasks heavier than a threshold."""\n    name = "max_weight"\n\n    def __init__(self, max_weight=10.0):\n        self.max_weight = max_weight\n\n    def check(self, agent_id, task):\n        if task.weight > self.max_weight:\n            raise PolicyViolationError(\n                self.name, agent_id,\n                f"weight {task.weight} exceeds max {self.max_weight}"\n            )\n        return True\n\npolicy = MaxWeightPolicy(max_weight=5.0)\nprint(f"Policy name: {policy.name}")</code></pre>' +
        '<strong>Step 3 -- Test the policy with tasks of different weights.</strong><br>' +
        '<pre><code># Light task -- should pass\nlight = Task(weight=2.0)\nresult = policy.check("agent-1", light)\nprint(f"Light task (weight=2.0): allowed={result}")\n\n# Heavy task -- should be rejected\nheavy = Task(weight=8.0)\ntry:\n    policy.check("agent-1", heavy)\nexcept PolicyViolationError as e:\n    print(f"Heavy task (weight=8.0): REJECTED")\n    print(f"  Policy: {e.policy_name}")\n    print(f"  Agent: {e.agent_id}")\n    print(f"  Detail: {e.detail}")</code></pre>' +
        'The light task passes. The heavy task raises PolicyViolationError with three pieces of context: which policy, which agent, and why.<br><br>' +
        '<strong>Step 4 -- Add a record() method for accounting.</strong><br>' +
        '<pre><code>class CountingPolicy(Policy):\n    """Count how many tasks each agent completes."""\n    name = "counter"\n\n    def __init__(self):\n        self.counts = {}\n\n    def check(self, agent_id, task):\n        return True  # always allow\n\n    def record(self, agent_id, task):\n        self.counts[agent_id] = self.counts.get(agent_id, 0) + 1\n\ncounter = CountingPolicy()\ncounter.record("agent-1", Task(weight=1.0))\ncounter.record("agent-1", Task(weight=2.0))\ncounter.record("agent-2", Task(weight=1.0))\nprint(f"Counts: {counter.counts}")</code></pre>' +
        'check() runs before the task. record() runs after. check() validates; record() tracks. Keep them separate.<br><br>' +
        '<strong>Step 5 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create two policies: one that passes, one that rejects.</strong><br>' +
        '<pre><code>from loco import Task\nfrom loco.policy import Policy, PolicyEnforcer, PolicyViolationError\n\nclass AlwaysPass(Policy):\n    name = "always_pass"\n    def check(self, agent_id, task):\n        print(f"  {self.name}: checking {agent_id} -- PASS")\n        return True\n\nclass AlwaysReject(Policy):\n    name = "always_reject"\n    def check(self, agent_id, task):\n        print(f"  {self.name}: checking {agent_id} -- REJECT")\n        raise PolicyViolationError(self.name, agent_id, "always rejected")</code></pre>' +
        '<strong>Step 3 -- Create an enforcer with pass-first ordering.</strong><br>' +
        '<pre><code>enforcer = PolicyEnforcer([AlwaysPass(), AlwaysReject()])\ntask = Task(weight=1.0)\n\nprint("Order: pass -> reject")\ntry:\n    passed = enforcer.check_all("agent-1", task)\nexcept PolicyViolationError as e:\n    print(f"  Rejected by: {e.policy_name}")\n    print(f"  Detail: {e.detail}")</code></pre>' +
        'AlwaysPass runs first and passes. Then AlwaysReject runs and raises. The error comes from "always_reject".<br><br>' +
        '<strong>Step 4 -- Swap the order and observe short-circuit behavior.</strong><br>' +
        '<pre><code>enforcer2 = PolicyEnforcer([AlwaysReject(), AlwaysPass()])\n\nprint("\\nOrder: reject -> pass")\ntry:\n    enforcer2.check_all("agent-1", task)\nexcept PolicyViolationError as e:\n    print(f"  Rejected by: {e.policy_name}")</code></pre>' +
        'AlwaysReject runs first and immediately raises. AlwaysPass never runs -- you should see only one "checking" message. This is short-circuit evaluation. Order matters: put your cheapest/most-likely-to-reject policies first.<br><br>' +
        '<strong>Step 5 -- Verify record_all runs all policies.</strong><br>' +
        '<pre><code>class RecordingPolicy(Policy):\n    name = "recorder"\n    def __init__(self):\n        self.recorded = []\n    def check(self, agent_id, task):\n        return True\n    def record(self, agent_id, task):\n        self.recorded.append(agent_id)\n\nr1, r2 = RecordingPolicy(), RecordingPolicy()\nr2.name = "recorder2"\nenforcer3 = PolicyEnforcer([r1, r2])\nenforcer3.check_all("agent-1", task)\nenforcer3.record_all("agent-1", task)\nprint(f"\\nr1 recorded: {r1.recorded}")\nprint(f"r2 recorded: {r2.recorded}")</code></pre>' +
        'Unlike check_all (which short-circuits), record_all always runs ALL policies. Both recorders should have one entry.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create a BudgetPolicy and set limits.</strong><br>' +
        '<pre><code>from loco import Task, BudgetPolicy, BudgetExceededError\n\nbudget = BudgetPolicy(default_limit=20.0, on_exceeded="reject")\nbudget.set_limit("expensive-agent", max_cost=8.0)\n\nprint(f"Default limit: {budget.get_limit(\\\"any-agent\\\")}")\nprint(f"Expensive limit: {budget.get_limit(\\\"expensive-agent\\\")}")</code></pre>' +
        '<strong>Step 3 -- Spend budget and watch it drain.</strong><br>' +
        '<pre><code># Simulate 3 opus calls (weight=5.0 each) for expensive-agent\nfor i in range(3):\n    task = Task(weight=5.0)\n    try:\n        budget.check("expensive-agent", task)\n        budget.record("expensive-agent", task)  # records spend\n        remaining = budget.remaining("expensive-agent")\n        print(f"Call {i+1}: spent={budget.spent(\\\"expensive-agent\\\"):.1f}, "\n              f"remaining={remaining:.1f}")\n    except BudgetExceededError as e:\n        print(f"Call {i+1}: REJECTED -- {e.detail}")</code></pre>' +
        'The first call succeeds (spent=5, remaining=3). The second call should be rejected because 5+5=10 would exceed the 8.0 limit.<br><br>' +
        '<strong>Step 4 -- Test "alert" mode (warn but allow).</strong><br>' +
        '<pre><code>alert_budget = BudgetPolicy(default_limit=5.0, on_exceeded="alert")\n\n# This exceeds the limit but alert mode allows it\ntask = Task(weight=10.0)\ntry:\n    alert_budget.check("agent-1", task)\n    alert_budget.record("agent-1", task)\n    print(f"Alert mode: task allowed despite exceeding budget")\n    print(f"Spent: {alert_budget.spent(\\\"agent-1\\\")}")\n    print(f"Alerts: {alert_budget.alerts}")\nexcept BudgetExceededError:\n    print("This should not happen in alert mode")</code></pre>' +
        'In alert mode, the task goes through but a warning is logged. Check <code>budget.alerts</code> to see the warning.<br><br>' +
        '<strong>Step 5 -- Reset and verify.</strong><br>' +
        '<pre><code>budget.reset("expensive-agent")\nprint(f"After reset: spent={budget.spent(\\\"expensive-agent\\\"):.1f}, "\n      f"remaining={budget.remaining(\\\"expensive-agent\\\"):.1f}")</code></pre>' +
        'Reset clears the spend counter back to 0. Without periodic resets, every agent eventually exhausts its budget.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
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
      exercise: '<strong>Step 1 -- Open a Python REPL.</strong> Make sure you are in the <code>loco-agent</code> directory with the virtual environment activated:<br>' +
        '<pre><code>python3</code></pre>' +
        '<strong>Step 2 -- Create all three built-in policies.</strong><br>' +
        '<pre><code>from loco import Task, BudgetPolicy, AccessPolicy, RatePolicy\nfrom loco.policy import PolicyEnforcer, PolicyViolationError\nfrom loco import SecurityLabel\n\nrate = RatePolicy(\n    limits={"chatbot": 3.0},  # 3 requests per period\n    period=60.0,\n    default_limit=100.0,      # generous default\n)\n\naccess = AccessPolicy(rules={\n    "intern": {"labels": ["public"]},        # can only handle public\n    "senior": {"labels": ["public", "internal", "confidential"]},\n})\n\nbudget = BudgetPolicy(default_limit=10.0, on_exceeded="reject")\n\n# Order: cheapest check first\nenforcer = PolicyEnforcer([rate, access, budget])\nprint(f"Policies: {[p.name for p in enforcer._policies]}")</code></pre>' +
        '<strong>Step 3 -- Trigger a rate limit violation.</strong><br>' +
        '<pre><code># Exhaust the chatbot\\\'s 3-request limit\ntask = Task(weight=1.0)\nfor i in range(4):\n    try:\n        enforcer.check_all("chatbot", task)\n        enforcer.record_all("chatbot", task)\n        print(f"Request {i+1}: allowed")\n    except PolicyViolationError as e:\n        print(f"Request {i+1}: REJECTED by {e.policy_name}")</code></pre>' +
        'The first 3 requests pass. Request 4 is rejected by the "rate" policy.<br><br>' +
        '<strong>Step 4 -- Trigger an access policy violation.</strong><br>' +
        '<pre><code># Intern tries to access confidential data\nconfidential_task = Task(weight=1.0, labels={"data": SecurityLabel.CONFIDENTIAL})\ntry:\n    enforcer.check_all("intern", confidential_task)\nexcept PolicyViolationError as e:\n    print(f"Intern + confidential: REJECTED by {e.policy_name}")\n\n# Senior can access confidential -- should pass\ntry:\n    enforcer.check_all("senior", confidential_task)\n    print("Senior + confidential: allowed")\nexcept PolicyViolationError as e:\n    print(f"Unexpected: {e}")\n\n# Unregistered agent has no rules -- open by default\ntry:\n    enforcer.check_all("random-agent", confidential_task)\n    print("Unregistered agent: allowed (open by default)")\nexcept PolicyViolationError as e:\n    print(f"Unexpected: {e}")</code></pre>' +
        'AccessPolicy is open by default. Only agents listed in the rules dict are restricted.<br><br>' +
        '<strong>Step 5 -- Trigger a budget violation.</strong><br>' +
        '<pre><code># Spend the budget with heavy tasks\nheavy = Task(weight=6.0)\ntry:\n    enforcer.check_all("big-spender", heavy)\n    enforcer.record_all("big-spender", heavy)\n    print(f"First heavy task: allowed (spent={budget.spent(\\\"big-spender\\\")})")\n\n    enforcer.check_all("big-spender", heavy)\n    enforcer.record_all("big-spender", heavy)\nexcept PolicyViolationError as e:\n    print(f"Second heavy task: REJECTED by {e.policy_name}")\n    print(f"  {e.detail}")</code></pre>' +
        'First task (cost=6) passes. Second would push total to 12, exceeding the 10.0 limit.<br><br>' +
        '<strong>Step 6 -- Exit the REPL.</strong> Type <code>exit()</code> or press Ctrl+D.'
    }
  ]
});
