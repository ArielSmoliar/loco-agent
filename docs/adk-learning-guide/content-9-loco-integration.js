window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'loco-integration',
  title: '9. LOCO-Agent Integration',
  topics: [
    {
      id: 'wire-adapter',
      title: 'Wiring the ADK Adapter',
      content:
        '<h3>The ADK Adapter</h3>' +
        '<p>LOCO-Agent ships a production-ready ADK adapter at <code>loco/adapters/google_adk.py</code>. The <code>ADKAdapter</code> class implements the split acquire/release pattern through two callbacks: <code>before_model()</code> and <code>after_model()</code>. When wired into an ADK agent\'s <code>before_model_callback</code> and <code>after_model_callback</code>, every LLM call passes through the LOCO scheduler.</p>' +

        '<h3>How It Works</h3>' +
        '<p>The adapter operates in two phases:</p>' +
        '<ol>' +
        '<li><strong>before_model()</strong> -- Extracts the model name from <code>ctx.model</code> and agent name from <code>ctx.agent_name</code>. Estimates the task weight based on the model (gemini-2.5-pro = 3.0, flash = 1.0 -- heavier models get higher weights). Submits a task to the LOCO scheduler and <strong>acquires a resource slot</strong>. The agent\'s LLM call blocks here until the scheduler grants a slot. If the system is at capacity, the agent waits in the queue.</li>' +
        '<li><strong>after_model()</strong> -- Releases the slot and triggers <code>serve_oldest_task()</code> to dequeue the next waiting agent. This is the signal that a resource unit is now available for another agent.</li>' +
        '</ol>' +

        '<h3>Handle Management</h3>' +
        '<p>The adapter stores handles (resource slot references) per <code>agent_name</code>. This is important for ParallelAgent support: when 10 agents run concurrently, each holds its own slot, and releasing one slot does not affect the others. The handle map ensures that <code>after_model()</code> releases the correct slot for the agent that just finished.</p>' +
        '<pre><code># Simplified view of the adapter\'s internal state\nself._handles = {\n    \'agent_a\': &lt;ResourceHandle: slot 1&gt;,\n    \'agent_b\': &lt;ResourceHandle: slot 2&gt;,\n    \'agent_c\': &lt;ResourceHandle: slot 3&gt;,\n    # agent_d is waiting in the queue...\n}</code></pre>' +

        '<h3>Auto-Registration</h3>' +
        '<p>The adapter automatically registers agents with the LOCO scheduler on first call. You do not need to pre-declare agents -- when <code>before_model()</code> sees an agent_name for the first time, it creates a LOCO agent with the appropriate model weight. This means the adapter works with dynamically created agents, template agents with nested sub-agents, and workflow graphs -- any agent that has a <code>before_model_callback</code> will be auto-registered.</p>' +

        '<h3>Wiring the Adapter</h3>' +
        '<p>Connecting the adapter to an ADK agent is two lines:</p>' +
        '<pre><code>from loco.adapters.google_adk import ADKAdapter\nfrom loco.scheduler import Scheduler\nfrom loco.resources import SharedResource\n\n# Create the scheduler with a capacity limit\nscheduler = Scheduler(\n    resource=SharedResource(capacity=3)  # Max 3 concurrent LLM calls\n)\n\n# Create the adapter\nadapter = ADKAdapter(scheduler=scheduler)\n\n# Wire it into any ADK agent\nagent = Agent(\n    name=\'my_agent\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'...\',\n    before_model_callback=adapter.before_model,\n    after_model_callback=adapter.after_model\n)</code></pre>' +
        '<p>That is it. Every LLM call this agent makes now passes through the LOCO scheduler. If the scheduler\'s resource is at capacity, the call blocks until a slot opens.</p>',

      summary: 'The ADK adapter at loco/adapters/google_adk.py implements before_model() and after_model() callbacks. before_model acquires a scheduler slot (blocking if at capacity). after_model releases it and dequeues the next waiting agent. Handles are stored per agent_name for ParallelAgent support. Auto-registration creates LOCO agents on first call.',

      mentalModel: 'The ADK adapter is like installing a flow valve on a water pipe -- the water (LLM calls) still flows through the same pipe (ADK callbacks), but now there is a valve (LOCO scheduler) that controls how much flows at once.',

      mistakes: [
        'Forgetting to install loco-agent in the same virtualenv as ADK -- the import will fail. Run pip install loco-agent (or install from the local repo) in the same environment.',
        'Not setting the resource capacity correctly -- too low means unnecessary waiting (agents queue even when the API could handle more), too high means no scheduling effect (all agents fire and you still hit rate limits).',
        'Assuming the adapter handles before_agent_callback -- it does not. It hooks into before_model_callback only. The two-layer architecture (covered in Topic 3) addresses this gap.',
        'Not checking that agent auto-registration worked -- the adapter creates LOCO agents on first call. Check the scheduler\'s agent list after the first invocation to verify registration.'
      ],

      exercise:
        '<p><strong>Step 1: Install LOCO-Agent</strong></p>' +
        '<pre><code># If you have the LOCO-Agent repo locally:\npip install -e /path/to/loco-agent\n\n# Or from PyPI (when published):\npip install loco-agent</code></pre>' +
        '<p>Verify the installation:</p>' +
        '<pre><code>python -c "from loco.adapters.google_adk import ADKAdapter; print(\'OK\')"</code></pre>' +

        '<p><strong>Step 2: Create a scheduled agent</strong></p>' +
        '<p>Create <code>adk_loco/scheduled_agent/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent\nfrom loco.adapters.google_adk import ADKAdapter\nfrom loco.scheduler import Scheduler\nfrom loco.resources import SharedResource\n\n# Create scheduler with capacity 3\nscheduler = Scheduler(\n    resource=SharedResource(capacity=3)\n)\nadapter = ADKAdapter(scheduler=scheduler)\n\nroot_agent = Agent(\n    name=\'scheduled_agent\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'You are a helpful assistant. Answer questions clearly and concisely.\'\n    ),\n    before_model_callback=adapter.before_model,\n    after_model_callback=adapter.after_model\n)</code></pre>' +

        '<p><strong>Step 3: Run and check the logs</strong></p>' +
        '<pre><code>cd adk_loco\nadk run scheduled_agent</code></pre>' +
        '<p>Send "What is the capital of France?" Watch the terminal output for LOCO log messages. You should see:</p>' +
        '<ol>' +
        '<li>before_model: agent "scheduled_agent" acquiring slot</li>' +
        '<li>The LLM call executes and returns a response</li>' +
        '<li>after_model: agent "scheduled_agent" releasing slot</li>' +
        '</ol>' +

        '<p><strong>Step 4: Inspect scheduler state</strong></p>' +
        '<p>Add a diagnostic print after the first invocation:</p>' +
        '<pre><code># Add to your agent file or run interactively\nprint(f"Registered agents: {list(scheduler.agents.keys())}")\nprint(f"Resource capacity: {scheduler.resource.capacity}")\nprint(f"Resource in use: {scheduler.resource.in_use}")</code></pre>' +
        '<p>Verify that the agent was auto-registered and the resource counters are correct (in_use should be 0 after the call completes).</p>' +

        '<p><strong>Step 5: Test with a simple pipeline</strong></p>' +
        '<p>Create a SequentialAgent with 3 sub-agents, all wired to the same adapter:</p>' +
        '<pre><code>agents = []\nfor i in range(3):\n    agents.append(Agent(\n        name=f\'worker_{i}\',\n        model=\'gemini-2.5-flash\',\n        instruction=f\'You are worker {i}. Say hello and state your number.\',\n        output_key=f\'result_{i}\',\n        before_model_callback=adapter.before_model,\n        after_model_callback=adapter.after_model\n    ))\n\nfrom google.adk.agents import SequentialAgent\nroot_agent = SequentialAgent(name=\'pipeline\', sub_agents=agents)</code></pre>' +
        '<p>Run and verify that all three agents acquire and release slots sequentially. Check: does each agent appear in the scheduler\'s agent list?</p>'
    },
    {
      id: 'scheduled-vs-unscheduled',
      title: 'Scheduled vs Unscheduled ParallelAgent',
      content:
        '<h3>The Definitive Before/After Comparison</h3>' +
        '<p>This is the experiment that makes the scheduling gap concrete. Run the <strong>same</strong> ParallelAgent workload twice: once without LOCO (all agents fire simultaneously, risk of rate limits) and once with LOCO (capacity-controlled, reliable execution). The difference is stark.</p>' +

        '<h3>Without LOCO: Unscheduled Execution</h3>' +
        '<p>Ten parallel agents, ten simultaneous LLM calls. The timestamps show all 10 calls firing within milliseconds of each other. If your RPM quota is lower than 10, some agents fail with 429 errors. The success rate depends entirely on how generous your API quota is -- not on anything in your code.</p>' +
        '<pre><code># All 10 fire at once -- no scheduling\n[1717500000.100] worker_00 - LLM call starting\n[1717500000.102] worker_01 - LLM call starting\n[1717500000.103] worker_02 - LLM call starting\n[1717500000.105] worker_03 - LLM call starting\n...\n[1717500000.115] worker_09 - LLM call starting\n# Possible 429 errors for some agents</code></pre>' +

        '<h3>With LOCO: Scheduled Execution</h3>' +
        '<p>The LOCO adapter sits in <code>before_model_callback</code>. When 10 parallel agents try to call the LLM simultaneously, the scheduler admits only <code>capacity</code> agents at a time. The rest wait in the queue. When a slot is released (<code>after_model</code>), the scheduler picks the next agent based on the load function -- considering queue depth, wait time, and task weight.</p>' +
        '<pre><code># With LOCO (capacity=3): controlled flow\n[1717500000.100] worker_00 - acquired slot (1/3)\n[1717500000.102] worker_01 - acquired slot (2/3)\n[1717500000.103] worker_02 - acquired slot (3/3)\n[1717500000.105] worker_03 - waiting in queue...\n...\n[1717500001.200] worker_00 - released slot\n[1717500001.201] worker_03 - acquired slot (dequeued)\n# Zero 429 errors, all agents eventually complete</code></pre>' +

        '<h3>Expected Results</h3>' +
        '<table>' +
        '<tr><th>Metric</th><th>Without LOCO</th><th>With LOCO (capacity=3)</th></tr>' +
        '<tr><td>Concurrent calls</td><td>10 (all at once)</td><td>3 (max at any time)</td></tr>' +
        '<tr><td>Rate limit errors</td><td>Likely (quota-dependent)</td><td>Zero</td></tr>' +
        '<tr><td>Success rate</td><td>Partial (some agents fail)</td><td>100%</td></tr>' +
        '<tr><td>Total wall-clock time</td><td>~2s (fast but unreliable)</td><td>~7s (slower but reliable)</td></tr>' +
        '<tr><td>Execution order</td><td>Non-deterministic</td><td>Load-function determined</td></tr>' +
        '</table>' +
        '<p>The tradeoff is explicit: LOCO adds latency (agents wait in the queue) in exchange for reliability (no rate limit errors, 100% success rate). The total wall-clock time is higher because only 3 agents run at a time instead of 10, but every single agent completes successfully.</p>' +

        '<h3>How LOCO Decides Order</h3>' +
        '<p>When a slot opens, the scheduler does not pick the next agent randomly or FIFO. The load function considers:</p>' +
        '<ul>' +
        '<li><strong>Queue depth</strong> -- How many agents are waiting? Higher queue pressure may change priority.</li>' +
        '<li><strong>Wait time</strong> -- How long has each agent been waiting? Longer-waiting agents may get priority to prevent starvation.</li>' +
        '<li><strong>Task weight</strong> -- A gemini-2.5-pro task (weight 3.0) may be deferred in favor of three flash tasks (weight 1.0 each) if capacity is constrained.</li>' +
        '</ul>' +
        '<p>This is the scheduling intelligence that ADK lacks entirely: the ability to make informed decisions about which agent should run next based on system state.</p>',

      summary: 'Without LOCO: 10 simultaneous calls, potential 429 errors, partial failures. With LOCO (capacity=3): max 3 concurrent calls, zero rate limit errors, 100% success rate, slightly higher wall-clock time. The load function decides execution order based on queue depth, wait time, and task weight.',

      mentalModel: 'Unscheduled ParallelAgent is like 10 people rushing through a single door at the same time. Scheduled ParallelAgent is like a queue with a doorman (LOCO) who lets 3 through at a time and decides who goes next based on who has been waiting longest.',

      mistakes: [
        'Setting capacity too high -- if capacity equals or exceeds the number of agents, LOCO has no effect. Set it below your API\'s RPM limit to see the scheduling in action.',
        'Not logging enough detail to compare runs -- you need timestamps, agent IDs, and error counts for both the scheduled and unscheduled runs. Without this data, the comparison is anecdotal.',
        'Testing with too few agents -- the difference between scheduled and unscheduled is not visible with 2-3 agents. Use 10+ to see the contrast clearly.',
        'Forgetting that LOCO adds latency by design -- the tradeoff is reliability vs. speed. If every agent completes but takes longer, that is the scheduler working correctly.'
      ],

      exercise:
        '<p><strong>Step 1: Build the 10-agent ParallelAgent (unscheduled)</strong></p>' +
        '<p>Create <code>adk_loco/unscheduled/__init__.py</code>:</p>' +
        '<pre><code>import time\nfrom google.adk.agents import Agent, ParallelAgent\n\nresults = {}\n\ndef log_timing(callback_context, llm_request):\n    name = callback_context.agent_name\n    ts = time.time()\n    results[name] = {\'start\': ts}\n    print(f"[{ts:.3f}] {name} - LLM call starting")\n    return None\n\ndef make_agent(i):\n    return Agent(\n        name=f\'worker_{i:02d}\',\n        model=\'gemini-2.5-flash\',\n        instruction=f\'Reply with exactly: "Worker {i} done."\',\n        output_key=f\'result_{i:02d}\',\n        before_model_callback=log_timing\n    )\n\nagents = [make_agent(i) for i in range(10)]\n\nroot_agent = ParallelAgent(\n    name=\'unscheduled\',\n    sub_agents=agents\n)</code></pre>' +

        '<p><strong>Step 2: Run and record baseline</strong></p>' +
        '<pre><code>cd adk_loco\nadk run unscheduled</code></pre>' +
        '<p>Send "Go" and record: timestamps, errors, success count. This is your unscheduled baseline.</p>' +

        '<p><strong>Step 3: Build the scheduled version</strong></p>' +
        '<p>Create <code>adk_loco/scheduled/__init__.py</code>:</p>' +
        '<pre><code>import time\nfrom google.adk.agents import Agent, ParallelAgent\nfrom loco.adapters.google_adk import ADKAdapter\nfrom loco.scheduler import Scheduler\nfrom loco.resources import SharedResource\n\nscheduler = Scheduler(\n    resource=SharedResource(capacity=3)\n)\nadapter = ADKAdapter(scheduler=scheduler)\n\ndef log_timing(callback_context, llm_request):\n    name = callback_context.agent_name\n    ts = time.time()\n    print(f"[{ts:.3f}] {name} - LLM call starting")\n    return None\n\ndef make_agent(i):\n    return Agent(\n        name=f\'worker_{i:02d}\',\n        model=\'gemini-2.5-flash\',\n        instruction=f\'Reply with exactly: "Worker {i} done."\',\n        output_key=f\'result_{i:02d}\',\n        before_model_callback=adapter.before_model,\n        after_model_callback=adapter.after_model\n    )\n\nagents = [make_agent(i) for i in range(10)]\n\nroot_agent = ParallelAgent(\n    name=\'scheduled\',\n    sub_agents=agents\n)</code></pre>' +

        '<p><strong>Step 4: Run and compare</strong></p>' +
        '<pre><code>cd adk_loco\nadk run scheduled</code></pre>' +
        '<p>Send "Go" and record the same metrics. Compare with the unscheduled run:</p>' +
        '<pre><code>Metric              | Unscheduled  | Scheduled (cap=3)\n--------------------|-------------|-------------------\nConcurrent calls    | 10          | 3 (max)\nRate limit errors   | ???         | 0\nSuccess rate        | ???         | 100%\nTotal wall-clock    | ???         | ???\nExecution order     | All at once | Load-function order</code></pre>' +

        '<p><strong>Step 5: Observe execution order</strong></p>' +
        '<p>In the scheduled run, which agents went first? Check the timestamps. The first 3 agents (by timestamp) acquired slots immediately. The remaining 7 were dequeued as slots opened. Note the order -- it may not be sequential (worker_00, 01, 02) because the load function considers multiple factors.</p>' +

        '<p><strong>Step 6: Verify zero rate limit errors</strong></p>' +
        '<p>In the scheduled run, confirm that no 429 errors occurred. Every agent should have completed successfully. If you see errors, your capacity may still be too high for your project\'s quota -- lower it and re-test.</p>',

      postEvidence: 'Without LOCO: 10 simultaneous calls, rate limit errors, partial failures. With LOCO (capacity=3): zero errors, 100% success, deterministic execution order based on load function. The scheduler turns an unreliable burst into a reliable stream.'
    },
    {
      id: 'two-layer-scheduling',
      title: 'Two-Layer Scheduling Architecture',
      content:
        '<h3>Two Scheduling Gates, Not One</h3>' +
        '<p>ADK has <strong>two</strong> scheduling gates, not one. The existing ADK adapter uses <code>before_model_callback</code> for per-LLM-call scheduling. But <code>before_agent_callback</code> is a separate, more powerful gate -- it can block the entire agent at <strong>zero token cost</strong> before any LLM call happens.</p>' +

        '<h3>Layer 1: Admission Control (before_agent_callback)</h3>' +
        '<p>The question: <strong>"Should this agent run at all right now?"</strong></p>' +
        '<p>This is the macro scheduler. It fires before the agent makes any LLM call. If the system is overloaded, you can return a <code>Content</code> object with a "system busy, try again later" message. The agent never calls the LLM -- zero tokens consumed, zero cost incurred. The agent produces its response from the callback, not from the model.</p>' +
        '<pre><code>from google.genai.types import Content, Part\n\ndef admission_control(callback_context):\n    """Layer 1: Block agents when system is overloaded."""\n    current_load = get_system_load()  # your load metric\n    if current_load &gt; MAX_LOAD:\n        # Reject at zero cost -- no LLM call\n        return Content(\n            role=\'model\',\n            parts=[Part(text=(\n                \'System is currently at capacity. \'\n                \'Your request has been noted and will be \'\n                \'processed when resources are available.\'\n            ))]\n        )\n    return None  # Proceed -- agent is admitted</code></pre>' +

        '<h3>Layer 2: Per-Call Scheduling (before_model_callback)</h3>' +
        '<p>The question: <strong>"Should this specific LLM call proceed?"</strong></p>' +
        '<p>This is the micro scheduler -- the existing LOCO ADK adapter. The agent has been admitted (Layer 1 allowed it), but each individual LLM call within the agent still goes through the scheduler. An agent that makes 5 tool calls acquires and releases 5 slots. This is fine-grained, per-call resource management.</p>' +

        '<h3>The Two-Layer Architecture</h3>' +
        '<table>' +
        '<tr><th>Layer</th><th>Callback</th><th>Question</th><th>Cost on Reject</th><th>Granularity</th></tr>' +
        '<tr><td>Layer 1</td><td>before_agent_callback</td><td>Should this agent run?</td><td>Zero tokens</td><td>Per-agent</td></tr>' +
        '<tr><td>Layer 2</td><td>before_model_callback</td><td>Should this LLM call proceed?</td><td>Zero tokens (blocks)</td><td>Per-LLM-call</td></tr>' +
        '</table>' +

        '<h3>Why Both Layers Are Needed</h3>' +
        '<p><strong>Layer 2 without Layer 1:</strong> You admit every agent, then queue their LLM calls. Problem: admitted agents consume memory, hold state, and sit in the queue. If 100 agents are admitted but only 3 can call the LLM at a time, you have 97 agents waiting in memory doing nothing. Layer 1 would have rejected 95 of them at zero cost.</p>' +
        '<p><strong>Layer 1 without Layer 2:</strong> You admit a controlled number of agents, but each admitted agent fires LLM calls without coordination. Three admitted agents each making 5 calls = 15 uncoordinated LLM calls. Layer 2 would sequence those calls to stay within rate limits.</p>' +
        '<p><strong>Both layers together:</strong> Layer 1 controls how many agents are active (macro). Layer 2 controls how many LLM calls proceed concurrently (micro). The system stays within both agent-level and call-level capacity limits.</p>' +

        '<h3>The Architecture Insight</h3>' +
        '<p>This two-layer pattern is the core architecture insight: ADK provides two natural scheduling slots, and <strong>nobody uses either</strong>. The callbacks exist. The mechanism for blocking agents (return Content) and blocking LLM calls (return from before_model) are built into ADK. But no scheduling logic is connected to these gates. They are empty slots waiting for a scheduler.</p>' +
        '<p>The current LOCO adapter implements Layer 2 only. A production-grade implementation would use both: Layer 1 for coarse admission control (reject overloaded agents entirely at zero cost), Layer 2 for fine-grained per-call scheduling (queue and prioritize individual LLM calls within admitted agents).</p>',

      summary: 'ADK has two scheduling gates: before_agent_callback (Layer 1, admission control, zero token cost on reject) and before_model_callback (Layer 2, per-call scheduling). The current LOCO adapter implements Layer 2 only. A production system needs both. Layer 1 prevents agent admission when overloaded. Layer 2 controls concurrent LLM calls. Neither is used by default -- two scheduling slots, both empty.',

      mentalModel: 'Two-layer scheduling is like a hospital with an ER waiting room (Layer 1) and operating rooms (Layer 2). The waiting room nurse decides who is sick enough to be admitted. The OR scheduler decides which admitted patient gets the next operating room. Patients turned away from the waiting room cost zero hospital resources.',

      mistakes: [
        'Only implementing Layer 2 without Layer 1 -- you still admit agents that will wait in queue, consuming memory and state. Rejected agents at Layer 1 cost nothing.',
        'Only implementing Layer 1 without Layer 2 -- admitted agents still fire LLM calls without coordination, risking rate limit errors within the admitted group.',
        'Not tuning the two layers together -- Layer 1 admission rate should be higher than Layer 2 capacity to keep the pipeline fed. If both are set to 3, agents queue at Layer 1 unnecessarily.',
        'Returning empty Content from Layer 1 -- may cause downstream errors in agents that expect a meaningful response. Always return a clear, informative message explaining why the agent was blocked.'
      ],

      exercise:
        '<p><strong>Step 1: Build the Layer 1 admission controller</strong></p>' +
        '<p>Create <code>adk_loco/two_layer/__init__.py</code>:</p>' +
        '<pre><code>import time\nimport threading\nfrom google.adk.agents import Agent, ParallelAgent\nfrom google.genai.types import Content, Part\nfrom loco.adapters.google_adk import ADKAdapter\nfrom loco.scheduler import Scheduler\nfrom loco.resources import SharedResource\n\n# --- Layer 2: LOCO scheduler (per-LLM-call) ---\nscheduler = Scheduler(\n    resource=SharedResource(capacity=3)  # Max 3 concurrent LLM calls\n)\nadapter = ADKAdapter(scheduler=scheduler)\n\n# --- Layer 1: Admission control (per-agent) ---\nadmission_semaphore = threading.Semaphore(5)  # Max 5 agents active\nadmission_stats = {\'admitted\': 0, \'rejected\': 0}\n\n\ndef admission_control(callback_context):\n    """Layer 1: Block agents when too many are active."""\n    agent_name = callback_context.agent_name\n    acquired = admission_semaphore.acquire(blocking=False)\n    if not acquired:\n        admission_stats[\'rejected\'] += 1\n        print(f"[Layer 1] REJECTED {agent_name} -- system at capacity")\n        return Content(\n            role=\'model\',\n            parts=[Part(text=(\n                f\'System busy: {agent_name} was not admitted. \'\n                \'Too many agents are currently active. \'\n                \'This response cost zero tokens.\'\n            ))]\n        )\n    admission_stats[\'admitted\'] += 1\n    print(f"[Layer 1] ADMITTED {agent_name}")\n    return None  # Proceed to agent execution\n\n\ndef release_admission(callback_context):\n    """Release the admission slot when agent finishes."""\n    agent_name = callback_context.agent_name\n    admission_semaphore.release()\n    print(f"[Layer 1] RELEASED {agent_name}")\n    return None\n\n\ndef make_agent(i):\n    return Agent(\n        name=f\'worker_{i:02d}\',\n        model=\'gemini-2.5-flash\',\n        instruction=f\'You are worker {i}. Reply with: "Worker {i} completed."\',\n        output_key=f\'result_{i:02d}\',\n        before_agent_callback=admission_control,     # Layer 1\n        after_agent_callback=release_admission,       # Layer 1 release\n        before_model_callback=adapter.before_model,   # Layer 2\n        after_model_callback=adapter.after_model       # Layer 2 release\n    )\n\nagents = [make_agent(i) for i in range(10)]\n\nroot_agent = ParallelAgent(\n    name=\'two_layer\',\n    sub_agents=agents\n)</code></pre>' +

        '<p><strong>Step 2: Run and observe both layers</strong></p>' +
        '<pre><code>cd adk_loco\nadk run two_layer</code></pre>' +
        '<p>Send "Go" and watch the terminal output. You should see:</p>' +
        '<ul>' +
        '<li>Layer 1: 5 agents admitted, 5 rejected (with "System busy" responses)</li>' +
        '<li>Layer 2: Of the 5 admitted agents, max 3 call the LLM at any given time</li>' +
        '<li>The 5 rejected agents produce their response at zero token cost</li>' +
        '</ul>' +

        '<p><strong>Step 3: Verify the cost savings</strong></p>' +
        '<p>Check the Trace tab in the web UI. The 5 rejected agents should have <strong>no LLM spans</strong> -- they never called the model. The 5 admitted agents should have normal LLM spans. Count total LLM calls: should be 5, not 10.</p>' +

        '<p><strong>Step 4: Adjust the layers</strong></p>' +
        '<p>Experiment with different settings:</p>' +
        '<pre><code># Conservative: admit few, schedule tightly\nLayer 1: admit max 3 agents\nLayer 2: capacity 2 LLM calls\n\n# Generous: admit more, schedule loosely\nLayer 1: admit max 8 agents\nLayer 2: capacity 5 LLM calls\n\n# Unbalanced: admit all, schedule tightly (Layer 2 only)\nLayer 1: admit max 10 agents (effectively disabled)\nLayer 2: capacity 3 LLM calls</code></pre>' +
        '<p>For each configuration, record: number of LLM calls, rate limit errors, wall-clock time, token cost.</p>' +

        '<p><strong>Step 5: Document the architecture</strong></p>' +
        '<p>Create a comparison table:</p>' +
        '<pre><code>Configuration         | LLM Calls | Errors | Wall Time | Cost\n----------------------|-----------|--------|-----------|------\nNo scheduling         | 10        | ???    | ~2s       | 10x\nLayer 2 only (cap=3)  | 10        | 0      | ~7s       | 10x\nBoth layers (5/3)     | 5         | 0      | ~4s       | 5x\nBoth layers (3/2)     | 3         | 0      | ~3s       | 3x</code></pre>' +
        '<p>The key insight: Layer 1 reduces <em>total cost</em> by rejecting agents before they consume tokens. Layer 2 reduces <em>errors</em> by controlling concurrency. Together, they reduce both.</p>',

      postEvidence: 'ADK has two scheduling gates: before_agent_callback (admission control, zero token cost) and before_model_callback (per-call scheduling). The existing LOCO adapter uses Layer 2 only. A production system needs both. Nobody uses either. This is the architecture insight: two scheduling slots, both empty.'
    }
  ]
});
