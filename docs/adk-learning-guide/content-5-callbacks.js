window.COURSE_SECTIONS = window.COURSE_SECTIONS || [];
window.COURSE_SECTIONS.push({
  id: 'callbacks',
  title: '5. Callbacks Deep Dive',
  topics: [
    {
      id: 'six-hooks',
      title: 'The Six Hooks',
      content:
        '<p>ADK provides <strong>six callback hooks</strong> that intercept agent execution at specific points. These are the integration surface for any external system -- logging, monitoring, scheduling, security -- that needs to observe or modify agent behavior. All six are registered at agent construction time as parameters to <code>LlmAgent()</code>.</p>' +

        '<h3>Complete Hook Reference</h3>' +
        '<table>' +
        '<tr><th>Hook</th><th>Input</th><th>Override Return</th><th>Token Cost if Overridden</th></tr>' +
        '<tr><td><code>before_agent_callback</code></td><td>CallbackContext</td><td>Optional[Content]</td><td><strong>Zero</strong> -- entire agent is skipped</td></tr>' +
        '<tr><td><code>after_agent_callback</code></td><td>CallbackContext, content</td><td>Optional[Content]</td><td>Normal -- agent already ran</td></tr>' +
        '<tr><td><code>before_model_callback</code></td><td>CallbackContext, LlmRequest</td><td>Optional[LlmResponse]</td><td><strong>Zero</strong> -- LLM call is skipped</td></tr>' +
        '<tr><td><code>after_model_callback</code></td><td>CallbackContext, LlmResponse</td><td>Optional[LlmResponse]</td><td>Normal -- LLM already called</td></tr>' +
        '<tr><td><code>before_tool_callback</code></td><td>CallbackContext, tool, args</td><td>Optional[dict]</td><td>Normal -- within an LLM turn</td></tr>' +
        '<tr><td><code>after_tool_callback</code></td><td>CallbackContext, tool, args, result</td><td>Optional[dict]</td><td>Normal -- tool already executed</td></tr>' +
        '</table>' +

        '<h3>The Universal Pattern</h3>' +
        '<p>All six hooks follow the same contract: <strong>return None to proceed normally, return a value to override/skip</strong>. This is elegant and consistent, but it creates a subtle trap: if your callback accidentally returns a non-None value (a forgotten return statement, a debugging print that returns something), the default behavior is silently overridden.</p>' +
        '<pre><code>from google.adk.agents import LlmAgent\n\nagent = LlmAgent(\n    name=\'my_agent\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'You are a helpful assistant.\',\n    before_agent_callback=my_before_agent,\n    after_agent_callback=my_after_agent,\n    before_model_callback=my_before_model,\n    after_model_callback=my_after_model,\n    before_tool_callback=my_before_tool,\n    after_tool_callback=my_after_tool\n)</code></pre>' +

        '<h3>CallbackContext</h3>' +
        '<p>Every callback receives a <code>CallbackContext</code> object that provides access to:</p>' +
        '<ul>' +
        '<li><code>agent_name</code> -- the name of the agent being executed</li>' +
        '<li><code>state</code> -- read/write access to session state (with all prefix scoping)</li>' +
        '<li><code>invocation_id</code> -- unique identifier for this invocation</li>' +
        '</ul>' +
        '<p>This context is the scheduler\'s viewport into the agent\'s execution. Every field is a potential signal for routing decisions.</p>' +

        '<h3>Firing Order</h3>' +
        '<p>For a <strong>simple text response</strong> (no tools):</p>' +
        '<ol>' +
        '<li><code>before_agent_callback</code> -- can bypass entire agent</li>' +
        '<li><code>before_model_callback</code> -- can bypass LLM call</li>' +
        '<li>LLM API call</li>' +
        '<li><code>after_model_callback</code> -- can replace response</li>' +
        '<li><code>after_agent_callback</code> -- can replace final output</li>' +
        '</ol>' +
        '<p>For a <strong>response with a tool call</strong>:</p>' +
        '<ol>' +
        '<li><code>before_agent_callback</code></li>' +
        '<li><code>before_model_callback</code> (1st LLM call)</li>' +
        '<li>LLM API call -- returns tool_call</li>' +
        '<li><code>after_model_callback</code> (1st response)</li>' +
        '<li><code>before_tool_callback</code> -- can bypass tool</li>' +
        '<li>Tool execution</li>' +
        '<li><code>after_tool_callback</code> -- can replace result</li>' +
        '<li><code>before_model_callback</code> (2nd LLM call with tool result)</li>' +
        '<li>LLM API call -- returns final text</li>' +
        '<li><code>after_model_callback</code> (2nd response)</li>' +
        '<li><code>after_agent_callback</code></li>' +
        '</ol>' +
        '<p>Notice: <code>before_model_callback</code> and <code>after_model_callback</code> fire <strong>twice</strong> in a tool-using flow. A scheduler hooked into before_model_callback will see two opportunities to intercept, not one.</p>',

      summary: 'ADK has six callback hooks: before/after for agent, model, and tool. All follow the same pattern -- return None to proceed, return a value to override. before_agent and before_model can skip their targets at zero token cost. In tool-using flows, model callbacks fire multiple times per user message.',

      mentalModel: 'Callbacks are like airport security checkpoints -- before_agent is the terminal entrance (can turn you away entirely), before_model is the gate (can cancel your flight), before_tool is the boarding door (can block a specific action). Each checkpoint can stop you or let you through, and you pass through them in a fixed order.',

      mistakes: [
        'Assuming callbacks are async -- they are sync in ADK by default. Long-running logic in a callback blocks the entire agent loop.',
        'Returning a non-None value accidentally -- this overrides the default behavior and may silently skip the LLM call or tool execution. Always explicitly return None to proceed.',
        'Not logging in callbacks during development -- without visibility into the hook firing sequence, debugging multi-agent flows is nearly impossible.',
        'Confusing before_agent_callback with before_model_callback -- before_agent fires once per agent invocation, before_model fires for every LLM call within that invocation (multiple times for tool-using agents).'
      ],

      exercise:
        '<p><strong>Goal:</strong> Wire all six callbacks with logging to map the exact firing order for both simple and tool-using flows.</p>' +

        '<p><strong>Step 1: Create the logging callbacks (callback_logger.py)</strong></p>' +
        '<pre><code>import time\n\ncall_log = []\n\ndef log_hook(hook_name):\n    \"\"\"Factory that creates a logging callback for any hook.\"\"\"\n    def callback(*args):\n        ctx = args[0]  # CallbackContext is always the first argument\n        entry = {\n            \'hook\': hook_name,\n            \'agent\': ctx.agent_name,\n            \'time\': time.time(),\n            \'args_count\': len(args)\n        }\n        call_log.append(entry)\n        print(f\'  [{hook_name}] agent={ctx.agent_name} t={entry[\"time\"]:.3f}\')\n        return None  # always proceed normally\n    return callback</code></pre>' +

        '<p><strong>Step 2: Create an agent with all hooks and a tool (hook_test.py)</strong></p>' +
        '<pre><code>import google.adk as adk\nfrom google.adk.agents import LlmAgent\nfrom google.adk.runners import Runner\nfrom google.adk.sessions import InMemorySessionService\nfrom callback_logger import log_hook, call_log\nimport asyncio\n\ndef get_weather(city: str) -&gt; str:\n    \"\"\"Get the weather for a city.\"\"\"\n    return f\'The weather in {city} is sunny, 72F.\'\n\nagent = LlmAgent(\n    name=\'hooked_agent\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'You are a helpful assistant. Use the weather tool when asked about weather.\',\n    tools=[get_weather],\n    before_agent_callback=log_hook(\'before_agent\'),\n    after_agent_callback=log_hook(\'after_agent\'),\n    before_model_callback=log_hook(\'before_model\'),\n    after_model_callback=log_hook(\'after_model\'),\n    before_tool_callback=log_hook(\'before_tool\'),\n    after_tool_callback=log_hook(\'after_tool\')\n)</code></pre>' +

        '<p><strong>Step 3: Run with a simple text prompt</strong></p>' +
        '<pre><code>async def run_test(prompt: str):\n    call_log.clear()\n    session_service = InMemorySessionService()\n    runner = Runner(agent=agent, app_name=\'hook_test\', session_service=session_service)\n    session = await session_service.create_session(app_name=\'hook_test\', user_id=\'user1\')\n\n    print(f\'\\n=== Prompt: \"{prompt}\" ===\')\n    async for event in runner.run_async(\n        user_id=\'user1\', session_id=session.id,\n        new_message=adk.types.Content(parts=[adk.types.Part(text=prompt)])\n    ):\n        pass\n\n    print(f\'\\nFiring order ({len(call_log)} hooks):\')\n    for i, entry in enumerate(call_log):\n        print(f\'  {i+1}. {entry[\"hook\"]}\')\n\n# Test 1: Simple text response\nasyncio.run(run_test(\'What is 2+2?\'))\n\n# Test 2: Tool-using response\nasyncio.run(run_test(\'What is the weather in Tokyo?\'))</code></pre>' +

        '<p><strong>Step 4: Analyze the results</strong></p>' +
        '<p>Answer these questions from your logged output:</p>' +
        '<ul>' +
        '<li>For a simple text response, what is the exact hook sequence?</li>' +
        '<li>For a tool-using response, how many times does before_model_callback fire? (Expected: at least 2)</li>' +
        '<li>Do before_tool and after_tool appear in the simple text response? (Expected: no)</li>' +
        '<li>Does after_agent_callback fire even if before_agent_callback skips the agent? (Test this by making before_agent return Content.)</li>' +
        '</ul>' +

        '<p><strong>Step 5: Test the bypass</strong></p>' +
        '<pre><code>from google.genai.types import Content, Part\n\ndef blocking_before_agent(ctx):\n    call_log.append({\'hook\': \'before_agent_BLOCK\', \'agent\': ctx.agent_name, \'time\': time.time()})\n    return Content(parts=[Part(text=\'Agent bypassed by callback.\')])\n\n# Create agent with blocking callback and run.\n# Observe: does after_agent_callback still fire?</code></pre>'
    },
    {
      id: 'before-agent-bypass',
      title: 'before_agent_callback -- The Complete Bypass',
      content:
        '<p>The <code>before_agent_callback</code> is the most powerful hook in ADK. When it returns any <code>Content</code> object, the agent is <strong>completely bypassed</strong> -- no LLM call, no tool execution, no state changes from the agent\'s normal logic. The returned Content appears as the agent\'s response. Token cost: <strong>zero</strong>.</p>' +

        '<h3>Why This Matters</h3>' +
        '<p>This is not just a convenience feature. It is a complete admission control mechanism built into every agent. The implications are far-reaching:</p>' +
        '<ul>' +
        '<li><strong>Admission control</strong> -- block agents under heavy load, return a canned response instead of consuming API quota</li>' +
        '<li><strong>Caching</strong> -- check if this exact query was answered recently, return the cached response at zero cost</li>' +
        '<li><strong>Circuit breaking</strong> -- if a backend service is down, fail fast with a meaningful message instead of letting the agent try and fail expensively</li>' +
        '<li><strong>A/B testing</strong> -- route to different implementations by returning Content from different code paths</li>' +
        '<li><strong>Scheduling gate</strong> -- this is where LOCO-Agent\'s scheduling decision lives. The before_agent_callback is functionally equivalent to a load-aware admission controller</li>' +
        '</ul>' +

        '<h3>The Bypass Mechanism</h3>' +
        '<pre><code>from google.genai.types import Content, Part\n\ndef admission_control(ctx):\n    \"\"\"Block agent execution under heavy load.\"\"\"\n    current_load = get_system_load()  # your load function\n    \n    if current_load &gt; 0.9:\n        # Return Content = skip agent entirely. Zero tokens.\n        return Content(parts=[Part(text=\'System is under heavy load. Please try again later.\')])\n    \n    # Return None = proceed with normal agent execution\n    return None\n\nagent = LlmAgent(\n    name=\'expensive_analyst\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Perform deep analysis.\',\n    before_agent_callback=admission_control\n)</code></pre>' +

        '<h3>Zero Cost Is the Key Insight</h3>' +
        '<p>When before_agent_callback returns Content, ADK skips the entire agent pipeline. No prompt is assembled. No LLM API call is made. No tokens are consumed. The only cost is the Python function execution time -- typically microseconds. In a system with 50 agents, the ability to gate each one at zero cost is the foundation of cost-aware scheduling.</p>' +

        '<h3>Interaction with after_agent_callback</h3>' +
        '<p>A bypassed agent still triggers <code>after_agent_callback</code>. The sequence is: before_agent (returns Content) -> [agent skipped] -> after_agent (fires with the returned Content). This means your after_agent logging or cleanup still runs even when the agent is bypassed. This is useful for metrics -- you can count bypasses in after_agent.</p>' +

        '<h3>The Scheduling Gate</h3>' +
        '<p>This is where the thought leadership thesis crystallizes. Every ADK agent has a built-in admission control point. The hook exists. The mechanism is zero-cost. The override pattern is clean. But nobody is using it for scheduling. Every production ADK deployment leaves this gate empty -- no load awareness, no cost tracking, no cross-agent coordination. The slot is there, waiting for a scheduler to fill it.</p>',

      summary: 'before_agent_callback is a zero-cost agent bypass mechanism. Return Content to skip the entire agent -- no LLM call, no tokens consumed. This is the scheduling gate: admission control, caching, circuit breaking, all at zero cost. The hook exists in every agent but nobody uses it for scheduling.',

      mentalModel: 'before_agent_callback is like a bouncer at a club -- if the bouncer says no, you don\'t even get inside. The club (LLM) never knows you existed. Zero cost, zero tokens, zero latency beyond the Python function.',

      mistakes: [
        'Returning empty Content (Content with no parts or empty text) -- may cause downstream errors in agents that expect meaningful input from their predecessor.',
        'Not realizing that a bypassed agent still triggers after_agent_callback -- it does. The sequence is before_agent -> [skip] -> after_agent. Plan your logging accordingly.',
        'Using before_agent_callback for per-LLM-call throttling -- use before_model_callback for that. before_agent fires once per agent invocation, not per LLM call within the invocation.'
      ],

      exercise:
        '<p><strong>Goal:</strong> Build an admission control system that blocks agents after a threshold and verify zero token cost.</p>' +

        '<p><strong>Step 1: Create the admission controller (admission_control.py)</strong></p>' +
        '<pre><code>from google.genai.types import Content, Part\n\ncall_counter = 0\nbypass_log = []\n\ndef admission_gate(ctx):\n    \"\"\"Admit the first 3 calls, block subsequent ones.\"\"\"\n    global call_counter\n    call_counter += 1\n    \n    if call_counter &gt; 3:\n        bypass_log.append({\'call\': call_counter, \'action\': \'BLOCKED\', \'agent\': ctx.agent_name})\n        return Content(parts=[Part(text=f\'System under heavy load (call #{call_counter}). Request queued.\')])\n    \n    bypass_log.append({\'call\': call_counter, \'action\': \'ADMITTED\', \'agent\': ctx.agent_name})\n    return None  # proceed normally</code></pre>' +

        '<p><strong>Step 2: Create the agent (admission_test.py)</strong></p>' +
        '<pre><code>import google.adk as adk\nfrom google.adk.agents import LlmAgent\nfrom google.adk.runners import Runner\nfrom google.adk.sessions import InMemorySessionService\nfrom admission_control import admission_gate, call_counter, bypass_log\nimport asyncio\nimport time\n\nagent = LlmAgent(\n    name=\'expensive_analyst\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Answer the user question thoroughly.\',\n    before_agent_callback=admission_gate\n)\n\nasync def main():\n    session_service = InMemorySessionService()\n    runner = Runner(agent=agent, app_name=\'admission_test\', session_service=session_service)\n    session = await session_service.create_session(app_name=\'admission_test\', user_id=\'user1\')\n\n    messages = [\n        \'What is Python?\',\n        \'What is JavaScript?\',\n        \'What is Rust?\',\n        \'What is Go?\',       # should be blocked\n        \'What is Kotlin?\'    # should be blocked\n    ]\n\n    for msg in messages:\n        start = time.time()\n        response_text = \'\'\n        async for event in runner.run_async(\n            user_id=\'user1\', session_id=session.id,\n            new_message=adk.types.Content(parts=[adk.types.Part(text=msg)])\n        ):\n            if event.content and event.content.parts:\n                response_text = event.content.parts[0].text\n        elapsed = time.time() - start\n        print(f\'Message: \"{msg}\"\')\n        print(f\'  Response: {response_text[:80]}...\')\n        print(f\'  Latency: {elapsed:.3f}s\\n\')\n\n    print(\'=== Bypass Log ===\')\n    for entry in bypass_log:\n        print(f\'  Call #{entry[\"call\"]}: {entry[\"action\"]}\')\n\nasyncio.run(main())</code></pre>' +

        '<p><strong>Step 3: Run and measure</strong></p>' +
        '<pre><code>python admission_test.py</code></pre>' +

        '<p><strong>Step 4: Analyze latency</strong></p>' +
        '<ul>' +
        '<li>Compare latency for admitted calls (1-3) vs blocked calls (4-5)</li>' +
        '<li>Blocked calls should complete in microseconds vs hundreds of milliseconds for real LLM calls</li>' +
        '<li>The response for blocked calls should be the canned "System under heavy load" message</li>' +
        '<li>Token cost for blocked calls: zero. Verify by checking traces if available.</li>' +
        '</ul>' +

        '<p><strong>Step 5: Verify after_agent still fires</strong></p>' +
        '<pre><code># Add an after_agent callback to the agent:\ndef after_agent_log(ctx, content):\n    print(f\'  [after_agent] fired for {ctx.agent_name}\')\n    return None\n\n# Rebuild agent with both callbacks and run again.\n# Verify: after_agent fires for ALL 5 calls, including the 2 blocked ones.</code></pre>',

      postEvidence: 'ADK has a zero-cost agent bypass mechanism that nobody uses for scheduling. Returning Content from before_agent_callback skips the entire agent at zero token cost. This is the scheduling gate -- and it is empty.'
    },
    {
      id: 'before-model-interceptor',
      title: 'before_model_callback -- The LLM Interceptor',
      content:
        '<p><code>before_model_callback</code> fires before <strong>every LLM API call</strong> within an agent\'s execution. Unlike before_agent_callback (which fires once per agent invocation), this hook fires for every individual LLM call -- and a single agent invocation can make multiple LLM calls when tools are involved.</p>' +

        '<h3>What You Can See</h3>' +
        '<p>The callback receives two arguments: <code>CallbackContext</code> and <code>LlmRequest</code>. The LlmRequest exposes the full outbound request:</p>' +
        '<ul>' +
        '<li><code>contents</code> -- the conversation history (list of Content objects, each with parts). This is the full context being sent to the LLM.</li>' +
        '<li><code>config</code> -- GenerateContentConfig with temperature, max_output_tokens, and other generation parameters</li>' +
        '<li><code>tools</code> -- list of tool schemas (FunctionDeclaration objects) that the LLM can call</li>' +
        '</ul>' +
        '<pre><code>def before_model(ctx, llm_request):\n    print(f\'Agent: {ctx.agent_name}\')\n    print(f\'Messages in context: {len(llm_request.contents)}\')\n    print(f\'Tools available: {len(llm_request.tools) if llm_request.tools else 0}\')\n    \n    if llm_request.config:\n        print(f\'Temperature: {llm_request.config.temperature}\')\n        print(f\'Max tokens: {llm_request.config.max_output_tokens}\')\n    \n    return None  # proceed with the call</code></pre>' +

        '<h3>Multiple Firings Per Message</h3>' +
        '<p>This is the critical insight that many developers miss. When an agent uses tools, the execution flow is:</p>' +
        '<ol>' +
        '<li><strong>First LLM call</strong> -- agent sends user message + instruction + tool schemas. LLM returns a tool_call.</li>' +
        '<li><strong>Tool execution</strong> -- ADK runs the tool and collects the result.</li>' +
        '<li><strong>Second LLM call</strong> -- agent sends the updated conversation (now including the tool result). LLM returns final text.</li>' +
        '</ol>' +
        '<p>For each of these LLM calls, <code>before_model_callback</code> fires. If the agent calls multiple tools in sequence, it fires even more times. A complex tool-using agent might make 4-6 LLM calls for a single user message.</p>' +

        '<h3>The Per-Call Scheduling Point</h3>' +
        '<p>While before_agent_callback is the admission gate (should this agent run at all?), before_model_callback is the per-call throttle (should this specific LLM call proceed right now?). This is where you would implement:</p>' +
        '<ul>' +
        '<li><strong>Rate limiting</strong> -- track calls per second and delay or skip when over quota</li>' +
        '<li><strong>Token estimation</strong> -- inspect contents length to estimate input tokens before the call</li>' +
        '<li><strong>Cost tracking</strong> -- log every LLM call for cost attribution</li>' +
        '<li><strong>Request modification</strong> -- adjust temperature, max_tokens, or even swap models based on load</li>' +
        '</ul>' +

        '<h3>Skipping the LLM Call</h3>' +
        '<p>Returning an <code>LlmResponse</code> from before_model_callback skips the actual API call. The agent receives the returned LlmResponse as if it came from the LLM. This is powerful for caching: if you have seen this exact prompt before, return the cached response at zero token cost.</p>' +
        '<pre><code>from google.genai.types import GenerateContentResponse\n\ndef caching_interceptor(ctx, llm_request):\n    cache_key = hash(str(llm_request.contents))\n    cached = response_cache.get(cache_key)\n    if cached:\n        return cached  # skip LLM call, return cached response\n    return None  # proceed with real call</code></pre>',

      summary: 'before_model_callback fires for every LLM API call within an agent invocation -- multiple times for tool-using agents. It exposes the full LlmRequest (contents, config, tools). Return an LlmResponse to skip the call at zero cost. This is where per-call rate limiting and token estimation would live.',

      mentalModel: 'before_model_callback is like a proxy server -- every LLM request passes through it. You can inspect, delay, modify, or reject each request. Unlike before_agent_callback (bouncer at the door), this fires for EVERY LLM call during the agent\'s execution, not just once at the entrance.',

      mistakes: [
        'Assuming before_model_callback fires only once per user message -- it fires for every LLM call within the agent\'s execution. Tool-using agents make multiple LLM calls per message.',
        'Blocking in the callback without a timeout -- this blocks the entire agent execution loop. If you need to wait for a rate limit window, implement async-safe waiting or reject immediately.',
        'Modifying llm_request.contents in place -- may cause unpredictable behavior in the agent\'s conversation tracking. Return an LlmResponse instead to skip the call cleanly.'
      ],

      exercise:
        '<p><strong>Goal:</strong> Build a rate-limiting callback that logs every LLM call and counts firings per user message.</p>' +

        '<p><strong>Step 1: Create the interceptor (model_interceptor.py)</strong></p>' +
        '<pre><code>import time\n\nmodel_call_log = []\n\ndef rate_limit_interceptor(ctx, llm_request):\n    \"\"\"Log every LLM call with details from the request.\"\"\"\n    entry = {\n        \'agent\': ctx.agent_name,\n        \'time\': time.time(),\n        \'message_count\': len(llm_request.contents) if llm_request.contents else 0,\n        \'has_tools\': bool(llm_request.tools),\n        \'tool_count\': len(llm_request.tools) if llm_request.tools else 0,\n    }\n    \n    # Inspect config if available\n    if llm_request.config:\n        entry[\'temperature\'] = getattr(llm_request.config, \'temperature\', None)\n        entry[\'max_tokens\'] = getattr(llm_request.config, \'max_output_tokens\', None)\n    \n    model_call_log.append(entry)\n    print(f\'  [before_model #{len(model_call_log)}] \'\n          f\'agent={entry[\"agent\"]} \'\n          f\'messages={entry[\"message_count\"]} \'\n          f\'tools={entry[\"tool_count\"]}\')\n    \n    return None  # always proceed</code></pre>' +

        '<p><strong>Step 2: Create a tool-using agent (interceptor_test.py)</strong></p>' +
        '<pre><code>import google.adk as adk\nfrom google.adk.agents import LlmAgent\nfrom google.adk.runners import Runner\nfrom google.adk.sessions import InMemorySessionService\nfrom model_interceptor import rate_limit_interceptor, model_call_log\nimport asyncio\n\ndef calculate(expression: str) -&gt; str:\n    \"\"\"Evaluate a math expression.\"\"\"\n    try:\n        result = eval(expression)\n        return f\'Result: {result}\'\n    except Exception as e:\n        return f\'Error: {e}\'\n\ndef lookup_fact(topic: str) -&gt; str:\n    \"\"\"Look up a fact about a topic.\"\"\"\n    return f\'{topic}: This is a simulated fact for testing purposes.\'\n\nagent = LlmAgent(\n    name=\'tool_agent\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'You are a helpful assistant. Use tools when appropriate.\',\n    tools=[calculate, lookup_fact],\n    before_model_callback=rate_limit_interceptor\n)</code></pre>' +

        '<p><strong>Step 3: Run with different prompts</strong></p>' +
        '<pre><code>async def main():\n    session_service = InMemorySessionService()\n    runner = Runner(agent=agent, app_name=\'interceptor_test\', session_service=session_service)\n    session = await session_service.create_session(app_name=\'interceptor_test\', user_id=\'user1\')\n\n    prompts = [\n        \'What is 2+2?\',                        # may or may not use tool\n        \'Calculate 17 * 23 + 5\',                # should use calculate tool\n        \'Look up facts about Python\',           # should use lookup_fact tool\n        \'Calculate 100/7 and look up facts about division\',  # may use both tools\n    ]\n\n    for prompt in prompts:\n        model_call_log.clear()\n        print(f\'\\n=== Prompt: \"{prompt}\" ===\')\n        async for event in runner.run_async(\n            user_id=\'user1\', session_id=session.id,\n            new_message=adk.types.Content(parts=[adk.types.Part(text=prompt)])\n        ):\n            pass\n        print(f\'Total before_model firings: {len(model_call_log)}\')\n\nasyncio.run(main())</code></pre>' +

        '<p><strong>Step 4: Document findings</strong></p>' +
        '<ul>' +
        '<li>How many times did before_model_callback fire for a simple text response? (Expected: 1)</li>' +
        '<li>How many times for a single tool call? (Expected: at least 2)</li>' +
        '<li>How many times for a prompt that triggers two tools? (Expected: at least 3)</li>' +
        '<li>What fields were visible on llm_request? List every attribute you found.</li>' +
        '</ul>'
    },
    {
      id: 'callback-context',
      title: 'Callback Context Inspection',
      content:
        '<p>This topic is <strong>original research territory</strong>. Nobody has published a comprehensive inventory of what data is visible inside ADK callbacks. Understanding what a scheduler can see -- and what is missing -- is the foundation for building effective agent orchestration.</p>' +

        '<h3>What CallbackContext Exposes</h3>' +
        '<p>The <code>CallbackContext</code> object is passed to every callback. Based on ADK source code and runtime inspection, it exposes:</p>' +
        '<ul>' +
        '<li><code>agent_name</code> (str) -- the name of the current agent</li>' +
        '<li><code>state</code> (dict-like) -- read/write access to session state, with full prefix scoping (temp:, user:, app:)</li>' +
        '<li><code>invocation_id</code> (str) -- unique identifier for this invocation, consistent across all callbacks within the same invocation</li>' +
        '</ul>' +

        '<h3>What LlmRequest Exposes</h3>' +
        '<p>The <code>LlmRequest</code> in before_model_callback and after_model_callback provides:</p>' +
        '<ul>' +
        '<li><code>contents</code> (list) -- the full conversation history being sent to the LLM. Each entry is a Content object with parts (text, function_call, function_response, etc.)</li>' +
        '<li><code>config</code> (GenerateContentConfig) -- generation parameters including temperature, top_p, top_k, max_output_tokens, stop_sequences, candidate_count</li>' +
        '<li><code>tools</code> (list) -- tool schemas (FunctionDeclaration objects) available to the LLM. Each includes name, description, and parameter schema.</li>' +
        '</ul>' +

        '<h3>What LlmResponse Exposes</h3>' +
        '<p>The <code>LlmResponse</code> in after_model_callback provides:</p>' +
        '<ul>' +
        '<li><code>content</code> -- the LLM\'s response Content (text, tool calls, etc.)</li>' +
        '<li><code>usage_metadata</code> -- token counts (prompt_token_count, candidates_token_count, total_token_count) -- but only AFTER the call completes</li>' +
        '</ul>' +

        '<h3>What Is Missing -- The Scheduler\'s Blind Spots</h3>' +
        '<p>This is the critical finding. A scheduler hooked into ADK callbacks cannot see:</p>' +
        '<ul>' +
        '<li><strong>Pre-call token estimate</strong> -- you can count messages in contents, but there is no tokenizer to estimate cost before the call is made</li>' +
        '<li><strong>Model pricing</strong> -- the callback does not know what the per-token cost is for the model being called</li>' +
        '<li><strong>Cumulative session cost</strong> -- there is no running total of tokens consumed or dollars spent across the session</li>' +
        '<li><strong>Cross-agent awareness</strong> -- a callback on Agent A cannot see what Agent B is doing, has done, or plans to do</li>' +
        '<li><strong>Queue depth</strong> -- there is no visibility into how many other requests are pending for the same model/API</li>' +
        '<li><strong>Rate limit status</strong> -- the callback does not know the current rate limit window or remaining quota</li>' +
        '</ul>' +
        '<p>These gaps define the scheduler\'s challenge. LOCO-Agent must maintain its own accounting (cost tracking, cross-agent state, queue awareness) and inject it through the callback context -- ADK does not provide it natively.</p>' +

        '<h3>The Inspection Method</h3>' +
        '<p>To discover undocumented attributes, use Python\'s <code>dir()</code> and <code>getattr()</code> at runtime. Filter out dunder methods and internal attributes to find the public API surface. Some attributes only appear with specific configurations (tools, planners, multi-agent setups), so test with multiple agent configurations.</p>',

      summary: 'ADK callbacks expose agent_name, state, invocation_id, and the full LlmRequest (contents, config, tools). Missing for scheduling: pre-call token estimates, model pricing, cumulative cost, cross-agent awareness, queue depth, and rate limit status. A scheduler must maintain its own accounting layer.',

      mentalModel: 'This is like X-raying the control plane -- you are mapping the terrain that a scheduler would need to navigate. Every field you find is a potential scheduling signal. Every field that is missing is a gap the scheduler must fill with its own infrastructure.',

      mistakes: [
        'Using dir() without filtering dunder methods -- the output is extremely noisy. Filter with [attr for attr in dir(obj) if not attr.startswith("_")] to see the public API.',
        'Assuming all attributes are documented -- many are internal, undocumented, or version-dependent. Test empirically.',
        'Not testing with different agent configurations -- some fields (tools, planner state) only appear when the agent has tools configured or is part of a multi-agent setup.',
        'Treating the callback context as stable API -- ADK is pre-1.0. These attributes may change between versions. Always test after upgrading.'
      ],

      exercise:
        '<p><strong>Goal:</strong> Build a deep inspection callback that discovers every accessible attribute on CallbackContext and LlmRequest.</p>' +

        '<p><strong>Step 1: Create the inspector (deep_inspector.py)</strong></p>' +
        '<pre><code>def inspect_object(obj, label, depth=0):\n    \"\"\"Recursively inspect an object\'s public attributes.\"\"\"\n    indent = \'  \' * depth\n    attrs = [a for a in dir(obj) if not a.startswith(\'_\')]\n    print(f\'{indent}{label} ({type(obj).__name__}): {len(attrs)} public attributes\')\n    for attr in attrs:\n        try:\n            val = getattr(obj, attr)\n            if callable(val):\n                print(f\'{indent}  {attr}() -- callable\')\n            else:\n                val_str = str(val)[:100]\n                print(f\'{indent}  {attr} = {val_str}\')\n        except Exception as e:\n            print(f\'{indent}  {attr} -- ERROR: {e}\')\n\ndef deep_before_model(ctx, llm_request):\n    \"\"\"Inspect everything visible in the callback.\"\"\"\n    print(\'\\n=== DEEP INSPECTION: CallbackContext ===\')\n    inspect_object(ctx, \'CallbackContext\')\n    \n    print(\'\\n=== DEEP INSPECTION: LlmRequest ===\')\n    inspect_object(llm_request, \'LlmRequest\')\n    \n    if llm_request.contents:\n        print(f\'\\n  Contents: {len(llm_request.contents)} messages\')\n        for i, content in enumerate(llm_request.contents):\n            print(f\'    [{i}] role={getattr(content, \"role\", \"?\")} \'\n                  f\'parts={len(content.parts) if content.parts else 0}\')\n    \n    if llm_request.config:\n        print(\'\\n=== DEEP INSPECTION: Config ===\')\n        inspect_object(llm_request.config, \'GenerateContentConfig\', depth=1)\n    \n    if llm_request.tools:\n        print(f\'\\n  Tools: {len(llm_request.tools)}\')\n        for tool in llm_request.tools:\n            inspect_object(tool, f\'Tool\', depth=2)\n    \n    return None</code></pre>' +

        '<p><strong>Step 2: Create agents with different configurations (inspector_test.py)</strong></p>' +
        '<pre><code>import google.adk as adk\nfrom google.adk.agents import LlmAgent\nfrom google.adk.runners import Runner\nfrom google.adk.sessions import InMemorySessionService\nfrom deep_inspector import deep_before_model\nimport asyncio\n\ndef sample_tool(query: str) -&gt; str:\n    \"\"\"A sample tool for testing.\"\"\"\n    return f\'Result for: {query}\'\n\n# Agent WITH tools\nagent_with_tools = LlmAgent(\n    name=\'agent_with_tools\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Use the sample_tool to answer questions.\',\n    tools=[sample_tool],\n    before_model_callback=deep_before_model\n)\n\n# Agent WITHOUT tools\nagent_no_tools = LlmAgent(\n    name=\'agent_no_tools\',\n    model=\'gemini-2.5-flash\',\n    instruction=\'Answer questions directly.\',\n    before_model_callback=deep_before_model\n)\n\nasync def run_inspection(agent, prompt):\n    session_service = InMemorySessionService()\n    runner = Runner(agent=agent, app_name=\'inspector\', session_service=session_service)\n    session = await session_service.create_session(app_name=\'inspector\', user_id=\'user1\')\n    print(f\'\\n{\"=\"*60}\')\n    print(f\'Agent: {agent.name} | Prompt: \"{prompt}\"\')\n    print(f\'{\"=\"*60}\')\n    async for event in runner.run_async(\n        user_id=\'user1\', session_id=session.id,\n        new_message=adk.types.Content(parts=[adk.types.Part(text=prompt)])\n    ):\n        pass\n\nasync def main():\n    await run_inspection(agent_with_tools, \'Look up information about Python\')\n    await run_inspection(agent_no_tools, \'What is Python?\')\n\nasyncio.run(main())</code></pre>' +

        '<p><strong>Step 3: Run and capture output</strong></p>' +
        '<pre><code>python inspector_test.py 2&gt;&amp;1 | tee inspection_results.txt</code></pre>' +

        '<p><strong>Step 4: Analyze the output</strong></p>' +
        '<p>Create a table documenting every attribute found:</p>' +
        '<ul>' +
        '<li>What attributes does CallbackContext have? List them all.</li>' +
        '<li>What attributes does LlmRequest have? List them all.</li>' +
        '<li>Which attributes differ between the tool agent and the no-tool agent?</li>' +
        '<li>What is missing that a scheduler would need? (Token estimates, pricing, cumulative cost, cross-agent state, queue depth, rate limit status)</li>' +
        '</ul>' +

        '<p><strong>Step 5: Check the after_model response</strong></p>' +
        '<pre><code>def deep_after_model(ctx, llm_response):\n    \"\"\"Inspect the LLM response object.\"\"\"\n    print(\'\\n=== DEEP INSPECTION: LlmResponse ===\')\n    inspect_object(llm_response, \'LlmResponse\')\n    if hasattr(llm_response, \'usage_metadata\') and llm_response.usage_metadata:\n        print(\'\\n=== Usage Metadata ===\')\n        inspect_object(llm_response.usage_metadata, \'UsageMetadata\', depth=1)\n    return None\n\n# Add after_model_callback=deep_after_model to both agents and re-run.\n# This reveals token counts AFTER the call -- the only cost data ADK provides.</code></pre>',

      postEvidence: 'Nobody has published what is visible inside ADK callbacks. Our inspection reveals: agent_name, state, invocation_id, full LlmRequest with contents and config. Missing: pre-call token estimate, model pricing, cumulative cost, cross-agent awareness. A scheduler has to work with what is there.'
    }
  ]
});
