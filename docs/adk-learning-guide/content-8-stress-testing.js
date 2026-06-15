window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'stress-testing',
  title: '8. Production Stress Testing',
  topics: [
    {
      id: 'max-llm-calls',
      title: 'max_llm_calls Limit',
      content:
        '<h3>ADK\'s Only Resource Knob</h3>' +
        '<p><code>max_llm_calls</code> is ADK\'s only mechanism for limiting resource consumption. It caps the total number of LLM calls per invocation. The default value is <strong>500</strong>. When the counter reaches the limit, the invocation stops -- no more LLM calls are made, regardless of which agent requested them.</p>' +

        '<h3>Shared, Not Per-Agent</h3>' +
        '<p>The critical design detail: <code>max_llm_calls</code> is shared across <strong>ALL agents</strong> in the invocation, not per-agent. A SequentialAgent with 5 sub-agents shares the same 500-call budget. A ParallelAgent with 10 sub-agents shares the same 500-call budget. There is no per-agent quota, no per-model quota, no cost-based limit.</p>' +
        '<pre><code># This entire pipeline shares ONE 500-call budget\nroot = SequentialAgent(\n    name=\'pipeline\',\n    sub_agents=[agent_a, agent_b, agent_c, agent_d, agent_e]\n)\n\n# agent_a uses 200 calls in a loop?\n# The remaining 4 agents share the last 300.</code></pre>' +

        '<h3>The Runaway Agent Problem</h3>' +
        '<p>Because the budget is shared, one runaway agent can consume the entire allocation. A LoopAgent that takes many iterations, an agent with verbose tool use, or an agent stuck in a retry loop -- any of these can drain the shared budget, starving all other agents in the invocation. There is no fairness mechanism, no per-agent reservation, no priority system.</p>' +

        '<h3>GitHub Issue #1167</h3>' +
        '<p>This gap was identified early. GitHub Issue #1167 requested per-agent <code>RunConfig</code> -- the ability to set separate <code>max_llm_calls</code> limits for individual agents within an invocation. The issue was filed in 2025, received community support, and was closed as stale without implementation. The feature does not exist.</p>' +

        '<h3>What max_llm_calls Is Not</h3>' +
        '<p>It is not a cost limit. A Gemini Pro call and a Gemini Flash call both count as 1. A call that sends 100 tokens and a call that sends 100,000 tokens both count as 1. A call that costs $0.001 and a call that costs $0.50 both count as 1. The counter measures <em>volume</em>, not <em>value</em> or <em>cost</em>.</p>' +
        '<p>It is not a scheduler. It does not decide which agent gets the next call, or which call is more important, or whether the system can afford another call. It is a <strong>circuit breaker</strong> -- a hard stop that triggers when a number is reached. Circuit breakers are useful safety nets, but they are not schedulers.</p>',

      summary: 'max_llm_calls is ADK\'s only resource knob: a shared counter (default 500) across all agents in an invocation. One runaway agent can consume the entire budget. It counts calls regardless of model, token count, or cost. GitHub Issue #1167 for per-agent config was closed stale. It is a circuit breaker, not a scheduler.',

      mentalModel: 'max_llm_calls is like a shared prepaid phone card for a family -- all family members (agents) draw from the same balance. One teenager making long calls can drain it for everyone. There is no per-person limit.',

      mistakes: [
        'Assuming max_llm_calls is per-agent -- it is per-invocation, shared across all agents. One agent can consume the entire budget.',
        'Not monitoring call count during development -- you will hit 500 and wonder why the agent stopped mid-task. The error message may not clearly indicate that the limit was reached.',
        'Confusing max_llm_calls with a cost limit -- it counts calls regardless of model or token count. One Gemini Pro call counts the same as one Flash call, even though Pro is 10x more expensive.',
        'Not setting a lower limit for development -- 500 calls at even $0.01/call = $5 per test run. Set max_llm_calls=20 during development to catch runaway loops early and cheaply.'
      ],

      exercise:
        '<p><strong>Step 1: Create a runaway LoopAgent</strong></p>' +
        '<p>Create <code>adk_stress/runaway_loop/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent, LoopAgent\n\nverbose_agent = Agent(\n    name=\'verbose_agent\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'You are a brainstorming agent. Each time you are called, \'\n        \'generate 10 new ideas for AI applications. Never repeat ideas. \'\n        \'Never say you are done -- always indicate there are more ideas to explore.\'\n    )\n)\n\nroot_agent = LoopAgent(\n    name=\'runaway_loop\',\n    sub_agents=[verbose_agent],\n    max_iterations=1000  # Way higher than max_llm_calls\n)</code></pre>' +

        '<p><strong>Step 2: Run and observe the limit</strong></p>' +
        '<pre><code>cd adk_stress\nadk run runaway_loop</code></pre>' +
        '<p>Send "Start brainstorming." Watch the output. The agent will keep generating ideas until max_llm_calls (500) is reached. Note: does it stop cleanly? What error message do you see?</p>' +

        '<p><strong>Step 3: Find the configuration point</strong></p>' +
        '<p>The max_llm_calls value is set in <code>RunConfig</code>. Modify the invocation:</p>' +
        '<pre><code>from google.adk.runners import Runner\nfrom google.adk.sessions import InMemorySessionService\n\nrunner = Runner(\n    agent=root_agent,\n    app_name=\'runaway_test\',\n    session_service=InMemorySessionService()\n)\n\n# Create session and run with a lower limit\nfrom google.adk.agents.run_config import RunConfig\nconfig = RunConfig(max_llm_calls=20)\n\n# Use config when calling runner.run_async()</code></pre>' +
        '<p>Re-run with max_llm_calls=20. Does it stop at 20 calls? (Yes.)</p>' +

        '<p><strong>Step 4: Test the shared budget</strong></p>' +
        '<p>Create <code>adk_stress/shared_budget/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent, SequentialAgent, LoopAgent\n\nloop_agent = LoopAgent(\n    name=\'greedy_loop\',\n    sub_agents=[Agent(\n        name=\'idea_gen\',\n        model=\'gemini-2.5-flash\',\n        instruction=\'Generate 5 random words. Never say you are done.\'\n    )],\n    max_iterations=100\n)\n\nfinal_agent = Agent(\n    name=\'summarizer\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Summarize everything that happened.\',\n    output_key=\'summary\'\n)\n\nroot_agent = SequentialAgent(\n    name=\'shared_budget\',\n    sub_agents=[loop_agent, final_agent]\n)</code></pre>' +
        '<p>Run this pipeline. The loop_agent will consume most of the 500 calls. Does the summarizer ever run? If the loop consumes all 500, the summarizer is starved.</p>' +

        '<p><strong>Step 5: Calculate the budget math</strong></p>' +
        '<p>If each agent in a 5-agent SequentialAgent averages 3 LLM calls per task, each invocation uses ~15 calls. At max_llm_calls=500, you can handle ~33 tasks before hitting the limit. But if one agent averages 10 calls (e.g., it uses tools), the math changes: 4*3 + 1*10 = 22 calls per task, ~22 tasks before hitting the limit.</p>',

      postEvidence: 'max_llm_calls is ADK\'s only resource knob: a shared counter across all agents with no per-agent allocation. One runaway agent consumes the budget for all. GitHub Issue #1167 for per-agent config was closed stale. This is not a scheduler -- it is a circuit breaker with no nuance.'
    },
    {
      id: 'context-saturation',
      title: 'Context Window Saturation',
      content:
        '<h3>The Growing Context Problem</h3>' +
        '<p>As an agent processes more turns, the conversation context grows. Each turn adds user message + assistant response + tool calls/results. ADK sends the <strong>full conversation history</strong> with every LLM call by default (the <code>include_contents=\'default\'</code> behavior). This means:</p>' +
        '<ul>' +
        '<li>Turn 1: system prompt + 1 message</li>' +
        '<li>Turn 5: system prompt + 5 messages + 5 responses</li>' +
        '<li>Turn 20: system prompt + 20 messages + 20 responses + all tool calls</li>' +
        '<li>Turn 50: system prompt + potentially 100,000+ tokens of history</li>' +
        '</ul>' +
        '<p>The growth is linear and unbounded. There is no built-in mechanism to cap it.</p>' +

        '<h3>No Built-In Management</h3>' +
        '<p>ADK has <strong>no built-in context window management</strong> in the open-source version. There is no automatic summarization, no sliding window, no token budget, no warning when the context approaches the model\'s limit. Google\'s Managed Agents (the hosted Vertex AI version) do have auto-compaction at approximately 135k tokens, but this feature is not available in the open-source ADK.</p>' +

        '<h3>What Happens at the Limit?</h3>' +
        '<p>When the conversation context exceeds the model\'s context window, the behavior is model-dependent and unpredictable:</p>' +
        '<ul>' +
        '<li><strong>Gemini may truncate</strong> -- silently dropping older messages from the context. You will not receive a warning; the agent will simply "forget" earlier parts of the conversation.</li>' +
        '<li><strong>Gemini may error</strong> -- returning a 400 error for exceeding the context limit. This crashes the agent.</li>' +
        '<li><strong>Output quality degrades</strong> -- before hitting the hard limit, models typically lose accuracy on information buried in the middle of very long contexts (the "lost in the middle" problem).</li>' +
        '</ul>' +

        '<h3>Cost Implications</h3>' +
        '<p>Context saturation is not just a correctness problem -- it is a cost problem. Input tokens are billed on every call. A 100k-token context costs approximately $0.25 per call on Gemini Pro. If the agent makes 20 calls in a session, that is $5.00 in input tokens alone -- just for re-sending the same conversation history 20 times.</p>' +

        '<h3>The include_contents Escape Hatch</h3>' +
        '<p>ADK provides one mechanism to control this: <code>include_contents=\'none\'</code> on the Agent constructor. This tells ADK to send only the system prompt and the current turn -- no conversation history. This is ideal for stateless agents that do not need context from previous turns (e.g., a classifier, a formatter, a single-shot evaluator). But for conversational agents that need context, there is no middle ground between "send everything" and "send nothing."</p>',

      summary: 'ADK sends full conversation history with every LLM call by default. Context grows linearly and unboundedly. No auto-summarization, no sliding window, no warnings in open-source ADK (Managed Agents have auto-compaction at ~135k tokens). At 100k tokens, each call costs ~$0.25 on Gemini Pro. The only escape is include_contents=\'none\' which sends no history at all.',

      mentalModel: 'Context window saturation is like filling a suitcase -- you keep adding clothes until the zipper breaks. There is no warning light, no "bag is 80% full" indicator. It just fails when it fails.',

      mistakes: [
        'Assuming ADK manages context automatically -- it does not in open-source. Only Managed Agents (Vertex AI hosted) have auto-compaction. The open-source version sends everything.',
        'Running agents in loops without monitoring context growth -- each loop iteration adds to the context. A 50-iteration loop with 500-token responses adds 25,000 tokens to the context.',
        'Not using include_contents=\'none\' for stateless agents that do not need conversation history -- a classifier agent does not need 50 turns of history, but ADK sends it by default.',
        'Ignoring the cost implications -- a 100k-token context costs ~$0.25 per call on Gemini Pro, and it is sent with EVERY call. Twenty calls in a session = $5.00 in input tokens alone.'
      ],

      exercise:
        '<p><strong>Step 1: Create a verbose loop agent</strong></p>' +
        '<p>Create <code>adk_stress/context_growth/__init__.py</code>:</p>' +
        '<pre><code>import json\nfrom google.adk.agents import Agent, LoopAgent\n\n\ndef log_context_size(callback_context, llm_request):\n    """Log the size of the context being sent to the LLM."""\n    total_parts = 0\n    total_chars = 0\n    if llm_request.contents:\n        for content in llm_request.contents:\n            if content.parts:\n                for part in content.parts:\n                    total_parts += 1\n                    if hasattr(part, \'text\') and part.text:\n                        total_chars += len(part.text)\n    iteration = callback_context.state.get(\'temp:iteration\', 0) + 1\n    callback_context.state[\'temp:iteration\'] = iteration\n    print(f"[Iteration {iteration}] Context: {total_parts} parts, {total_chars} chars")\n    return None\n\n\nverbose_agent = Agent(\n    name=\'verbose_agent\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'You are a storytelling agent. Each time you are called, \'\n        \'continue the story with a detailed 200-word paragraph. \'\n        \'Never summarize previous paragraphs -- always add new content. \'\n        \'Never say you are done.\'\n    ),\n    before_model_callback=log_context_size\n)\n\nroot_agent = LoopAgent(\n    name=\'context_growth\',\n    sub_agents=[verbose_agent],\n    max_iterations=50\n)</code></pre>' +

        '<p><strong>Step 2: Run and monitor growth</strong></p>' +
        '<pre><code>cd adk_stress\nadk run context_growth</code></pre>' +
        '<p>Send "Tell me a story about a robot learning to paint." Watch the terminal output. The context size (in chars) should grow with each iteration as the full conversation history is resent.</p>' +

        '<p><strong>Step 3: Plot the growth curve</strong></p>' +
        '<p>Record the "total_chars" value for each iteration. Create a simple plot or table:</p>' +
        '<pre><code>Iteration | Context Chars | Growth Rate\n    1     |     500      |    --\n    5     |    3,500     |   ~700/iter\n   10     |    8,000     |   ~900/iter\n   20     |   20,000     |  ~1200/iter\n   30     |   38,000     |  ~1800/iter\n   50     |   80,000+    |  increasing</code></pre>' +
        '<p>The growth rate itself increases because each response is a little longer (the model generates more as it has more context to riff on).</p>' +

        '<p><strong>Step 4: Observe degradation</strong></p>' +
        '<p>At what iteration does the story start losing coherence? Does the agent contradict earlier paragraphs? Does it repeat itself? Document the iteration number where quality visibly drops.</p>' +

        '<p><strong>Step 5: Test the escape hatch</strong></p>' +
        '<p>Modify the agent to use <code>include_contents=\'none\'</code>:</p>' +
        '<pre><code>verbose_agent = Agent(\n    name=\'verbose_agent\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Generate a 200-word paragraph about robots.\',\n    include_contents=\'none\',\n    before_model_callback=log_context_size\n)</code></pre>' +
        '<p>Run again. The context size should be constant across all iterations -- the history is not sent. But now the agent has no memory of previous paragraphs. This is the tradeoff: memory vs. cost.</p>',

      postEvidence: 'ADK has no context window management in open-source. Conversation history grows without bound until the model\'s limit is hit. No warning, no automatic summarization, no circuit breaker. At 100k tokens, each LLM call costs ~$0.25 on Gemini Pro -- and the agent makes dozens of calls.'
    },
    {
      id: 'state-race-conditions',
      title: 'Shared State Race Conditions',
      content:
        '<h3>The Parallel Write Problem</h3>' +
        '<p>When ParallelAgent runs sub-agents concurrently, each sub-agent can write to session state via <code>output_key</code> or <code>state_delta</code>. If multiple sub-agents write to the <strong>same state key</strong>, the result is a race condition: the last agent to complete wins, and which agent completes last is non-deterministic.</p>' +

        '<h3>Why It Happens</h3>' +
        '<p>ADK does not provide locks, transactions, or conflict resolution for state. State updates are simple dictionary writes. When two agents finish at roughly the same time and both write to <code>state["result"]</code>, the second write overwrites the first. There is no merge, no append, no conflict detection. The winner depends on which agent\'s HTTP response arrives last -- a timing-dependent, non-deterministic outcome.</p>' +
        '<pre><code># DANGEROUS: Both agents write to the same key\nagent_a = Agent(name=\'a\', model=\'gemini-2.5-flash\', instruction=\'...\', output_key=\'result\')\nagent_b = Agent(name=\'b\', model=\'gemini-2.5-flash\', instruction=\'...\', output_key=\'result\')\n\nparallel = ParallelAgent(\n    name=\'parallel\',\n    sub_agents=[agent_a, agent_b]  # Race condition on \'result\'\n)</code></pre>' +

        '<h3>The Workaround</h3>' +
        '<p>Use unique <code>output_key</code> values for each parallel branch. Aggregate in a downstream agent:</p>' +
        '<pre><code># SAFE: Each agent writes to its own key\nagent_a = Agent(name=\'a\', ..., output_key=\'result_a\')\nagent_b = Agent(name=\'b\', ..., output_key=\'result_b\')\n\naggregator = Agent(\n    name=\'aggregator\',\n    instruction=\'Read result_a and result_b from state and merge them.\',\n    output_key=\'final_result\'\n)</code></pre>' +

        '<h3>state_delta Has the Same Problem</h3>' +
        '<p>The race condition is not limited to <code>output_key</code>. If two parallel agents use tools that write to the same state key via <code>EventActions(state_delta={...})</code>, the same overwrite behavior occurs. The last <code>state_delta</code> to be processed wins.</p>' +

        '<h3>This Is a Scheduling Problem</h3>' +
        '<p>Race conditions on shared state are fundamentally a scheduling problem. A resource-aware scheduler would either: (a) sequence the writes to avoid conflict, (b) provide merge semantics (append rather than overwrite), or (c) detect the conflict and raise an error. ADK does none of these -- it treats state as a simple dictionary and lets concurrent writers overwrite each other silently.</p>',

      summary: 'Parallel agents writing to the same state key is a race condition -- last writer wins, non-deterministic. ADK provides no locks, transactions, or conflict detection. The workaround is unique output_key per branch plus a downstream aggregator. This applies to both output_key and state_delta writes.',

      mentalModel: 'Shared state in parallel agents is like two people editing the same Google Doc paragraph at the same time -- last keystroke wins, and neither writer knows the other exists.',

      mistakes: [
        'Using the same output_key for parallel agents -- the last agent to finish overwrites the others. Always use unique keys.',
        'Assuming state updates are atomic -- they are not. There is no transaction boundary. A state_delta with 3 keys can be partially overwritten by another agent\'s state_delta.',
        'Not testing with enough runs to surface the non-determinism -- it may work 9 times out of 10 and fail on the 10th. Run at least 10 times to observe variability.',
        'Relying on execution order being stable -- even the same agents may complete in different order on different runs. Network latency, model load, and response length all affect timing.'
      ],

      exercise:
        '<p><strong>Step 1: Create the race condition</strong></p>' +
        '<p>Create <code>adk_stress/race_condition/__init__.py</code>:</p>' +
        '<pre><code>from google.adk.agents import Agent, ParallelAgent, SequentialAgent\n\nagent_a = Agent(\n    name=\'agent_a\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Reply with exactly: "AGENT A WAS HERE"\',\n    output_key=\'shared_result\'\n)\n\nagent_b = Agent(\n    name=\'agent_b\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Reply with exactly: "AGENT B WAS HERE"\',\n    output_key=\'shared_result\'\n)\n\nreader = Agent(\n    name=\'reader\',\n    model=\'gemini-2.5-flash\',\n    instruction=(\n        \'Read state key "shared_result" and report exactly what it says. \'\n        \'Do not modify it. Just report the value.\'\n    ),\n    output_key=\'final_read\'\n)\n\nparallel = ParallelAgent(\n    name=\'parallel\',\n    sub_agents=[agent_a, agent_b]\n)\n\nroot_agent = SequentialAgent(\n    name=\'race_condition\',\n    sub_agents=[parallel, reader]\n)</code></pre>' +

        '<p><strong>Step 2: Run 10 times and record results</strong></p>' +
        '<pre><code>cd adk_stress\nadk run race_condition</code></pre>' +
        '<p>Send "Go" and note which agent\'s output appears in shared_result. Restart and repeat 10 times. Record:</p>' +
        '<pre><code>Run | shared_result contains\n 1  | AGENT A WAS HERE\n 2  | AGENT B WAS HERE\n 3  | AGENT B WAS HERE\n 4  | AGENT A WAS HERE\n ...  (continue for 10 runs)</code></pre>' +
        '<p>Is the result deterministic? (No -- it varies between runs.)</p>' +

        '<p><strong>Step 3: Add a third agent</strong></p>' +
        '<p>Add <code>agent_c</code> with <code>output_key=\'shared_result\'</code> and instruction to reply with "AGENT C WAS HERE". Add it to the ParallelAgent. Run 10 more times. Document which agent wins each run.</p>' +

        '<p><strong>Step 4: Test with artificial delays</strong></p>' +
        '<p>Add <code>before_model_callback</code> with different delays to each agent:</p>' +
        '<pre><code>import time\n\ndef delay_short(callback_context, llm_request):\n    time.sleep(0.5)\n    return None\n\ndef delay_long(callback_context, llm_request):\n    time.sleep(2.0)\n    return None\n\nagent_a = Agent(\n    name=\'agent_a\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Reply with exactly: "AGENT A WAS HERE"\',\n    output_key=\'shared_result\',\n    before_model_callback=delay_short  # Finishes first\n)\n\nagent_b = Agent(\n    name=\'agent_b\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Reply with exactly: "AGENT B WAS HERE"\',\n    output_key=\'shared_result\',\n    before_model_callback=delay_long  # Finishes last\n)</code></pre>' +
        '<p>Run this version. Does the slower agent (B) consistently win? (Yes -- last writer wins, and the delay makes B consistently last.)</p>' +

        '<p><strong>Step 5: Fix with unique keys</strong></p>' +
        '<p>Change agent_a to <code>output_key=\'result_a\'</code> and agent_b to <code>output_key=\'result_b\'</code>. Add an aggregator agent that reads both keys. Run and verify: both results are preserved, no data loss, deterministic output.</p>',

      postEvidence: 'Parallel state writes are a race condition. Two agents writing to the same key -- last writer wins, non-deterministic. No locks, no transactions, no conflict detection. This is a scheduling problem: a resource-aware scheduler would sequence writes or provide merge semantics.'
    },
    {
      id: 'rate-limit-behavior',
      title: 'Rate Limit Behavior',
      content:
        '<h3>The Concurrent Call Problem</h3>' +
        '<p>When multiple agents hit the Gemini API simultaneously -- via ParallelAgent, fan-out, or multiple concurrent invocations -- rate limits become a real production concern. Google enforces per-project quotas: <strong>requests per minute (RPM)</strong> and <strong>tokens per minute (TPM)</strong>, both of which vary by model.</p>' +

        '<h3>No Built-In Rate Limit Handling</h3>' +
        '<p>ADK has <strong>no built-in rate limit handling</strong>. There is no automatic retry on 429 errors, no exponential backoff, no request queuing, no rate-aware scheduling. When a 429 (Too Many Requests) error occurs, it propagates as an exception. The agent fails. Other agents in the parallel batch may or may not be affected depending on timing -- if they already submitted their requests before the 429, they may succeed; if they submit after, they may also fail.</p>' +

        '<h3>Quota Details</h3>' +
        '<p>Google\'s per-project quotas (approximate, subject to change):</p>' +
        '<table>' +
        '<tr><th>Model</th><th>RPM (Free Tier)</th><th>RPM (Pay-as-you-go)</th><th>TPM</th></tr>' +
        '<tr><td>Gemini 2.0 Flash</td><td>15</td><td>2,000</td><td>4M</td></tr>' +
        '<tr><td>Gemini 2.5 Flash</td><td>10</td><td>2,000</td><td>4M</td></tr>' +
        '<tr><td>Gemini 2.5 Pro</td><td>5</td><td>1,000</td><td>2M</td></tr>' +
        '</table>' +
        '<p>On the free tier, even 15 parallel agents using Gemini 2.0 Flash will exceed the RPM limit. On pay-as-you-go, 20 parallel agents using Gemini 2.5 Pro would push close to the 1,000 RPM limit depending on how fast they cycle.</p>' +

        '<h3>What a 429 Error Looks Like</h3>' +
        '<p>When you hit the rate limit, the Gemini API returns a 429 status code with a message like:</p>' +
        '<pre><code>google.api_core.exceptions.ResourceExhausted: 429\nQuota exceeded for quota metric \'GenerateContent request\'\nand limit \'GenerateContent requests per minute per project\'</code></pre>' +
        '<p>This exception is not caught by ADK. It propagates up through the agent, through the runner, and surfaces as an unhandled error. The agent stops. If this happens in a ParallelAgent, the specific sub-agent that triggered the 429 fails, but other sub-agents that already have in-flight requests may still complete.</p>' +

        '<h3>Why This Matters</h3>' +
        '<p>The framework that launches concurrent agents has no mechanism to prevent them from overwhelming the API they all share. ParallelAgent and fan-out are explicitly designed to run agents simultaneously -- but the API they call has a finite rate limit. These two design decisions are in direct conflict, and nothing in ADK reconciles them.</p>',

      summary: 'ADK has no rate limit handling -- no retry, no backoff, no queuing. A 429 error propagates as an unhandled exception and kills the agent. Google\'s per-project RPM quotas (as low as 5 RPM on free tier for Gemini Pro) are easily exceeded by parallel agents. The framework launches concurrent agents but has no mechanism to prevent them from overwhelming the shared API.',

      mentalModel: 'Rate limiting is like a highway on-ramp meter -- the highway (API) can only absorb so many cars per minute. Without a metering light (scheduler), all cars pile onto the ramp simultaneously and cause a jam (429 errors).',

      mistakes: [
        'Testing with too few agents to hit rate limits -- the bug only surfaces at scale. Three parallel agents may always succeed; twenty will not.',
        'Assuming ADK retries 429 errors automatically -- it does not. The exception propagates and the agent dies.',
        'Not checking your project\'s RPM/TPM quota before testing -- you need to know the limit to design a meaningful test. Free tier limits are extremely low (5-15 RPM).',
        'Ignoring that rate limits are per-project, not per-agent -- all agents in all invocations share the same quota. Two separate ParallelAgents running concurrently share the same RPM limit.'
      ],

      exercise:
        '<p><strong>Step 1: Create 20 parallel agents</strong></p>' +
        '<p>Create <code>adk_stress/rate_limit/__init__.py</code>:</p>' +
        '<pre><code>import time\nfrom google.adk.agents import Agent, ParallelAgent\n\n\ndef log_timing(callback_context, llm_request):\n    agent_name = callback_context.agent_name\n    ts = time.time()\n    print(f"[{ts:.3f}] {agent_name} - LLM call starting")\n    return None\n\n\ndef make_agent(i):\n    return Agent(\n        name=f\'worker_{i:02d}\',\n        model=\'gemini-2.5-flash\',\n        instruction=f\'You are worker {i}. Reply with exactly: "Worker {i} reporting."\',\n        output_key=f\'result_{i:02d}\',\n        before_model_callback=log_timing\n    )\n\nagents = [make_agent(i) for i in range(20)]\n\nroot_agent = ParallelAgent(\n    name=\'rate_limit_test\',\n    sub_agents=agents\n)</code></pre>' +

        '<p><strong>Step 2: Run and document results</strong></p>' +
        '<pre><code>cd adk_stress\nadk run rate_limit_test</code></pre>' +
        '<p>Send "Go" and observe the terminal output. Record for each agent:</p>' +
        '<ul>' +
        '<li>Did the LLM call start? (Check the log_timing output)</li>' +
        '<li>Did it succeed or fail?</li>' +
        '<li>If it failed, what error type? (Look for 429 / ResourceExhausted)</li>' +
        '</ul>' +

        '<p><strong>Step 3: Check the time distribution</strong></p>' +
        '<p>From the timestamps in the log output, answer:</p>' +
        '<ul>' +
        '<li>How many calls fired within the first second? (Likely all 20)</li>' +
        '<li>What is the time spread between the first and last call? (Likely under 100ms)</li>' +
        '<li>Is there any staggering? (No -- all fire at once)</li>' +
        '</ul>' +

        '<p><strong>Step 4: Find the threshold</strong></p>' +
        '<p>Reduce the number of agents: try 15, 10, 5, 3. For each count, run the test and record the success rate:</p>' +
        '<pre><code>Agent Count | Successes | Failures | Rate Limit Errors\n    20     |    ???    |   ???    |       ???\n    15     |    ???    |   ???    |       ???\n    10     |    ???    |   ???    |       ???\n     5     |    ???    |   ???    |       ???\n     3     |    ???    |   ???    |       ???</code></pre>' +
        '<p>At what agent count do rate limit errors disappear? This is your project\'s effective concurrency limit.</p>' +

        '<p><strong>Step 5: Verify no automatic retry</strong></p>' +
        '<p>Run the 20-agent test again. When an agent fails with a 429 error, does ADK retry the call? Does it wait and try again? (No -- the error propagates and the agent stops.) This confirms there is no built-in retry mechanism.</p>',

      postEvidence: '20 agents, 20 simultaneous API calls, zero retry on 429 errors. ADK surfaces the error and stops. This is the strongest evidence for the missing scheduler: the framework that launches concurrent agents has no mechanism to prevent them from overwhelming the API they all share.'
    }
  ]
});
